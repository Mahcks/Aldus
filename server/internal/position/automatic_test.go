package position

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAliceAutomaticAlignmentCandidate(t *testing.T) {
	root := filepath.Join("..", "..", "..", "test-fixtures", "alice", "automatic")
	for _, name := range []string{".", "whisperx", "hybrid-whisperx", "forced-aligner-mfa"} {
		t.Run(name, func(t *testing.T) { validateAutomaticCandidate(t, filepath.Join(root, name)) })
	}
}

func TestAliceWhisperXBoundaryAnalysis(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "test-fixtures", "alice", "automatic", "whisperx", "boundary-analysis.json"))
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		Rows []struct {
			Golden      int64 `json:"golden_ms"`
			WordStart   int64 `json:"word_start_ms"`
			SignedError int64 `json:"signed_error_ms"`
		} `json:"rows"`
		Variants map[string]struct {
			Anchors int `json:"anchors"`
		} `json:"variants"`
	}
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Rows) != 10 {
		t.Fatalf("analyzed %d anchors, want 10", len(report.Rows))
	}
	for index, row := range report.Rows {
		if row.SignedError != row.WordStart-row.Golden {
			t.Fatalf("anchor %d has inconsistent signed error", index)
		}
	}
	for _, name := range []string{"word_start", "first_ctc_character_end", "word_end", "acoustic_onset"} {
		if report.Variants[name].Anchors != 10 {
			t.Fatalf("variant %q did not evaluate all anchors", name)
		}
	}
}

func TestAliceAudibleOnsetFixture(t *testing.T) {
	root := filepath.Join("..", "..", "..", "test-fixtures", "alice")
	data, err := os.ReadFile(filepath.Join(root, "onset-anchors.json"))
	if os.IsNotExist(err) {
		t.Skip("ten human audible-onset annotations have not been exported yet")
	}
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Version     int    `json:"version"`
		Semantics   string `json:"semantics"`
		EPUBSHA256  string `json:"epub_sha256"`
		AudioSHA256 string `json:"audio_sha256"`
		Anchors     []struct {
			ID                 string `json:"anchor_id"`
			ManualSeek         int64  `json:"manual_seek_timestamp_ms"`
			AudibleOnset       int64  `json:"audible_onset_timestamp_ms"`
			OpeningWord        string `json:"opening_word"`
			Notes              string `json:"annotation_notes"`
			ManualMinusOnsetMS int64  `json:"manual_minus_onset_ms"`
		} `json:"anchors"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Version != 1 || fixture.Semantics != "earliest point at which the opening spoken word audibly begins" || fixture.EPUBSHA256 != "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c" || fixture.AudioSHA256 != "6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a" {
		t.Fatal("audible-onset fixture has the wrong semantics or media revision")
	}
	if len(fixture.Anchors) != 10 {
		t.Fatalf("audible-onset fixture contains %d anchors, want 10", len(fixture.Anchors))
	}
	manualData, err := os.ReadFile(filepath.Join(root, "anchors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manual anchorFixture
	if err := json.Unmarshal(manualData, &manual); err != nil {
		t.Fatal(err)
	}
	manualByID := make(map[string]int64, len(manual.Anchors))
	for _, anchor := range manual.Anchors {
		manualByID[anchor.ID] = anchor.Audio.TimestampMS
	}
	seen := make(map[string]bool, 10)
	for _, anchor := range fixture.Anchors {
		if seen[anchor.ID] || manualByID[anchor.ID] != anchor.ManualSeek || anchor.OpeningWord == "" || anchor.Notes == "" || anchor.AudibleOnset <= 0 || anchor.ManualSeek-anchor.AudibleOnset != anchor.ManualMinusOnsetMS {
			t.Fatalf("invalid audible-onset annotation for %q", anchor.ID)
		}
		seen[anchor.ID] = true
	}
}

func TestAliceWhisperXOnsetEvaluation(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "test-fixtures", "alice", "automatic", "whisperx", "onset-evaluation.json"))
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		Rows []struct {
			Human int64 `json:"audible_onset_timestamp_ms"`
			Word  struct {
				Generated int64 `json:"generated_timestamp_ms"`
				Signed    int64 `json:"signed_error_ms"`
				Absolute  int64 `json:"absolute_error_ms"`
			} `json:"whisperx_word_start"`
		} `json:"rows"`
		Metrics struct {
			Word struct {
				MedianAbsolute float64 `json:"median_absolute_error_ms"`
				Within250      int     `json:"within_250_ms"`
				Over1000       int     `json:"over_1000_ms"`
			} `json:"whisperx_word_start"`
		} `json:"metrics"`
	}
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Rows) != 10 || report.Metrics.Word.MedianAbsolute != 230.5 || report.Metrics.Word.Within250 != 8 || report.Metrics.Word.Over1000 != 0 {
		t.Fatalf("unexpected onset metrics: rows=%d metrics=%+v", len(report.Rows), report.Metrics.Word)
	}
	for index, row := range report.Rows {
		if row.Word.Signed != row.Word.Generated-row.Human || row.Word.Absolute != abs64(row.Word.Signed) {
			t.Fatalf("onset row %d has inconsistent errors", index)
		}
	}
}

func abs64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func validateAutomaticCandidate(t *testing.T, root string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "alignment.json"))
	if err != nil {
		t.Fatal(err)
	}
	var candidate struct {
		State       string `json:"state"`
		EPUBSHA256  string `json:"epub_sha256"`
		AudioSHA256 string `json:"audio_sha256"`
		Segments    []struct {
			Text string `json:"normalized_text"`
			EPUB struct {
				Href  string `json:"href"`
				Start struct {
					Path string `json:"dom_path"`
				} `json:"start"`
				End struct {
					Path string `json:"dom_path"`
				} `json:"end"`
			} `json:"epub"`
			Audio struct {
				Start int64 `json:"start_ms"`
				End   int64 `json:"end_ms"`
			} `json:"audio"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(data, &candidate); err != nil {
		t.Fatal(err)
	}
	if candidate.State != "candidate" || candidate.EPUBSHA256 != "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c" || candidate.AudioSHA256 != "6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a" {
		t.Fatal("automatic alignment references a different media revision")
	}
	for index, segment := range candidate.Segments {
		if segment.Text == "" || segment.EPUB.Href == "" || segment.EPUB.Start.Path == "" || segment.EPUB.End.Path == "" || segment.Audio.End <= segment.Audio.Start {
			t.Fatalf("segment %d is incomplete", index)
		}
		if index > 0 && segment.Audio.Start < candidate.Segments[index-1].Audio.Start {
			t.Fatalf("segment %d moves backward in audio", index)
		}
	}

	evaluation, err := os.ReadFile(filepath.Join(root, "evaluation.json"))
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		Anchors []struct {
			Restored bool `json:"restored_text_match"`
		} `json:"anchors"`
	}
	if err := json.Unmarshal(evaluation, &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Anchors) != 10 {
		t.Fatalf("evaluated %d anchors, want 10", len(report.Anchors))
	}
	for index, anchor := range report.Anchors {
		if !anchor.Restored {
			t.Fatalf("anchor %d did not restore the exact passage", index)
		}
	}
}
