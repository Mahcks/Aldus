package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mahcks/aldus/server/internal/auth"
)

// Edition percentages are presentation only. Canonical progress still owns
// synchronization and takes precedence, including a genuine zero percent.
func (s *Store) editionCompletion(ctx context.Context, actor auth.User, workIDs []string) (map[string]int, error) {
	result := make(map[string]int)
	if len(workIDs) == 0 {
		return result, nil
	}

	args := []any{actor.ID, actor.ID}
	for _, id := range workIDs {
		args = append(args, id)
	}
	args = append(args, auth.LibraryAccessArgs(actor)...)

	rows, err := s.db.QueryContext(ctx, `
		SELECT
		  r.work_id,
		  COALESCE(rs.epub_locator, ''),
		  rs.audio_timestamp_ms,
		  (
		    SELECT m.duration_ms
		    FROM media m
		    WHERE m.representation_id = r.id
		    ORDER BY m.created_at DESC, m.id DESC
		    LIMIT 1
		  )
		FROM representation_state rs
		JOIN representations r ON r.id = rs.representation_id
		JOIN works w ON w.id = r.work_id
		WHERE rs.user_id = ?
		  AND (rs.epub_locator IS NOT NULL OR rs.audio_timestamp_ms IS NOT NULL)
		  AND NOT EXISTS (
		    SELECT 1 FROM progress p
		    JOIN alignment_segments s ON s.alignment_id = p.alignment_id AND s.id = p.segment_id
		    WHERE p.user_id = ? AND p.work_id = r.work_id
		  )
		  AND r.work_id IN (`+strings.TrimSuffix(strings.Repeat("?,", len(workIDs)), ",")+`)
		  AND `+auth.EffectiveLibraryAccessSQL("w.library_id")+`
		ORDER BY rs.updated_at DESC, rs.representation_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("load edition completion: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id, locator string
		var timestamp, duration sql.NullInt64
		if err := rows.Scan(&id, &locator, &timestamp, &duration); err != nil {
			return nil, fmt.Errorf("scan edition completion: %w", err)
		}
		if _, exists := result[id]; exists {
			continue
		}
		if timestamp.Valid && duration.Valid && duration.Int64 > 0 {
			position := min(max(timestamp.Int64, 0), duration.Int64)
			result[id] = int(float64(position) * 100 / float64(duration.Int64))
		} else if percent, ok := locatorCompletion([]byte(locator)); ok {
			result[id] = percent
		}
	}

	return result, rows.Err()
}

func locatorCompletion(raw []byte) (int, bool) {
	var value struct {
		TotalProgression *float64 `json:"totalProgression"`
		Locations        struct {
			TotalProgression *float64 `json:"totalProgression"`
		} `json:"locations"`
		CFI string `json:"cfi"`
	}
	if json.Unmarshal(raw, &value) != nil {
		return 0, false
	}

	fraction := value.TotalProgression
	if fraction == nil {
		fraction = value.Locations.TotalProgression
	}
	if fraction == nil && value.CFI != "" {
		// Native CFI stores a Readium locator; web CFI strings are not JSON.
		var native struct {
			Locations struct {
				TotalProgression *float64 `json:"totalProgression"`
			} `json:"locations"`
		}
		if json.Unmarshal([]byte(value.CFI), &native) == nil {
			fraction = native.Locations.TotalProgression
		}
	}
	if fraction == nil || *fraction < 0 || *fraction > 1 {
		return 0, false
	}

	return int(*fraction * 100), true
}
