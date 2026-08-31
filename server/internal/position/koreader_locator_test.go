package position

import (
	"errors"
	"testing"
)

func TestKOReaderLocatorRoundTrip(t *testing.T) {
	raw := MarshalKOReaderParagraph(EPUBParagraph{
		KOReaderFragment: 3,
		KOReaderNodes: []KOReaderTextNode{
			{Path: "html[1]/body[1]/div[1]/p[1]/text()[1]", Text: "Alice  was "},
			{Path: "html[1]/body[1]/div[1]/p[1]/em[1]/text()[1]", Text: "very"},
			{Path: "html[1]/body[1]/div[1]/p[1]/text()[2]", Text: " tired."},
		},
	})

	const offset = 500_000
	xpointer, err := canonicalToKOReader(raw, offset)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := koReaderToCanonical(raw, xpointer)
	if err != nil {
		t.Fatal(err)
	}
	if difference := resolved - offset; difference < -60_000 || difference > 60_000 {
		t.Fatalf("round trip %q resolved to %d, want near %d", xpointer, resolved, offset)
	}

	resolved, err = koReaderToCanonical(raw, "/body/DocFragment[3]/body/div/p/text().7")
	if err != nil || resolved == 0 {
		t.Fatalf("legacy XPointer resolved to %d, %v", resolved, err)
	}
}

func TestKOReaderRangeDoesNotClaimSiblingText(t *testing.T) {
	paragraph := EPUBParagraph{KOReaderFragment: 2, KOReaderNodes: []KOReaderTextNode{
		{Path: "html[1]/body[1]/p[1]/text()[1]", Text: "Before and "},
		{Path: "html[1]/body[1]/p[1]/em[1]/text()[1]", Text: "inside after"},
	}}
	raw, err := MarshalKOReaderRange(paragraph, "html[1]/body[1]/p[1]/em[1]/text()[1]", 0, "html[1]/body[1]/p[1]/em[1]/text()[1]", 6)
	if err != nil {
		t.Fatal(err)
	}
	xpointer, err := canonicalToKOReader(raw, 0)
	if err != nil || xpointer != "/body/DocFragment[2]/body[1]/p[1]/em[1]/text()[1].0" {
		t.Fatalf("range start = %q, %v", xpointer, err)
	}
	if _, err := koReaderToCanonical(raw, "/body/DocFragment[2]/body/p/text().2"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("sibling text resolved: %v", err)
	}
	if _, err := koReaderToCanonical(raw, "/body/DocFragment[2]/body/p/em/text().8"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("later text resolved: %v", err)
	}
	if _, err := MarshalKOReaderRange(paragraph, paragraph.KOReaderNodes[0].Path, 0, paragraph.KOReaderNodes[0].Path, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty range accepted: %v", err)
	}
}

func TestKOReaderHeading(t *testing.T) {
	fragment, ok := koReaderHeading("/body/DocFragment[3]/body/div/h2/text()[1].0")
	if !ok || fragment != 3 {
		t.Fatalf("heading = %d, %v", fragment, ok)
	}
	if _, ok := koReaderHeading("/body/DocFragment[3]/body/div/p[1]/text().0"); ok {
		t.Fatal("paragraph classified as heading")
	}
}

func TestKOReaderStructuralStart(t *testing.T) {
	for _, xpointer := range []string{
		"/body/DocFragment[4].0",
		"/body/DocFragment[4]/body/div.0",
		"/body/DocFragment[4]/body/section[1].0",
		"/body/DocFragment[4]/body/div/h2/text()[1].0",
	} {
		fragment, ok := koReaderStructuralStart(xpointer)
		if !ok || fragment != 4 {
			t.Fatalf("structural start %q = %d, %v", xpointer, fragment, ok)
		}
	}
	if _, ok := koReaderStructuralStart("/body/DocFragment[4]/body/div.2"); ok {
		t.Fatal("nonzero container offset classified as structural start")
	}
	if fragment, _, _, ok := parseKOReaderXPointer("/body/DocFragment/body/p/text().3"); !ok || fragment != 1 {
		t.Fatalf("unindexed first fragment = %d, %v", fragment, ok)
	}
}

func TestKOReaderObservedXPointerForms(t *testing.T) {
	tests := []struct {
		name       string
		xpointer   string
		fragment   int
		structural bool
	}{
		{"document fragment", "/body/DocFragment[30].0", 30, true},
		{"nested emphasized text", "/body/DocFragment[12]/body/p[23]/em/text().5", 12, false},
		{"unindexed first fragment", "/body/DocFragment/body/p/text().3", 1, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fragment, _, _, ok := parseKOReaderXPointer(test.xpointer)
			if !ok || fragment != test.fragment {
				t.Fatalf("parse %q = fragment %d, %v", test.xpointer, fragment, ok)
			}
			_, structural := koReaderStructuralStart(test.xpointer)
			if structural != test.structural {
				t.Fatalf("structural %q = %v, want %v", test.xpointer, structural, test.structural)
			}
		})
	}
}
