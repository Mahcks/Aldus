package catalog

import "testing"

func TestLocatorCompletion(t *testing.T) {
	for _, test := range []struct {
		locator string
		percent int
		known   bool
	}{
		{`{"totalProgression":0.42}`, 42, true},
		{`{"locations":{"totalProgression":0}}`, 0, true},
		{`{"locations":{"totalProgression":1}}`, 100, true},
		{`{"locations":{"progression":0.9}}`, 0, false},
		{`{"totalProgression":2}`, 0, false},
		{`{"totalProgression":"0.5"}`, 0, false},
		{`{"cfi":"epubcfi(/6/2)"}`, 0, false},
	} {
		percent, known := locatorCompletion([]byte(test.locator))
		if percent != test.percent || known != test.known {
			t.Errorf("%s: got %d/%v, want %d/%v", test.locator, percent, known, test.percent, test.known)
		}
	}
}
