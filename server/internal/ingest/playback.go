package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrPlaybackUnavailable = errors.New("optimized playback unavailable")

// OpenPlayback keeps the original media authoritative while avoiding MP4 chapter
// tracks that make browsers fetch chapter-title samples across the whole book.
func (s *Store) OpenPlayback(ctx context.Context, actor auth.User, id string) (*os.File, Media, error) {
	original, media, err := s.Open(ctx, actor, id)
	if err != nil {
		return nil, Media{}, err
	}
	if media.Kind != "audio" && media.Kind != "audiobook" {
		return original, media, nil
	}
	switch strings.ToLower(filepath.Ext(media.OriginalFilename)) {
	case ".m4b", ".m4a", ".mp4":
	default:
		return original, media, nil
	}

	path, err := s.playbackPath(ctx, original, media)
	if err != nil {
		original.Close()
		if errors.Is(err, ErrNotFound) {
			return nil, Media{}, err
		}
		return nil, Media{}, fmt.Errorf("%w: prepare audiobook playback: %w", ErrPlaybackUnavailable, err)
	}
	if path == "" {
		return original, media, nil
	}
	original.Close()

	file, err := os.Open(path)
	if err != nil {
		return nil, Media{}, fmt.Errorf("%w: open audiobook playback: %w", ErrPlaybackUnavailable, err)
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, Media{}, fmt.Errorf("%w: stat audiobook playback: %w", ErrPlaybackUnavailable, err)
	}
	media.OriginalFilename = "playback.m4a"
	media.SizeBytes = info.Size()
	return file, media, nil
}

func (s *Store) playbackPath(ctx context.Context, original *os.File, media Media) (string, error) {
	hash, err := hex.DecodeString(media.SHA256)
	if err != nil || len(hash) != 32 {
		return "", fmt.Errorf("%w: invalid source hash", ErrNotFound)
	}
	path := filepath.Join(s.root, "playback-v1", media.SHA256+".m4a")
	if ready, err := playbackCached(path); ready || err != nil {
		return path, err
	}
	if _, err := os.Stat(path + ".original"); err == nil {
		return "", nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	// ponytail: one remux at a time bounds disk and CPU usage; widen this slot
	// only if concurrent first-time playback becomes a measured bottleneck.
	select {
	case s.playback <- struct{}{}:
		defer func() { <-s.playback }()
	case <-ctx.Done():
		return "", ctx.Err()
	}
	// Another request may have prepared the same immutable source while we waited.
	if ready, err := playbackCached(path); ready || err != nil {
		return path, err
	}
	if _, err := os.Stat(path + ".original"); err == nil {
		return "", nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return "", err
	}
	snapshot, err := snapshotPlayback(ctx, original, media, filepath.Dir(path))
	if err != nil {
		return "", err
	}
	defer os.Remove(snapshot)
	input, err := probePlayback(ctx, snapshot)
	if err != nil {
		return "", err
	}
	audio, eligible := input.chapterAudio()
	if !eligible {
		// This decision is tied to immutable content, not the source filename.
		return "", os.WriteFile(path+".original", nil, 0o640)
	}

	staged, err := os.CreateTemp(filepath.Dir(path), ".playback-*.m4a")
	if err != nil {
		return "", err
	}
	temporary := staged.Name()
	defer os.Remove(temporary)
	if err := staged.Close(); err != nil {
		return "", err
	}
	command := exec.CommandContext(ctx, "ffmpeg",
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-i", snapshot, "-map", "0:a:0", "-c", "copy",
		"-map_chapters", "-1", "-movflags", "+faststart", temporary,
	)
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("remux audio: %w", err)
	}
	output, err := probePlayback(ctx, temporary)
	if err != nil {
		return "", err
	}
	if len(output.Streams) != 1 || len(output.Chapters) != 0 || output.Streams[0] != audio {
		return "", errors.New("playback remux changed audio timing or retained chapter tracks")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, path); err != nil {
		return "", fmt.Errorf("publish audiobook playback: %w", err)
	}
	return path, nil
}

func playbackCached(path string) (bool, error) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return false, errors.New("invalid cached playback file")
	}
	return true, nil
}

type playbackStream struct {
	Codec       string      `json:"codec_name"`
	Kind        string      `json:"codec_type"`
	Tag         string      `json:"codec_tag_string"`
	TimeBase    string      `json:"time_base"`
	Start       json.Number `json:"start_pts"`
	Duration    int64       `json:"duration_ts"`
	Frames      string      `json:"nb_frames"`
	Disposition struct {
		AttachedPicture int `json:"attached_pic"`
	} `json:"disposition"`
}

type playbackProbe struct {
	Streams  []playbackStream  `json:"streams"`
	Chapters []json.RawMessage `json:"chapters"`
}

func (p playbackProbe) chapterAudio() (playbackStream, bool) {
	var audio playbackStream
	var audioCount, chapterTracks int
	for _, stream := range p.Streams {
		switch {
		case stream.Kind == "audio":
			audio = stream
			audioCount++
		case stream.Kind == "video" && stream.Disposition.AttachedPicture == 1:
			// Cover art stays on the original; playback only needs audio.
			continue
		case stream.Kind == "data" && stream.Tag == "text":
			chapterTracks++
		default:
			return playbackStream{}, false
		}
	}
	eligible := audioCount == 1 && chapterTracks > 0 && len(p.Chapters) > 0 &&
		audio.Codec == "aac" && audio.Start == "0" && audio.Duration > 0 &&
		audio.TimeBase != "" && audio.Frames != "" && audio.Frames != "N/A"
	return audio, eligible
}

func probePlayback(ctx context.Context, path string) (playbackProbe, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var output boundedBuffer
	output.remaining = 1 << 20
	command := exec.CommandContext(ctx, "ffprobe", "-v", "error",
		"-show_entries", "stream=codec_name,codec_type,codec_tag_string,time_base,start_pts,duration_ts,nb_frames:stream_disposition=attached_pic:chapter=id",
		"-of", "json", path,
	)
	command.Stdout = &output
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return playbackProbe{}, ctx.Err()
		}
		return playbackProbe{}, fmt.Errorf("probe playback streams: %w", err)
	}
	if output.truncated {
		return playbackProbe{}, errors.New("playback metadata is too large")
	}
	var result playbackProbe
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		return playbackProbe{}, fmt.Errorf("decode playback streams: %w", err)
	}
	return result, nil
}

// snapshotPlayback binds both external tools to bytes from the authorized open
// file, even if a referenced source path is replaced while preparation waits.
func snapshotPlayback(ctx context.Context, original *os.File, media Media, dir string) (string, error) {
	snapshot, err := os.CreateTemp(dir, ".source-*")
	if err != nil {
		return "", err
	}
	path := snapshot.Name()
	complete := false
	defer func() {
		snapshot.Close()
		if !complete {
			os.Remove(path)
		}
	}()
	if _, err := original.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	hash := sha256.New()
	destination := io.MultiWriter(snapshot, hash)
	buffer := make([]byte, 128*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, readErr := original.Read(buffer)
		if n > 0 {
			written += int64(n)
			if written > media.SizeBytes {
				return "", ErrNotFound
			}
			if _, err := destination.Write(buffer[:n]); err != nil {
				return "", err
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	if written != media.SizeBytes || hex.EncodeToString(hash.Sum(nil)) != media.SHA256 {
		return "", ErrNotFound
	}
	if _, err := original.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	if err := snapshot.Close(); err != nil {
		return "", err
	}
	complete = true
	return path, nil
}
