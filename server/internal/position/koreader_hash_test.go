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
		data[i] = byte(i*i + i/251)
	}
	got, err := KOReaderPartialMD5(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if got != "c3f6cf5339d36df99d4d616fe215e768" {
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
	const want = "abb11be65399f96116fd90ab861dda0e"
	if got != want {
		t.Fatalf("Alice partial MD5 = %s, want %s", got, want)
	}
}
