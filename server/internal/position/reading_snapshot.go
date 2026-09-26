package position

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
)

// ReadingSnapshotTx reads positions under the caller's authorized takeover
// transaction. It neither interprets nor changes coordinates or revisions.
func ReadingSnapshotTx(ctx context.Context, tx *sql.Tx, userID, workID string) (*Canonical, []RepresentationState, error) {
	queries := dbsql.New(tx)
	var progress *Canonical
	value, err := progressTx(ctx, queries, userID, workID)
	if err == nil {
		progress = &value
	} else if !errors.Is(err, ErrNotFound) {
		return nil, nil, err
	}

	rows, err := tx.QueryContext(ctx, `
        SELECT id FROM representations WHERE work_id = ? ORDER BY id`, workID)
	if err != nil {
		return nil, nil, fmt.Errorf("list takeover representations: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}

	states := make([]RepresentationState, 0, len(ids))
	for _, id := range ids {
		row, err := queries.GetRepresentationState(ctx, dbsql.GetRepresentationStateParams{
			UserID:           userID,
			RepresentationID: id,
		})
		state, err := representationStateRow(row, err)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, nil, err
		}
		states = append(states, state)
	}
	return progress, states, nil
}
