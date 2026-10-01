package ingest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func chapteredAudio(t *testing.T) []byte {
	t.Helper()
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s is required: %v", tool, err)
		}
	}
	dir := t.TempDir()
	metadata := filepath.Join(dir, "chapters.txt")
	if err := os.WriteFile(metadata, []byte(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Two\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "book.m4b")
	command := exec.Command("ffmpeg", "-nostdin", "-v", "error",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
		"-f", "ffmetadata", "-i", metadata,
		"-map", "0:a:0", "-map_metadata", "1", "-map_chapters", "1",
		"-c:a", "aac", "-movflags", "+faststart", path,
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("generate chaptered audio: %v: %s", err, output)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func uploadPlaybackAudio(t *testing.T, s *setup, content []byte, name string) Media {
	t.Helper()
	s.store.probe = ffprobe
	media, err := s.store.Upload(context.Background(), s.admin, s.libraryID, s.audioID, name, bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	return media
}

func packetHash(t *testing.T, path string) []byte {
	t.Helper()
	command := exec.Command("ffmpeg", "-nostdin", "-v", "error", "-i", path,
		"-map", "0:a:0", "-c", "copy", "-f", "streamhash", "-hash", "sha256", "-",
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("hash audio packets: %v: %s", err, output)
	}
	return output
}

func TestPlaybackCopiesAudioAndPreservesOriginal(t *testing.T) {
	content := chapteredAudio(t)
	s := testSetup(t)
	ctx := context.Background()
	media := uploadPlaybackAudio(t, s, content, "book.m4b")
	original, _, err := s.store.Open(ctx, s.admin, media.ID)
	if err != nil {
		t.Fatal(err)
	}
	originalPath := original.Name()
	original.Close()
	before, err := probePlayback(ctx, originalPath)
	if err != nil {
		t.Fatal(err)
	}
	originalAudio, eligible := before.chapterAudio()
	if !eligible {
		t.Fatalf("fixture is not eligible: %+v", before)
	}

	playback, result, err := s.store.OpenPlayback(ctx, s.reader, media.ID)
	if err != nil {
		t.Fatal(err)
	}
	playbackPath := playback.Name()
	playback.Close()
	if playbackPath == originalPath || result.SHA256 != media.SHA256 || result.ID != media.ID || result.OriginalFilename != "playback.m4a" {
		t.Fatalf("unexpected playback: %q %+v", playbackPath, result)
	}
	after, err := probePlayback(ctx, playbackPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Streams) != 1 || len(after.Chapters) != 0 || after.Streams[0] != originalAudio {
		t.Fatalf("audio timing changed: before=%+v after=%+v", before, after)
	}
	if !bytes.Equal(packetHash(t, originalPath), packetHash(t, playbackPath)) {
		t.Fatal("audio packets changed")
	}
	unchanged, err := os.ReadFile(originalPath)
	if err != nil || !bytes.Equal(unchanged, content) {
		t.Fatalf("original changed: %v", err)
	}
	chapters, err := s.store.AudioChapters(ctx, s.reader, media.ID)
	if err != nil || len(chapters) != 2 || chapters[1].Title != "Two" {
		t.Fatalf("original chapter navigation changed: %+v %v", chapters, err)
	}

	// Published output needs no external tools, but every read still checks access and the source.
	t.Setenv("PATH", t.TempDir())
	cached, cachedMedia, err := s.store.OpenPlayback(ctx, s.reader, media.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cached.Name() != playbackPath || cachedMedia != result {
		t.Fatalf("cache was not reused: %q %+v", cached.Name(), cachedMedia)
	}
	cached.Close()
	if file, _, err := s.store.OpenPlayback(ctx, s.outsider, media.ID); !errors.Is(err, ErrNotFound) {
		if file != nil {
			file.Close()
		}
		t.Fatalf("cached playback bypassed access control: %v", err)
	}
	if err := os.Remove(originalPath); err != nil {
		t.Fatal(err)
	}
	if file, _, err := s.store.OpenPlayback(ctx, s.reader, media.ID); err == nil {
		file.Close()
		t.Fatal("cached playback bypassed source availability check")
	}
}

func TestPlaybackUnsupportedAudioUsesOriginalAndCachesDecision(t *testing.T) {
	content := chapteredAudio(t)
	s := testSetup(t)
	media := uploadPlaybackAudio(t, s, content, "book.m4b")
	playback, _, err := s.store.OpenPlayback(context.Background(), s.admin, media.ID)
	if err != nil {
		t.Fatal(err)
	}
	withoutChapters, err := io.ReadAll(playback)
	playback.Close()
	if err != nil {
		t.Fatal(err)
	}
	plain := uploadPlaybackAudio(t, s, withoutChapters, "plain.m4a")
	file, result, err := s.store.OpenPlayback(context.Background(), s.reader, plain.ID)
	if err != nil {
		t.Fatal(err)
	}
	originalPath := file.Name()
	file.Close()
	if result != plain {
		t.Fatalf("unsupported media metadata changed: %+v", result)
	}
	t.Setenv("PATH", t.TempDir())
	file, _, err = s.store.OpenPlayback(context.Background(), s.reader, plain.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if file.Name() != originalPath {
		t.Fatal("unsupported file was replaced")
	}
}

func TestPlaybackFailureAndCancellationLeaveNoPartialFile(t *testing.T) {
	content := chapteredAudio(t)
	s := testSetup(t)
	media := uploadPlaybackAudio(t, s, content, "book.m4b")
	probe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Fatal(err)
	}
	tools := t.TempDir()
	if err := os.Symlink(probe, filepath.Join(tools, "ffprobe")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tools, "ffmpeg"), []byte("#!/bin/sh\nexit 1\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", tools)
	if file, _, err := s.store.OpenPlayback(context.Background(), s.admin, media.ID); !errors.Is(err, ErrPlaybackUnavailable) {
		if file != nil {
			file.Close()
		}
		t.Fatalf("failed remux returned wrong error: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(s.root, "playback-v1"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("failed remux left files: %v %v", entries, err)
	}

	// Cancel the preparation directly so the check exercises its occupied slot.
	original, _, err := s.store.Open(context.Background(), s.admin, media.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer original.Close()
	s.store.playback <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.store.playbackPath(ctx, original, media); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled request returned %v", err)
	}
	<-s.store.playback
	entries, err = os.ReadDir(filepath.Join(s.root, "playback-v1"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("canceled remux left files: %v %v", entries, err)
	}
}

func TestPlaybackSnapshotUsesOpenFileAndRejectsChangedBytes(t *testing.T) {
	content := []byte("authorized original bytes")
	dir := t.TempDir()
	source := filepath.Join(dir, "source.m4b")
	if err := os.WriteFile(source, content, 0o600); err != nil {
		t.Fatal(err)
	}
	original, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer original.Close()
	hash := sha256.Sum256(content)
	media := Media{SHA256: hex.EncodeToString(hash[:]), SizeBytes: int64(len(content))}
	if err := os.Rename(source, source+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("replacement path bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	cache := t.TempDir()
	snapshot, err := snapshotPlayback(context.Background(), original, media, cache)
	if err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(snapshot)
	if err != nil || !bytes.Equal(copied, content) {
		t.Fatalf("snapshot followed replaced path: %q %v", copied, err)
	}
	if err := os.Remove(snapshot); err != nil {
		t.Fatal(err)
	}

	// Same-size in-place changes must never publish under the old source hash.
	changed := bytes.Repeat([]byte("x"), len(content))
	if err := os.WriteFile(source+".old", changed, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := snapshotPlayback(context.Background(), original, media, cache); !errors.Is(err, ErrNotFound) {
		t.Fatalf("changed source accepted: %v", err)
	}
	entries, err := os.ReadDir(cache)
	if err != nil || len(entries) != 0 {
		t.Fatalf("invalid snapshot left files: %v %v", entries, err)
	}
}

type canceledPlaybackCopy struct {
	context.Context
	checks int
}

func (c *canceledPlaybackCopy) Err() error {
	c.checks++
	if c.checks > 1 {
		return context.Canceled
	}
	return nil
}

func TestPlaybackCanceledSnapshotRemovesPartialCopy(t *testing.T) {
	content := bytes.Repeat([]byte("audio"), 65536)
	source := filepath.Join(t.TempDir(), "source.m4b")
	if err := os.WriteFile(source, content, 0o600); err != nil {
		t.Fatal(err)
	}
	original, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer original.Close()
	hash := sha256.Sum256(content)
	media := Media{SHA256: hex.EncodeToString(hash[:]), SizeBytes: int64(len(content))}
	cache := t.TempDir()
	ctx := &canceledPlaybackCopy{Context: context.Background()}
	if _, err := snapshotPlayback(ctx, original, media, cache); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled copy returned %v", err)
	}
	entries, err := os.ReadDir(cache)
	if err != nil || len(entries) != 0 {
		t.Fatalf("canceled copy left files: %v %v", entries, err)
	}
}
