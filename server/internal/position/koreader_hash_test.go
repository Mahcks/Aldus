package position

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestKOReaderPartialMD5(t *testing.T) {
	data := make([]byte, 20_000)
	for i := range data {
		data[i] = byte(i)
	}
	got, err := KOReaderPartialMD5(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if got != "2bcd3c4de20c918e19fab5c36249c70d" {
		t.Fatalf("partial MD5 = %s", got)
	}
}

func TestAliceKOReaderPartialMD5(t *testing.T) {
	path := filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice.epub")
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		t.Skip("run test-fixtures/alice/fetch.sh for the real-media vector")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	got, err := KOReaderPartialMD5(file)
	if err != nil {
		t.Fatal(err)
	}
	const want = "efbf04efc9d43ecd89a033b329f49bdb"
	if got != want {
		t.Fatalf("Alice partial MD5 = %s, want %s", got, want)
	}
}
