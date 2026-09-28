package source

import (
	"archive/zip"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestAudioTagAliasesPreserveEvidenceAndConflicts(t *testing.T) {
	tags, conflicts := normalizeAudioTags(map[string]string{
		"TITLE": "Book", "ARTIST": "Author", "NARRATOR": "Doe, Jane; John Smith\nThird Reader",
		"COMPOSER": "Fallback Reader", "MVNM": "Series", "series-part": "1.5",
		"LANG": "eng", "AUDIBLE_ASIN": "B012345678",
	})
	name, order, narrators := catalogMetadata(map[string]any{"tags": tags})
	if tags["language"] != "eng" || tags["asin"] != "B012345678" || len(conflicts) != 0 || name != "Series" || order != "1.5" || !reflect.DeepEqual(narrators, []string{"Doe, Jane", "John Smith", "Third Reader"}) {
		t.Fatalf("metadata: %q %q %v conflicts=%v", name, order, narrators, conflicts)
	}
	for range 20 {
		tags, conflicts = normalizeAudioTags(map[string]string{
			"NARRATOR": "One", "narrator": "Two", "COMPOSER": "Never select fallback",
			"MVNM": "One series", "series": "Other series",
		})
		if tags["narrator"] != "" || tags["series"] != "" || !reflect.DeepEqual(conflicts, []string{"narrator", "series"}) {
			t.Fatalf("conflict resolution: %v %v", tags, conflicts)
		}
	}
	tags, _ = normalizeAudioTags(map[string]string{"COMPOSER": "Fallback Reader"})
	_, _, narrators = catalogMetadata(map[string]any{"tags": tags})
	if !reflect.DeepEqual(narrators, []string{"Fallback Reader"}) {
		t.Fatalf("composer fallback: %v", narrators)
	}
}

func taggedAudio(t *testing.T, root, format string) string {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg required for embedded audio fixture")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe required for embedded audio fixture")
	}
	path := filepath.Join(root, "book."+format)
	args := []string{
		"-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "0.1",
		"-metadata", "TITLE=Book", "-metadata", "ARTIST=Author",
		"-metadata", "NARRATOR=Doe, Jane; John Smith", "-metadata", "COMPOSER=Fallback Reader",
		"-metadata", "DESCRIPTION=A complete description, including a second sentence.",
		"-metadata", "PUBLISHER=Fixture Press", "-metadata", "LANGUAGE=eng",
		"-metadata", "ISBN=978-0-306-40615-7", "-metadata", "ASIN=B012345678",
		"-metadata", "SERIES=Series", "-metadata", "SERIES-PART=1.5", "-metadata", "GENRE=Fiction; Adventure",
	}
	if format == "m4b" {
		args = append(args, "-c:a", "aac", "-movflags", "use_metadata_tags")
	}
	args = append(args, path)
	if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("create %s metadata fixture: %v: %s", format, err, output)
	}
	return path
}

