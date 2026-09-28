package source

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/catalog"
)

// Keep ffprobe's output bounded even when a file contains enormous metadata.
func boundedProbeOutput(command *exec.Cmd) ([]byte, error) {
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, err
	}
	const limit = 1 << 20
	output, readErr := io.ReadAll(io.LimitReader(stdout, limit+1))
	if readErr != nil || len(output) > limit {
		_ = command.Process.Kill()
		_ = command.Wait()
		if readErr != nil {
			return nil, readErr
		}
		return nil, errors.New("audio metadata exceeds limit")
	}
	if err := command.Wait(); err != nil {
		return nil, err
	}
	return output, nil
}

// Raw tags remain separate evidence. Disagreeing aliases are withheld, never
// resolved by map iteration order. Explicit narrator tags outrank composer.
func normalizeAudioTags(raw map[string]string) (map[string]any, []string) {
	tags := make(map[string]any, len(raw))
	conflicted := map[string]bool{}
	for original, value := range raw {
		key := strings.ToLower(strings.TrimSpace(original))
		switch key {
		case "lang":
			key = "language"
		case "audible_asin":
			key = "asin"
		case "albumartist":
			key = "album_artist"
		case "narrated_by":
			key = "narrator"
		case "series-part", "series_part", "mvin":
			key = "series_index"
		case "mvnm":
			key = "series"
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if previous, ok := tags[key]; ok && previous != value {
			conflicted[key] = true
		}
		tags[key] = value
	}
	conflicts := make([]string, 0, len(conflicted))
	for key := range conflicted {
		tags[key] = ""
		conflicts = append(conflicts, key)
	}
	sort.Strings(conflicts)
	if _, explicit := tags["narrator"]; !explicit {
		tags["narrator"] = tags["composer"]
	}
	return tags, conflicts
}

func splitMetadataNames(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == ';' || r == '\n' || r == '\r'
	})
}

type FileMetadata struct {
	Values         catalog.MetadataValues
	Series         string
	SeriesPosition string
	Narrators      []string
	ASIN           string
}

