package acquisition

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/source"
)

// Run only through scripts/acquisition-seeding-smoke.sh, which creates an
// isolated client, network and mounts. It never accepts production settings.
func TestDisposableSeedingSmoke(t *testing.T) {
	raw := os.Getenv("ALDUS_SEEDING_SMOKE_URL")
	if raw == "" {
		t.Skip("run scripts/acquisition-seeding-smoke.sh")
	}

	u, err := url.Parse(raw)
	data := os.Getenv("ALDUS_SEEDING_SMOKE_DATA")
	container := os.Getenv("ALDUS_SEEDING_SMOKE_CONTAINER")
	if err != nil ||
		u.Hostname() != "127.0.0.1" ||
		!strings.HasPrefix(data, "/tmp/aldus-seeding-smoke.") ||
		!strings.HasPrefix(container, "aldus-seeding-smoke-") {
		t.Fatal("smoke test requires disposable loopback client")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	payload, err := os.ReadFile("../../../test-fixtures/alice/media/alice.epub")
	if err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(data, "alice.epub"), payload, 0o600); err != nil {
		t.Fatal(err)
	}

	// One local piece; public-domain fixture, no trackers or peers.
	piece := sha1.Sum(payload)
	info := fmt.Appendf(nil, "d6:lengthi%de4:name10:alice.epub12:piece lengthi%de6:pieces20:", len(payload), len(payload))
	info = append(info, piece[:]...)
	info = append(info, 'e')
	sum := sha1.Sum(info)
	hash := hex.EncodeToString(sum[:])
	torrent := append([]byte("d4:info"), info...)
	torrent = append(torrent, 'e')
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(torrent) }))
	defer provider.Close()

	client, err := New(Options{
		IndexerURL:   provider.URL,
		QBitURL:      raw,
		QBitUsername: "admin",
		QBitPassword: "aldus-smoke-only",
		Category:     "aldus-smoke",
		DownloadRoot: "/downloads",
	})
	if err != nil {
		t.Fatal(err)
	}

	wait := func(check func() bool) {
		t.Helper()
		tick := time.NewTicker(100 * time.Millisecond)
		defer tick.Stop()

		for !check() {
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-tick.C:
			}
		}
	}
	wait(func() bool {
		_, err := client.login(ctx)
		return err == nil
	})
	if _, err := client.submitTracked(ctx, provider.URL+"/seed.torrent", "seed"); err != nil {
		t.Fatal(err)
	}

	wait(func() bool {
		downloads, err := client.Downloads(ctx)
		if err != nil {
			return false
		}

		for _, d := range downloads {
			if strings.EqualFold(d.Hash, hash) && d.ReadyForImport() {
				return true
			}
		}

		return false
	})
	db := titleLifecycleFixture(t)
	store := NewStore(db, client)
	if _, err := db.Exec(`UPDATE acquisition_results SET download_url=? WHERE id='release'`, "magnet:?xt=urn:btih:"+hash); err != nil {
		t.Fatal(err)
	}

	actor := auth.User{ID: "reader", Admin: true}
	selected, err := store.Select(ctx, actor, "library", "legacy", "release")
	if err != nil || selected.TorrentOwnership != "adopted" {
		t.Fatalf("adoption=%+v err=%v", selected, err)
	}

	// Copy the reused seed through the real managed acquisition handoff.
	sourceStore, err := source.New(db, source.Options{DataRoot: t.TempDir(), MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}

	destinations, err := sourceStore.List(ctx, actor, "library")
	if err != nil {
		t.Fatal(err)
	}

	var managed, managedRoot string
	for _, d := range destinations {
		if d.StorageKind == "managed" {
			managed = d.ID
			managedRoot = d.RootPath
		}
	}

	if managed == "" {
		t.Fatal("managed destination missing")
	}

	if _, err := db.Exec(`UPDATE acquisition_requests SET source_id=? WHERE id='legacy'`, managed); err != nil {
		t.Fatal(err)
	}

	if _, err := sourceStore.EnqueueAcquisitionScan(ctx, "library", managed, "legacy", filepath.Join(data, "alice.epub")); err != nil {
		t.Fatal(err)
	}

	// Restart qBittorrent and reconstruct the store before canceling.
	if output, err := exec.CommandContext(ctx, "docker", "restart", container).CombinedOutput(); err != nil {
		t.Fatalf("restart: %s: %v", output, err)
	}

	port, err := exec.CommandContext(ctx, "docker", "port", container, "8080/tcp").Output()
	if err != nil {
		t.Fatal(err)
	}

	if endpoint := "http://" + strings.TrimSpace(string(port)); endpoint != client.options.QBitURL {
		t.Fatal("disposable client endpoint changed across restart")
	}
	wait(func() bool {
		_, err := client.Downloads(ctx)
		return err == nil
	})
	store = NewStore(db, client)
	if err := store.Cancel(ctx, actor, "library", "legacy"); err != nil {
		t.Fatal(err)
	}

	downloads, err := client.Downloads(ctx)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, d := range downloads {
		if strings.EqualFold(d.Hash, hash) {
			found = true
		}
	}

	original, err := os.ReadFile(filepath.Join(data, "alice.epub"))
	if !found || err != nil || !bytes.Equal(original, payload) {
		t.Fatal("reused seed or payload was removed")
	}

	saved, err := os.ReadFile(filepath.Join(managedRoot, "legacy", "file-000001.epub"))
	if err != nil || !bytes.Equal(saved, payload) {
		t.Fatal("managed import was removed")
	}

	// A new magnet owned by this request should be removed by exact hash.
	ownedHash := "1111111111111111111111111111111111111111"
	receipt, err := client.submitTracked(ctx, "magnet:?xt=urn:btih:"+ownedHash, "owned")
	if err != nil {
		t.Fatal(err)
	}

	if receipt.Ownership != "created" {
		// Acknowledgment may precede torrent visibility. Unknown remains protected.
		t.Fatalf("owned submission not verified: %+v", receipt)
	}

	if _, err := db.Exec(`
		UPDATE acquisition_requests
		SET fulfillment_state='downloading',
			torrent_hash=?,
			torrent_ownership='created'
		WHERE id='legacy'
	`, receipt.Hash); err != nil {
		t.Fatal(err)
	}

	if err := store.Cancel(ctx, actor, "library", "legacy"); err != nil {
		t.Fatal(err)
	}

	wait(func() bool {
		downloads, err := client.Downloads(ctx)
		if err != nil {
			return false
		}

		for _, d := range downloads {
			if strings.EqualFold(d.Hash, ownedHash) {
				return false
			}
		}

		return true
	})
	t.Log("reused seed survived import, restart and cancellation; owned torrent removed")
}
