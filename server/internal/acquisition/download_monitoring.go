package acquisition

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	downloadMissingGrace = 15 * time.Minute
	metadataStallLimit   = 30 * time.Minute
	downloadStallLimit   = 24 * time.Hour
)

type downloadMonitorRequest struct {
	id              string
	libraryID       string
	sourceID        string
	hash            string
	lastSeen        string
	progressUpdated string
	updated         string
	progress        float64
}

func (s *Store) monitorDownload(ctx context.Context, request downloadMonitorRequest, download *Download, now time.Time) (bool, error) {
	if download == nil {
		baseline := request.lastSeen
		if baseline == "" {
			baseline = request.progressUpdated
		}
		if baseline == "" {
			baseline = request.updated
		}
		seenAt, err := time.Parse(time.RFC3339Nano, baseline)
		if err != nil || now.Sub(seenAt) < downloadMissingGrace {
			return false, nil
		}
		if request.lastSeen == "" {
			s.markDownloadProblem(ctx, request.id, "qBittorrent never reported this download after 15 minutes. Check its category, tags, and add permissions.")
		} else {
			s.markDownloadProblem(ctx, request.id, "qBittorrent no longer has this download. It may have been removed from the download client.")
		}
		return true, nil
	}

	stamp := now.UTC().Format(time.RFC3339Nano)
	progressChanged := request.progressUpdated == "" || math.Abs(download.Progress-request.progress) >= 0.000001
	progressUpdated := request.progressUpdated
	if progressChanged {
		progressUpdated = stamp
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET torrent_hash=?,qbit_state=?,download_last_seen_at=?,download_progress=?,download_progress_updated_at=? WHERE id=? AND fulfillment_state='downloading'`, download.Hash, download.State, stamp, download.Progress, progressUpdated, request.id); err != nil {
		return false, fmt.Errorf("record acquisition download progress: %w", err)
	}

	switch strings.ToLower(download.State) {
	case "error":
		s.markDownloadProblem(ctx, request.id, "qBittorrent reported an error for this download. Open qBittorrent for the underlying client message.")
		return true, nil
	case "missingfiles":
		s.markDownloadProblem(ctx, request.id, "qBittorrent cannot find the downloaded files. Recheck the torrent or restore its download path.")
		return true, nil
	case "metadl", "forcedmetadl":
		startedAt, err := time.Parse(time.RFC3339Nano, request.progressUpdated)
		if err == nil && download.Seeds == 0 && download.Peers == 0 && now.Sub(startedAt) >= metadataStallLimit {
			diagnosis := "No peers supplied torrent metadata for 30 minutes. Aldus will try a different release."
			s.blacklistRelease(ctx, request.id, download.Hash, diagnosis)
			s.markDownloadProblem(ctx, request.id, diagnosis)
			return true, nil
		}
	}

	if !progressChanged && activeDownloadState(download.State) {
		changedAt, err := time.Parse(time.RFC3339Nano, request.progressUpdated)
		if err == nil && now.Sub(changedAt) >= downloadStallLimit {
			s.markDownloadProblem(ctx, request.id, "The qBittorrent download made no progress for 24 hours. Check peers, trackers, and available disk space, then retry.")
			return true, nil
		}
	}
	return false, nil
}

func activeDownloadState(state string) bool {
	switch strings.ToLower(state) {
	case "downloading", "forceddl", "stalleddl":
		return true
	default:
		return false
	}
}