// InspectFileMetadata extracts reviewable catalog values from a validated local
// media path. Callers own path authorization and catalog write authorization.
func InspectFileMetadata(ctx context.Context, path, kind string, maxBytes int64) (FileMetadata, error) {
	if err := ctx.Err(); err != nil {
		return FileMetadata{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return FileMetadata{}, err
	}
	if !info.Mode().IsRegular() || maxBytes <= 0 || info.Size() > maxBytes {
		return FileMetadata{}, errors.New("metadata source exceeds file limit or is not regular")
	}
	var metadata map[string]any
	switch kind {
	case "epub":
		metadata, err = inspectEPUB(path, maxBytes)
	case "audio", "audiobook":
		probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		metadata, err = inspectAudio(probeCtx, path)
	default:
		return FileMetadata{}, errors.New("unsupported metadata media kind")
	}
	if err != nil {
		return FileMetadata{}, err
	}
	if err := ctx.Err(); err != nil {
		return FileMetadata{}, err
	}
	values := agreedEmbeddedMetadata([]map[string]any{metadata})
	values.Title, values.Author = proposalIdentityMetadata(proposalEntry{Kind: kind, Metadata: metadata})
	if len(values.Title) > 500 {
		values.Title = ""
	}
	if len(values.Author) > 500 {
		values.Author = ""
	}
	series, position, _ := agreedSeries([]map[string]any{metadata})
	_, _, narrators := catalogMetadata(metadata)
	tags, _ := metadata["tags"].(map[string]any)
	asin := metadataString(tags, "asin")
	if len(asin) > 100 {
		asin = ""
	}
	return FileMetadata{
		Values:         values,
		Series:         series,
		SeriesPosition: position,
		Narrators:      narrators,
		ASIN:           asin,
	}, nil
}

// Store only values on which the imported editions agree. A file's edition date
// is not a first-publication year, and arbitrary identifiers are not ISBNs.
func agreedEmbeddedMetadata(values []map[string]any) catalog.MetadataValues {
	fields := map[string]string{}
	conflicts := map[string]bool{}
	var subjects []string
	seenSubjects := map[string]bool{}
	for _, value := range values {
		for _, field := range metadataStrings(value["tag_conflicts"]) {
			conflicts[field] = true
		}
		tags, _ := value["tags"].(map[string]any)
		for _, field := range []string{"description", "publisher", "language", "isbn"} {
			candidate := metadataString(value, field)
			if candidate == "" {
				candidate = metadataString(tags, field)
			}
			_, explicitDescription := tags["description"]
			if field == "description" && candidate == "" && !explicitDescription {
				candidate = metadataString(tags, "comment")
			}
			if field == "isbn" && candidate == "" {
				for _, identifier := range metadataStrings(value["identifiers"]) {
					isbn := embeddedISBN(identifier)
					if candidate != "" && isbn != "" && candidate != isbn {
						conflicts[field] = true
					}
					if isbn != "" {
						candidate = isbn
					}
				}
			}
			if field == "isbn" {
				candidate = embeddedISBN(candidate)
			}
			if candidate == "" {
				continue
			}
			limit := 100
			if field == "publisher" {
				limit = 500
			}
			if field == "description" {
				candidate = catalog.MetadataDescription(candidate)
			} else if len(candidate) > limit {
				continue
			}
			if previous := fields[field]; previous != "" && previous != candidate {
				conflicts[field] = true
			}
			fields[field] = candidate
		}
		candidates := metadataStrings(value["subjects"])
		candidates = append(candidates, splitMetadataNames(metadataString(tags, "subject"))...)
		candidates = append(candidates, splitMetadataNames(metadataString(tags, "genre"))...)
		for _, subject := range candidates {
			subject = strings.TrimSpace(subject)
			key := strings.ToLower(subject)
			if subject == "" || len([]rune(subject)) > 200 || seenSubjects[key] || len(subjects) == 25 {
				continue
			}
			subjects = append(subjects, subject)
			seenSubjects[key] = true
		}
	}
	for field := range conflicts {
		delete(fields, field)
	}
	return catalog.MetadataValues{
		Description: fields["description"],
		ISBN:        fields["isbn"],
		Publisher:   fields["publisher"],
		Language:    fields["language"],
		Subjects:    subjects,
	}
}

func saveEmbeddedMetadata(ctx context.Context, tx *sql.Tx, workID string, values []map[string]any) error {
	metadata := agreedEmbeddedMetadata(values)
	if metadata.Description == "" && metadata.ISBN == "" && metadata.Publisher == "" && metadata.Language == "" && len(metadata.Subjects) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO work_metadata (
			work_id, source, description, isbn, publisher, language, subjects, updated_at
		) VALUES (?, 'embedded', ?, ?, ?, ?, ?, ?)
	`, workID, metadata.Description, metadata.ISBN, metadata.Publisher, metadata.Language, strings.Join(metadata.Subjects, ","), now)
	if err != nil {
		return fmt.Errorf("save embedded book metadata: %w", err)
	}
	for ordinal, subject := range metadata.Subjects {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO work_subjects (work_id, ordinal, subject) VALUES (?, ?, ?)
		`, workID, ordinal, subject); err != nil {
			return fmt.Errorf("save embedded book subject: %w", err)
		}
	}
	return nil
}

func metadataStrings(value any) []string {
	switch values := value.(type) {
	case []string:
		return values
	case []any:
		var result []string
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	}
	return nil
}

func embeddedISBN(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(strings.ToLower(value), "urn:isbn:") {
		value = value[len("urn:isbn:"):]
	}
	value = strings.NewReplacer("-", "", " ", "").Replace(value)
	if len(value) != 10 && len(value) != 13 {
		return ""
	}
	if len(value) == 13 && !strings.HasPrefix(value, "978") && !strings.HasPrefix(value, "979") {
		return ""
	}
	total := 0
	for i, digit := range value {
		n := int(digit - '0')
		if len(value) == 10 && i == 9 && (digit == 'X' || digit == 'x') {
			n = 10
		} else if digit < '0' || digit > '9' {
			return ""
		}
		if len(value) == 10 {
			total += (10 - i) * n
		} else if i%2 == 0 {
			total += n
		} else {
			total += 3 * n
		}
	}
	if (len(value) == 10 && total%11 != 0) || (len(value) == 13 && total%10 != 0) {
		return ""
	}
	return strings.ToUpper(value)
}
