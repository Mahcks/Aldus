package source

import "testing"

func TestAudioIdentityMetadataCorroboratedUnabridgedAlbum(t *testing.T) {
	// Exact metadata recorded for the downloaded Sunrise audiobook. The deployed
	// acquisition checker compares normalize(identityMetadata(entry)) with the
	// request; it does not compare the embedded title tag directly.
	entry := proposalEntry{Kind: "audio", Metadata: map[string]any{
		"duration_ms": 46112251,
		"tags": map[string]any{
			"album":        "Sunrise on the Reaping (Unabridged)",
			"album_artist": "Suzanne Collins",
			"artist":       "Suzanne Collins",
			"composer":     "Jefferson White",
			"date":         "2025",
			"title":        "Sunrise on the Reaping",
		},
	}}
	title, author := identityMetadata(entry)
	if normalize(title) != normalize("Sunrise on the Reaping") || normalize(author) != normalize("Suzanne Collins") {
		t.Fatalf("embedded identity does not confirm requested book: title=%q author=%q", title, author)
	}
	if entry.Metadata["tags"].(map[string]any)["album"] != "Sunrise on the Reaping (Unabridged)" {
		t.Fatal("raw album evidence was changed")
	}
}

func TestAudioIdentityMetadataPreservesAlbumAndEditionEvidence(t *testing.T) {
	for _, tt := range []struct {
		name, album, track, want string
	}{
		{"chapter title", "Sunrise on the Reaping (Unabridged)", "Chapter 1", "Sunrise on the Reaping (Unabridged)"},
		{"other book", "Catching Fire (Unabridged)", "Sunrise on the Reaping", "Catching Fire (Unabridged)"},
		{"conflicting abridgment", "Sunrise on the Reaping (Abridged)", "Sunrise on the Reaping", "Sunrise on the Reaping (Abridged)"},
		{"conflicting title abridgment", "Sunrise on the Reaping (Unabridged)", "Sunrise on the Reaping (Abridged)", "Sunrise on the Reaping (Unabridged)"},
		{"contradictory album labels", "Sunrise on the Reaping (Abridged) (Unabridged)", "Sunrise on the Reaping (Abridged)", "Sunrise on the Reaping (Abridged) (Unabridged)"},
		{"different edition", "Sunrise on the Reaping (Revised Edition)", "Sunrise on the Reaping", "Sunrise on the Reaping (Revised Edition)"},
		{"different narration", "Sunrise on the Reaping (Jefferson White)", "Sunrise on the Reaping", "Sunrise on the Reaping (Jefferson White)"},
		{"missing title", "Sunrise on the Reaping (Unabridged)", "", "Sunrise on the Reaping (Unabridged)"},
		{"missing album", "", "Sunrise on the Reaping", "Sunrise on the Reaping"},
		{"unmarked word retained", "Sunrise on the Reaping Unabridged", "Sunrise on the Reaping", "Sunrise on the Reaping Unabridged"},
		{"corroborated case and punctuation", "SUNRISE ON THE REAPING (UNABRIDGED)", "Sunrise on the Reaping", "Sunrise on the Reaping"},
		{"corroborated edition retained", "Sunrise on the Reaping (Revised Edition) (Unabridged)", "Sunrise on the Reaping (Revised Edition)", "Sunrise on the Reaping (Revised Edition)"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			entry := proposalEntry{Kind: "audio", Metadata: map[string]any{"tags": map[string]any{
				"album": tt.album, "title": tt.track, "album_artist": "Other Author", "artist": "Other Author",
			}}}
			title, author := identityMetadata(entry)
			if title != tt.want || author != "Other Author" {
				t.Fatalf("identity=(%q, %q), want=(%q, Other Author)", title, author, tt.want)
			}
		})
	}
}

func TestAudioIdentityMetadataDoesNotReconcileConflictingAuthors(t *testing.T) {
	entry := proposalEntry{Kind: "audio", Metadata: map[string]any{"tags": map[string]any{
		"album": "Sunrise on the Reaping (Unabridged)", "title": "Sunrise on the Reaping",
		"album_artist": "Other Author", "artist": "Suzanne Collins",
	}}}
	title, author := identityMetadata(entry)
	if title != "Sunrise on the Reaping (Unabridged)" || author != "Other Author" {
		t.Fatalf("conflicting embedded authors must not enable title reconciliation: %q, %q", title, author)
	}
}
