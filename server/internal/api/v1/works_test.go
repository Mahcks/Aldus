package v1

import "testing"

func TestCoverMediaFormat(t *testing.T) {
	cases := map[string]string{
		"epub":      "ebook",
		"audio":     "audiobook",
		"audiobook": "audiobook",
	}
	for kind, want := range cases {
		if got := coverMediaFormat(kind); got != want {
			t.Errorf("coverMediaFormat(%q) = %q, want %q", kind, got, want)
		}
	}
}

func TestFormatMatches(t *testing.T) {
	cases := []struct {
		requested, mediaFormat string
		want                   bool
	}{
		// The library cover browses every embedded cover, ebook and audiobook alike.
		{requested: "", mediaFormat: "ebook", want: true},
		{requested: "", mediaFormat: "audiobook", want: true},
		// A format-specific tab only ever offers its own kind of embedded cover —
		// this is the fix for "Audiobook cover" offering the ebook's artwork.
		{requested: "ebook", mediaFormat: "ebook", want: true},
		{requested: "ebook", mediaFormat: "audiobook", want: false},
		{requested: "audiobook", mediaFormat: "audiobook", want: true},
		{requested: "audiobook", mediaFormat: "ebook", want: false},
	}
	for _, c := range cases {
		if got := formatMatches(c.requested, c.mediaFormat); got != c.want {
			t.Errorf("formatMatches(%q, %q) = %v, want %v", c.requested, c.mediaFormat, got, c.want)
		}
	}
}
