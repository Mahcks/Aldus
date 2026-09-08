package acquisition

import (
	"context"
	"encoding/json"
	"fmt"
	"mime"
	"slices"
	"strconv"
	"strings"
)

// ReleaseMetadata describes the indexer's claim, not validation of the payload.
// GUID may be a credential-bearing URL, so public DTOs select safe fields explicitly.
type ReleaseMetadata struct {
	Protocol   string `json:"protocol,omitempty"`
	IndexerID  int    `json:"indexer_id,omitempty"`
	GUID       string `json:"guid,omitempty"`
	Categories []int  `json:"categories,omitempty"`
	Seeders    *int   `json:"seeders,omitempty"`
	Peers      *int   `json:"peers,omitempty"`
	Format     string `json:"format,omitempty"`
}

type feedAttribute struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value,attr"`
}

func feedMetadata(guid, mimeType string, attributes []feedAttribute) ReleaseMetadata {
	metadata := ReleaseMetadata{Protocol: "torrent", GUID: guid}
	mediaType, _, _ := mime.ParseMediaType(mimeType)
	if strings.EqualFold(mediaType, "application/x-nzb") {
		metadata.Protocol = "usenet"
	}

	for _, attribute := range attributes {
		value := strings.TrimSpace(attribute.Value)
		switch strings.ToLower(attribute.Name) {
		case "category":
			category, err := strconv.Atoi(value)
			if err == nil && category > 0 && !slices.Contains(metadata.Categories, category) {
				metadata.Categories = append(metadata.Categories, category)
			}
		case "seeders":
			metadata.Seeders = nonnegativeCount(value)
		case "peers":
			metadata.Peers = nonnegativeCount(value)
		case "format":
			// Only a known, explicit format is evidence. Category names and
			// torrent/NZB container MIME types cannot identify book contents.
			format := strings.TrimPrefix(strings.ToLower(value), ".")
			if supportedReleaseTitle(format) {
				metadata.Format = releaseFormats[format]
			}
		case "protocol":
			if strings.EqualFold(value, "usenet") {
				metadata.Protocol = "usenet"
			}
		}
	}

	slices.Sort(metadata.Categories)
	return metadata
}

func nonnegativeCount(value string) *int {
	count, err := strconv.Atoi(value)
	if err != nil || count < 0 {
		return nil
	}

	return &count
}

func (s *Store) saveReleaseMetadata(ctx context.Context, resultID string, metadata ReleaseMetadata) error {
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE acquisition_results SET release_metadata=? WHERE id=?
	`, string(encoded), resultID)
	if err != nil {
		return fmt.Errorf("record release metadata: %w", err)
	}

	return nil
}
