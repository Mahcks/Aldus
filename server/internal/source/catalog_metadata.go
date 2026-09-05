package source

import (
	"strings"

	"github.com/mahcks/aldus/server/internal/catalog"
)

func catalogMetadata(metadata map[string]any) (string, string, []string) {
	tags, _ := metadata["tags"].(map[string]any)
	name := first(metadataString(metadata, "series"), metadataString(tags, "series"))
	position := first(metadataString(metadata, "series_index"), metadataString(tags, "series_index"))
	var names []string
	switch value := tags["narrator"].(type) {
	case string:
		if strings.TrimSpace(value) != "" {
			names = []string{value}
		}
	case []any:
		for _, v := range value {
			narrator, ok := v.(string)
			if !ok {
				return name, position, nil
			}
			names = append(names, narrator)
		}
	}
	normalized, err := catalog.NarratorNames(names)
	if err != nil {
		normalized = nil
	}
	return name, position, normalized
}

func agreedSeries(values []map[string]any) (string, string, bool) {
	name, position, key := "", "", ""
	for _, value := range values {
		if conflict, _ := value["series_conflict"].(bool); conflict {
			return "", "", false
		}
		n, p, _ := catalogMetadata(value)
		if n == "" && p == "" {
			continue
		}
		display, normalized, order, err := catalog.SeriesMetadata(n, p)
		if err != nil {
			return "", "", false
		}
		p = catalog.SeriesPosition(order)
		if key != "" && (key != normalized || position != p) {
			return "", "", false
		}
		name, position, key = display, p, normalized
	}
	return name, position, true
}
