package catalog

import (
	"context"
	"database/sql"
	"github.com/mahcks/aldus/server/internal/auth"
	"strconv"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// MetadataKey preserves display spelling while matching Unicode, whitespace and case.
func MetadataKey(value string) string {
	return strings.ToLower(norm.NFKC.String(strings.Join(strings.Fields(value), " ")))
}

// SeriesMetadata uses thousandths, so fractional positions never rely on float equality.
func SeriesMetadata(name, position string) (string, string, *int64, error) {
	name = strings.Join(strings.Fields(name), " ")
	position = strings.TrimSpace(position)
	if len([]rune(name)) > 200 || (name == "" && position != "") {
		return "", "", nil, ErrInvalid
	}
	if position == "" {
		return name, MetadataKey(name), nil, nil
	}
	parts := strings.Split(position, ".")
	if len(parts) > 2 || len(parts[0]) == 0 || len(parts[0]) > 6 {
		return "", "", nil, ErrInvalid
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if len(fraction) == 0 || len(fraction) > 3 {
			return "", "", nil, ErrInvalid
		}
	}
	for _, r := range parts[0] + fraction {
		if r < '0' || r > '9' {
			return "", "", nil, ErrInvalid
		}
	}
	whole, _ := strconv.ParseInt(parts[0], 10, 64)
	decimals, _ := strconv.ParseInt(fraction+strings.Repeat("0", 3-len(fraction)), 10, 64)
	order := whole*1000 + decimals
	return name, MetadataKey(name), &order, nil
}

func SeriesPosition(order *int64) string {
	if order == nil {
		return ""
	}
	whole := strconv.FormatInt(*order/1000, 10)
	fraction := *order % 1000
	if fraction == 0 {
		return whole
	}
	return whole + "." + strings.TrimRight(strconv.FormatInt(1000+fraction, 10)[1:], "0")
}

func NarratorNames(names []string) ([]string, error) {
	if len(names) > 20 {
		return nil, ErrInvalid
	}
	out := make([]string, 0, len(names))
	seen := map[string]bool{}
	for _, name := range names {
		name = strings.Join(strings.Fields(name), " ")
		if name == "" || len([]rune(name)) > 200 {
			return nil, ErrInvalid
		}
		key := MetadataKey(name)
		if !seen[key] {
			out = append(out, name)
			seen[key] = true
		}
	}
	return out, nil
}

// CatalogGroups applies effective library grants before grouping or counting.
func (s *Store) CatalogGroups(ctx context.Context, actor auth.User, kind, query string, limit, offset int) ([]CatalogGroup, bool, error) {
	if kind != "series" && kind != "narrators" {
		return nil, false, ErrInvalid
	}
	if len([]rune(query)) > 200 {
		return nil, false, ErrInvalid
	}
	limit, offset = page(limit, offset)
	selection := `MIN(w.series_name),w.library_id,l.name,COUNT(*)`
	joins := `JOIN libraries l ON l.id=w.library_id`
	predicate := `w.series_key!='' AND w.series_key LIKE ? ESCAPE '\'`
	grouping := `w.library_id,w.series_key`
	if kind == "narrators" {
		selection = `MIN(n.name),'','',COUNT(DISTINCT w.id)`
		joins = `JOIN representations r ON r.work_id=w.id JOIN representation_narrators n ON n.representation_id=r.id`
		predicate = `r.kind IN ('audio','audiobook') AND n.name_key LIKE ? ESCAPE '\'`
		grouping = `n.name_key`
	}
	args := append(auth.LibraryAccessArgs(actor), "%"+escapeLike(MetadataKey(query))+"%", limit+1, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT `+selection+` FROM works w `+joins+` WHERE `+auth.EffectiveLibraryAccessSQL("w.library_id")+` AND `+predicate+` GROUP BY `+grouping+` ORDER BY 1,2 LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []CatalogGroup{}
	for rows.Next() {
		var v CatalogGroup
		if err := rows.Scan(&v.Name, &v.LibraryID, &v.LibraryName, &v.WorkCount); err != nil {
			return nil, false, err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}

type CatalogGroup struct {
	Name        string
	LibraryID   string
	LibraryName string
	WorkCount   int
}

func (s *Store) nextInSeries(ctx context.Context, actor auth.User, work Work) (*Work, error) {
	if work.Series == "" {
		return nil, nil
	}
	args := []any{work.LibraryID, MetadataKey(work.Series)}
	args = append(args, auth.LibraryAccessArgs(actor)...)
	args = append(args, work.ID)
	var id sql.NullString
	err := s.db.QueryRowContext(ctx, `WITH ordered AS (
 SELECT w.id,LEAD(w.id) OVER (ORDER BY w.series_order IS NULL,w.series_order,lower(w.title),w.id) AS next_id
 FROM works w WHERE w.library_id=? AND w.series_key=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id")+`)
 SELECT next_id FROM ordered WHERE id=?`, args...).Scan(&id)
	if err != nil {
		return nil, err
	}
	if !id.Valid {
		return nil, nil
	}
	next, err := s.Work(ctx, actor, id.String)
	return &next, err
}
