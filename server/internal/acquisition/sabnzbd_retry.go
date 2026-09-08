package acquisition

import (
	"context"
	"errors"
	"time"
)

// SABnzbd retry can replace the job ID. Record the intent before calling it so a
// lost response is recovered by the original request marker, never re-uploaded.
func (s *Store) retryUsenetJob(ctx context.Context, client *Client, requestID, previousID string) error {
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `
        UPDATE acquisition_requests
        SET fulfillment_state='submitting', download_job_id='', download_error='', updated_at=?
        WHERE id=? AND fulfillment_state='failed'
    `, stamp, requestID)
	if err != nil {
		return err
	}

	if changed, _ := result.RowsAffected(); changed != 1 {
		return ErrInvalid
	}

	id, err := (sabnzbdBackend{client}).retry(ctx, previousID)
	if errors.Is(err, ErrSubmissionUnknown) {
		return nil
	}

	if err != nil {
		_, saveErr := s.db.ExecContext(ctx, `
            UPDATE acquisition_requests
            SET fulfillment_state='failed', download_job_id=?, download_error=?
            WHERE id=? AND fulfillment_state='submitting'
        `, previousID, err.Error(), requestID)
		return errors.Join(err, saveErr)
	}

	_, err = s.db.ExecContext(ctx, `
        UPDATE acquisition_requests
        SET status='queued', fulfillment_state='downloading', download_state='downloading',
            download_job_id=?, client_state='', failure_kind='', dismissed_at='',
            download_last_seen_at='', download_progress=0, download_progress_updated_at=?, updated_at=?
        WHERE id=? AND fulfillment_state='submitting'
    `, id, stamp, stamp, requestID)
	return err
}
