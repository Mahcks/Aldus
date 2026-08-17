package ingest

import "testing"

func TestParseAudioChapters(t *testing.T) {
	chapters, err := parseAudioChapters([]byte(`{"chapters":[{"start_time":"0.000000","end_time":"12.345000","tags":{"title":"Opening"}},{"start_time":"12.345000","end_time":"60.000000","tags":{}}],"format":{"duration":"60.000000"}}`), "book.m4b")
	if err != nil {
		t.Fatal(err)
	}
	if len(chapters) != 2 || chapters[0].Title != "Opening" || chapters[0].EndMS != 12345 || chapters[1].Title != "Chapter 2" || chapters[1].StartMS != 12345 || chapters[1].EndMS != 60000 {
		t.Fatalf("chapters = %#v", chapters)
	}
}

func TestParseAudioChaptersFallsBackToFileBoundary(t *testing.T) {
	chapters, err := parseAudioChapters([]byte(`{"chapters":[],"format":{"duration":"90.25"}}`), "01 - Arrival.mp3")
	if err != nil {
		t.Fatal(err)
	}
	if len(chapters) != 1 || chapters[0].Title != "01 - Arrival" || chapters[0].StartMS != 0 || chapters[0].EndMS != 90250 {
		t.Fatalf("chapters = %#v", chapters)
	}
}

func TestParseAudioChaptersRejectsOverlappingBoundaries(t *testing.T) {
	_, err := parseAudioChapters([]byte(`{"chapters":[{"start_time":"0","end_time":"20"},{"start_time":"10","end_time":"30"}],"format":{"duration":"30"}}`), "book.m4b")
	if err == nil {
		t.Fatal("expected overlapping chapters to fail")
	}
}

func TestBoundedBufferCapsProbeOutput(t *testing.T) {
	buffer := boundedBuffer{remaining: 4}
	value := "oversized"
	if written, err := buffer.Write([]byte(value)); err != nil || written != len(value) {
		t.Fatalf("write = %d, %v", written, err)
	}
	if !buffer.truncated || buffer.String() != "over" {
		t.Fatalf("buffer = %q truncated=%v", buffer.String(), buffer.truncated)
	}
}
