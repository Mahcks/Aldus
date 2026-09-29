package position

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ResetTx runs only inside ownership.ResetWithClaim's authorized write transaction.
// It clears locations, retains revision fences and leaves preferences and history intact.
func ResetTx(ctx context.Context, tx *sql.Tx, userID, workID string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := tx.ExecContext(ctx, `
        INSERT INTO progress_resets (user_id, work_id, revision, ownership_epoch, updated_at)
        SELECT ?, ?, MAX(
            COALESCE((SELECT revision FROM progress WHERE user_id = ? AND work_id = ?), 0),
            COALESCE((SELECT revision FROM progress_resets WHERE user_id = ? AND work_id = ?), 0)
        ) + 1, epoch, ?
        FROM reading_owners WHERE user_id = ? AND work_id = ?
        ON CONFLICT(user_id, work_id) DO UPDATE SET
            revision = excluded.revision,
            ownership_epoch = excluded.ownership_epoch,
            updated_at = excluded.updated_at`,
		userID, workID, userID, workID, userID, workID, now, userID, workID)
	if err != nil {
		return fmt.Errorf("record progress reset: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
        DELETE FROM progress WHERE user_id = ? AND work_id = ?`, userID, workID); err != nil {
		return fmt.Errorf("reset canonical progress: %w", err)
	}
	// Insert a fence for every edition, including editions with no saved state.
	// A false override preserves inheritance from the reader's global preferences.
	_, err = tx.ExecContext(ctx, `
        INSERT INTO representation_state (
            user_id, representation_id, audio_timestamp_ms,
            reader_preferences_override, revision, updated_at
        )
        SELECT ?, id, NULL, 0, 1, ?
        FROM representations WHERE work_id = ?
        ON CONFLICT(user_id, representation_id) DO UPDATE SET
            epub_locator = NULL,
            audio_timestamp_ms = excluded.audio_timestamp_ms,
            reader_preferences_override = COALESCE(representation_state.reader_preferences_override, 0),
            revision = representation_state.revision + 1,
            updated_at = excluded.updated_at`, userID, now, workID)
	if err != nil {
		return fmt.Errorf("reset edition positions: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
        DELETE FROM koreader_progress
        WHERE user_id = ? AND media_id IN (
            SELECT m.id FROM media m
            JOIN representations r ON r.id = m.representation_id
            WHERE r.work_id = ?
        )`, userID, workID)
	if err != nil {
		return fmt.Errorf("reset KOReader position: %w", err)
	}
	return nil
}

func ResetEpochTx(ctx context.Context, tx *sql.Tx, userID, workID string) (int64, error) {
	var epoch int64
	err := tx.QueryRowContext(ctx, `
        SELECT COALESCE((
            SELECT ownership_epoch FROM progress_resets WHERE user_id = ? AND work_id = ?
        ), 0)`, userID, workID).Scan(&epoch)
	return epoch, err
}