func TestInspectFileMetadataRealAudio(t *testing.T) {
	for _, format := range []string{"flac", "mp3", "m4b"} {
		t.Run(format, func(t *testing.T) {
			path := taggedAudio(t, t.TempDir(), format)
			metadata, err := InspectFileMetadata(context.Background(), path, "audio", 1<<20)
			if err != nil {
				t.Fatal(err)
			}
			if metadata.Values.Title != "Book" || metadata.Values.Author != "Author" || metadata.Values.Description != "A complete description, including a second sentence." || metadata.Values.ISBN != "9780306406157" || metadata.Values.Publisher != "Fixture Press" || metadata.Values.Language != "eng" || metadata.Series != "Series" || metadata.SeriesPosition != "1.5" || metadata.ASIN != "B012345678" || !reflect.DeepEqual(metadata.Narrators, []string{"Doe, Jane", "John Smith"}) {
				t.Fatalf("extracted metadata: %+v", metadata)
			}
			if _, err := InspectFileMetadata(context.Background(), path, "audio", 1); err == nil {
				t.Fatal("oversized input accepted")
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if _, err := InspectFileMetadata(ctx, path, "audio", 1<<20); err == nil {
				t.Fatal("canceled inspection accepted")
			}
		})
	}
}

func TestEmbeddedMetadataImportsAndRescans(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		t.Run(map[bool]string{false: "reviewed", true: "automatic"}[automatic], func(t *testing.T) {
			store, db, root := outcomeFixture(t, "")
			if _, err := db.Exec(`UPDATE library_sources SET auto_import=?`, automatic); err != nil {
				t.Fatal(err)
			}
			path := taggedAudio(t, root, "flac")
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			runTestScan(t, store, "source", "metadata-scan")
			if !automatic {
				proposals, err := store.Proposals(context.Background(), auth.User{Admin: true}, "library")
				if err != nil || len(proposals) != 1 {
					t.Fatalf("proposals=%v err=%v", proposals, err)
				}
				proposal := proposals[0]
				_, err = store.AcceptProposal(context.Background(), auth.User{Admin: true}, "library", proposal.ID, AcceptRequest{
					ExpectedRevision: proposal.Revision, Title: proposal.Title, Author: proposal.Author,
					Items: []AcceptItem{{SourceEntryID: proposal.Items[0].EntryID, Kind: "audio", Label: "Audiobook"}},
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			var description, isbn, publisher, language, source, narrator string
			if err := db.QueryRow(`SELECT description,isbn,publisher,language,source FROM work_metadata`).Scan(&description, &isbn, &publisher, &language, &source); err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(description, "A complete description") || isbn != "9780306406157" || publisher != "Fixture Press" || language != "eng" || source != "embedded" {
				t.Fatalf("stored %q %q %q %q %q", description, isbn, publisher, language, source)
			}
			if err := db.QueryRow(`SELECT name FROM representation_narrators WHERE ordinal=0`).Scan(&narrator); err != nil || narrator != "Doe, Jane" {
				t.Fatalf("narrator=%q err=%v", narrator, err)
			}
			var raw string
			if err := db.QueryRow(`SELECT metadata_json FROM source_entries`).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var metadata map[string]any
			if err := json.Unmarshal([]byte(raw), &metadata); err != nil || metadata["raw_tags"].(map[string]any)["NARRATOR"] != "Doe, Jane; John Smith" {
				t.Fatalf("source evidence lost: %s %v", raw, err)
			}
			if _, err := db.Exec(`UPDATE work_metadata SET description='My manual description'; UPDATE representation_narrators SET name='My manual narrator' WHERE ordinal=0; INSERT INTO representation_state(user_id,representation_id,audio_timestamp_ms,revision,updated_at) SELECT 'user',id,1234,7,'2026-01-01T00:00:00Z' FROM representations`); err != nil {
				t.Fatal(err)
			}
			runTestScan(t, store, "source", "metadata-rescan")
			if err := db.QueryRow(`SELECT description FROM work_metadata`).Scan(&description); err != nil || description != "My manual description" {
				t.Fatalf("rescan replaced manual description: %q %v", description, err)
			}
			if err := db.QueryRow(`SELECT name FROM representation_narrators WHERE ordinal=0`).Scan(&narrator); err != nil || narrator != "My manual narrator" {
				t.Fatalf("rescan replaced manual narrator: %q %v", narrator, err)
			}
			var timestamp, revision int
			if err := db.QueryRow(`SELECT audio_timestamp_ms,revision FROM representation_state`).Scan(&timestamp, &revision); err != nil || timestamp != 1234 || revision != 7 {
				t.Fatalf("rescan changed playback position: %d revision=%d err=%v", timestamp, revision, err)
			}
			var works, media, alignments int
			if err := db.QueryRow(`SELECT (SELECT count(*) FROM works),(SELECT count(*) FROM media),(SELECT count(*) FROM alignments)`).Scan(&works, &media, &alignments); err != nil || works != 1 || media != 1 || alignments != 0 {
				t.Fatalf("catalog/progress side effects: %d %d %d err=%v", works, media, alignments, err)
			}
			after, err := os.ReadFile(path)
			if err != nil || string(before) != string(after) {
				t.Fatalf("source media mutated: %v", err)
			}
		})
	}
}

func TestInspectEmbeddedEPUBAndMetadataConflicts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.epub")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, body := range map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>`,
		"book.opf":               `<package><metadata><title>Book</title><creator>Author</creator><description>&lt;p&gt;A full &lt;em&gt;description&lt;/em&gt;.&lt;/p&gt;&lt;script&gt;hidden&lt;/script&gt;</description><subject>Fiction, contemporary</subject><subject>Adventure</subject><identifier>urn:isbn:9780306406157</identifier><language>eng</language><publisher>Fixture Press</publisher><date>2020-01-01</date></metadata><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
		"chapter.xhtml":          `<html><body>Fixture text</body></html>`,
	} {
		writer, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	metadata, err := InspectFileMetadata(context.Background(), path, "epub", 1<<20)
	if err != nil || metadata.Values.Title != "Book" || metadata.Values.Author != "Author" || metadata.Values.Description != "A full description." || metadata.Values.ISBN != "9780306406157" || metadata.Values.FirstPublishYear != 0 || !reflect.DeepEqual(metadata.Values.Subjects, []string{"Fiction, contemporary", "Adventure"}) {
		t.Fatalf("EPUB metadata=%+v err=%v", metadata, err)
	}
	values := agreedEmbeddedMetadata([]map[string]any{
		{"description": "First", "publisher": "One", "language": "eng", "identifiers": []string{"urn:isbn:9780306406157"}},
		{"description": "Second", "publisher": "Two", "language": "eng", "identifiers": []string{"9780306406158", "unknown-id"}},
	})
	if values.Description != "" || values.Publisher != "" || values.Language != "eng" || values.ISBN != "9780306406157" {
		t.Fatalf("ambiguous metadata was guessed: %+v", values)
	}
}

func TestAudioProbeOutputBound(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("POSIX shell required for bounded child-output fixture")
	}
	if _, err := boundedProbeOutput(exec.Command("sh", "-c", "head -c 1048577 /dev/zero")); err == nil || err.Error() != "audio metadata exceeds limit" {
		t.Fatalf("unbounded audio probe output: %v", err)
	}
}

func TestAcceptedProposalSurvivesParserMetadataUpgrade(t *testing.T) {
	for _, changedIdentity := range []bool{false, true} {
		t.Run(map[bool]string{false: "same identity", true: "normalized identity"}[changedIdentity], func(t *testing.T) {
			ctx := context.Background()
			store, db, root := outcomeFixture(t, "")
			store.maxBytes = 16 << 20
			if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at) VALUES('ordinary','source','completed','2026-01-01')`); err != nil {
				t.Fatal(err)
			}
			registerProposalMedia(t, store, root, "ordinary", "book.epub", "epub", "Book")
			if err := store.GenerateProposals(ctx, "library"); err != nil {
				t.Fatal(err)
			}
			proposal := onlyProposal(t, store)
			workID, err := store.AcceptProposal(ctx, auth.User{Admin: true}, "library", proposal.ID, AcceptRequest{
				ExpectedRevision: proposal.Revision,
				Title:            "My curated title", Author: "My curated author",
				Items: []AcceptItem{{SourceEntryID: proposal.Items[0].EntryID, Kind: "epub", Label: "EPUB"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			title := "Book"
			if changedIdentity {
				title = "Better extracted title"
			}
			if _, err := db.Exec(`UPDATE source_entries SET metadata_json=json_set(metadata_json,'$.description','Newly extracted synopsis','$.title',?)`, title); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := store.GenerateProposals(ctx, "library"); err != nil {
					t.Fatal(err)
				}
				proposals, err := store.Proposals(ctx, auth.User{Admin: true}, "library")
				if err != nil || len(proposals) != 0 {
					t.Fatalf("parser upgrade reopened accepted files: %+v %v", proposals, err)
				}
			}
			var acceptedID, decision, storedTitle string
			if err := db.QueryRow(`SELECT accepted_work_id,decision FROM import_groups WHERE id=?`, proposal.ID).Scan(&acceptedID, &decision); err != nil || acceptedID != workID || decision != "accepted" {
				t.Fatalf("accepted binding changed: %q %q %v", acceptedID, decision, err)
			}
			if err := db.QueryRow(`SELECT title FROM works WHERE id=?`, workID).Scan(&storedTitle); err != nil || storedTitle != "My curated title" {
				t.Fatalf("parser upgrade replaced curated metadata: %q %v", storedTitle, err)
			}
		})
	}
}
