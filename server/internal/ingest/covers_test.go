package ingest

import (
	"archive/zip"
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestExtractM4BAttachedArtwork(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	root := t.TempDir()
	art := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := range 64 {
		for x := range 64 {
			art.Set(x, y, color.RGBA{R: 40, G: 120, B: 70, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, art); err != nil {
		t.Fatal(err)
	}
	coverPath := filepath.Join(root, "cover.png")
	if err := os.WriteFile(coverPath, encoded.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	audioPath := filepath.Join(root, "book.m4b")
	command := exec.CommandContext(ctx, "ffmpeg", "-v", "error",
		"-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-i", coverPath,
		"-map", "0:a", "-map", "1:v", "-c:a", "aac", "-c:v", "copy",
		"-disposition:v", "attached_pic", "-t", "0.1", audioPath)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("create audiobook with artwork: %v: %s", err, output)
	}
	data, contentType, err := extractAudioCover(ctx, audioPath)
	if err != nil || contentType != "image/jpeg" {
		t.Fatalf("extract embedded cover: type=%q err=%v", contentType, err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil || decoded.Bounds().Dx() != 64 || decoded.Bounds().Dy() != 64 {
		t.Fatalf("invalid extracted artwork: %v", err)
	}
}

func TestCoversReleasesQueryConnectionBeforeMediaLookup(t *testing.T) {
	s := testSetup(t)
	var workID string
	if err := s.store.db.QueryRow(`SELECT work_id FROM representations WHERE id=?`, s.epubID).Scan(&workID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if covers, err := s.store.Covers(ctx, s.admin, workID); err != nil || len(covers) != 0 {
		t.Fatalf("covers = %#v, %v", covers, err)
	}
}

func TestExtractEPUBCover(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "cover-*.epub")
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, value := range map[string]string{
		"META-INF/container.xml": `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>`,
		"OPS/book.opf":           `<?xml version="1.0"?><package><metadata><meta name="cover" content="art"/></metadata><manifest><item id="art" href="cover.jpg" media-type="image/jpeg"/></manifest></package>`,
		"OPS/cover.jpg":          "not-decoded-here",
	} {
		entry, _ := archive.Create(name)
		_, _ = entry.Write([]byte(value))
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	data, contentType, err := extractEPUBCover(file)
	if err != nil || string(data) != "not-decoded-here" || contentType != "image/jpeg" {
		t.Fatalf("cover = %q %q, %v", data, contentType, err)
	}
}
