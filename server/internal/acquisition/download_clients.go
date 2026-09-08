package acquisition

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// saveDownloadClient retains old endpoints and updates credentials only for the
// same endpoint. Category and path mappings remain attached to the original job.
func saveDownloadClient(ctx context.Context, tx *sql.Tx, options Options) (string, error) {
	endpoint := strings.TrimRight(options.QBitURL, "/")
	if endpoint == "" {
		return "", ErrUnavailable
	}

	id, err := randomID()
	if err != nil {
		return "", err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO acquisition_download_clients (
			id, kind, url, username, password, category, download_root
		)
		VALUES (?, 'qbittorrent', ?, ?, ?, ?, ?)
		ON CONFLICT (kind, url, category, download_root) DO NOTHING
	`, id, endpoint, options.QBitUsername, options.QBitPassword, options.Category, options.DownloadRoot)
	if err != nil {
		return "", fmt.Errorf("record download client: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE acquisition_download_clients
		SET username=?, password=?
		WHERE kind='qbittorrent' AND url=?
	`, options.QBitUsername, options.QBitPassword, endpoint)
	if err != nil {
		return "", fmt.Errorf("update download client credentials: %w", err)
	}

	err = tx.QueryRowContext(ctx, `
		SELECT id FROM acquisition_download_clients
		WHERE kind='qbittorrent' AND url=? AND category=? AND download_root=?
	`, endpoint, options.Category, options.DownloadRoot).Scan(&id)
	return id, err
}

// Caller holds clientMu so changing the default cannot race first-time binding.
func (s *Store) preserveDownloadClients(ctx context.Context, options Options, requestID string) error {
	if options.QBitURL == "" {
		return ErrUnavailable
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	defer tx.Rollback()

	id, err := saveDownloadClient(ctx, tx, options)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE acquisition_requests
		SET download_client_id=?
		WHERE download_client_id IS NULL
			AND (id=? OR COALESCE(selected_url, '') != '' OR torrent_hash != '')
	`, id, requestID)
	if err != nil {
		return fmt.Errorf("bind acquisition download client: %w", err)
	}

	return tx.Commit()
}

func (s *Store) requestClient(ctx context.Context, requestID string) (*Client, string, error) {
	s.clientMu.Lock()
	defer s.clientMu.Unlock()

	var id string
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(download_client_id, '')
		FROM acquisition_requests WHERE id=?
	`, requestID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}

	if err != nil {
		return nil, "", err
	}

	options, err := s.options(ctx)
	if err != nil {
		return nil, "", err
	}

	if id == "" {
		if err := s.preserveDownloadClients(ctx, options, requestID); err != nil {
			return nil, "", err
		}

		if err := s.db.QueryRowContext(ctx, `
			SELECT download_client_id FROM acquisition_requests WHERE id=?
		`, requestID).Scan(&id); err != nil {
			return nil, "", err
		}
	}

	var kind string
	err = s.db.QueryRowContext(ctx, `
		SELECT kind, url, username, password, category, download_root
		FROM acquisition_download_clients WHERE id=?
	`, id).Scan(
		&kind,
		&options.QBitURL,
		&options.QBitUsername,
		&options.QBitPassword,
		&options.Category,
		&options.DownloadRoot,
	)
	if err != nil {
		return nil, "", fmt.Errorf("load original download client: %w", err)
	}

	if kind != "qbittorrent" {
		return nil, "", ErrUnavailable
	}

	client, err := New(options)
	return client, id, err
}

// Poll each connection once per pass. An offline client must not make downloads
// on another client look missing or stop their import.
type clientDownloads struct {
	items []Download
	err   error
}

func downloadsForClient(ctx context.Context, client *Client, id string, cache map[string]clientDownloads) ([]Download, error) {
	if previous, ok := cache[id]; ok {
		return previous.items, previous.err
	}

	items, err := client.Downloads(ctx)
	if err != nil && ctx.Err() == nil {
		err = errors.New("cannot reach the original download client; check its connection")
	}

	cache[id] = clientDownloads{items: items, err: err}
	return items, err
}
