package position

import (
	"encoding/json"
	"testing"
)

func TestCanonicalJSONContract(t *testing.T) {
	data, err := json.Marshal(Canonical{AlignmentID: "alignment", SegmentID: "segment", Offset: 42})
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"alignment_id":"alignment","segment_id":"segment","offset":42,"updated_at":"0001-01-01T00:00:00Z"}`
	if string(data) != want {
		t.Fatalf("canonical JSON = %s, want %s", data, want)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"alignment_id", "segment_id", "offset", "updated_at"} {
		if _, ok := fields[name]; !ok {
			t.Fatalf("canonical JSON missing %q", name)
		}
	}
}
