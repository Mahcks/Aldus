package position

import "testing"

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
}
