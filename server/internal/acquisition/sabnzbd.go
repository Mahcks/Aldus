package acquisition

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

type sabResponse struct {
	Categories []string `json:"categories"`
	ID         string   `json:"nzo_id"`
	Status     *bool    `json:"status"`
	Error      string   `json:"error"`
	IDs        []string `json:"nzo_ids"`
	Queue      *sabPage `json:"queue"`
	History    *sabPage `json:"history"`
}

type sabPage struct {
	Slots []sabJob `json:"slots"`
}

type sabJob struct {
	ID         string `json:"nzo_id"`
	Name       string `json:"name"`
	Filename   string `json:"filename"`
	NZBName    string `json:"nzb_name"`
	State      string `json:"status"`
	Storage    string `json:"storage"`
	Percentage string `json:"percentage"`
	Bytes      int64  `json:"bytes"`
	Loaded     bool   `json:"loaded"`
}

func (c sabnzbdBackend) request(ctx context.Context, values url.Values, payload []byte) (sabResponse, error) {
	var result sabResponse
	if c.options.SABnzbdURL == "" || c.options.SABnzbdAPIKey == "" {
		return result, ErrUnavailable
	}

	values.Set("apikey", c.options.SABnzbdAPIKey)
	values.Set("output", "json")
	var body io.Reader = strings.NewReader(values.Encode())
	contentType := "application/x-www-form-urlencoded"
	if payload != nil {
		var buffer bytes.Buffer
		writer := multipart.NewWriter(&buffer)
		for key, entries := range values {
			if err := writer.WriteField(key, entries[0]); err != nil {
				return result, err
			}
		}

		part, err := writer.CreateFormFile("nzbfile", "aldus.nzb")
		if err != nil {
			return result, err
		}

		if _, err := part.Write(payload); err != nil {
			return result, err
		}

		if err := writer.Close(); err != nil {
			return result, err
		}

		body = &buffer
		contentType = writer.FormDataContentType()
	}

	endpoint := strings.TrimRight(c.options.SABnzbdURL, "/") + "/api"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return result, errors.New("invalid SABnzbd connection")
	}

	req.Header.Set("Content-Type", contentType)
	response, err := c.http.Do(req)
	if err != nil {
		return result, errors.New("SABnzbd request failed; check the connection")
	}

	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("SABnzbd returned HTTP %d", response.StatusCode)
	}

	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&result); err != nil {
		return result, errors.New("SABnzbd returned an invalid response")
	}

	if result.Error != "" || (result.Status != nil && !*result.Status) {
		return result, errors.New("SABnzbd rejected the operation; check its API key, category and job status")
	}

	return result, nil
}

func (c sabnzbdBackend) submitTracked(ctx context.Context, releaseURL, marker string) (SubmissionReceipt, error) {
	receipt := SubmissionReceipt{Ownership: "unknown"}
	if !validTag(marker) || marker == "" || !validDownloadURL(releaseURL) || strings.HasPrefix(releaseURL, "magnet:") {
		return receipt, ErrInvalid
	}

	if err := c.validateCategory(ctx); err != nil {
		return receipt, err
	}

	// Retrieve credentials locally; SABnzbd receives a validated NZB, not an indexer URL.
	payload, err := c.fetchTorrent(ctx, releaseURL)
	if err != nil {
		return receipt, errors.New("could not retrieve the NZB from the indexer")
	}

	var nzb struct {
		XMLName xml.Name `xml:"nzb"`
		Files   []struct {
			Segments []string `xml:"segments>segment"`
		} `xml:"file"`
	}
	if err := xml.Unmarshal(payload, &nzb); err != nil || len(nzb.Files) == 0 {
		return receipt, errors.New("the indexer did not return a valid NZB")
	}

	for _, file := range nzb.Files {
		if len(file.Segments) == 0 {
			return receipt, errors.New("the NZB has no download segments")
		}
	}

	jobs, err := c.Downloads(ctx)
	if err != nil {
		return receipt, err
	}

	for _, job := range jobs {
		if job.HasTag(marker) {
			return SubmissionReceipt{JobID: job.JobID, Ownership: "adopted"}, nil
		}
	}

	category := c.options.SABnzbdCategory
	if category == "" {
		category = "*"
	}

	result, err := c.request(ctx, url.Values{
		"mode":    {"addfile"},
		"nzbname": {"aldus-" + marker},
		"cat":     {category},
		"pp":      {"2"},
	}, payload)
	if result.Status != nil && !*result.Status {
		return receipt, errors.New("SABnzbd rejected this NZB; check the category and API permissions")
	}

	if err != nil || result.Status == nil || !*result.Status || len(result.IDs) != 1 || !validSABJobID(result.IDs[0]) {
		return receipt, ErrSubmissionUnknown
	}

	return SubmissionReceipt{JobID: result.IDs[0], Ownership: "created"}, nil
}

func validSABJobID(id string) bool {
	// IDs are opaque: older releases used SABnzbd_nzo_*; newer releases use UUIDs.
	// Exclude the bulk-operation token even if a malformed server returns it.
	return validTag(id) && !strings.EqualFold(id, "all")
}

func (c sabnzbdBackend) Downloads(ctx context.Context) ([]Download, error) {
	var jobs []Download
	for _, mode := range []string{"queue", "history"} {
		for page := 0; ; page++ {
			// A bounded scan fails explicitly instead of treating unlisted jobs as missing.
			if page == 100 {
				return nil, errors.New("SABnzbd job history exceeds the supported scan size; archive older history")
			}

			response, err := c.request(ctx, url.Values{
				"mode": {mode}, "start": {strconv.Itoa(page * 200)}, "limit": {"200"},
			}, nil)
			if err != nil {
				return nil, err
			}

			result := response.Queue
			if mode == "history" {
				result = response.History
			}

			if result == nil {
				return nil, errors.New("SABnzbd returned no job list")
			}

			for _, item := range result.Slots {
				if !validSABJobID(item.ID) {
					return nil, errors.New("SABnzbd returned an invalid job ID")
				}

				name := item.Name
				if name == "" {
					name = item.Filename
				}

				if name == "" {
					name = strings.TrimSuffix(item.NZBName, ".nzb")
				}

				progress, _ := strconv.ParseFloat(item.Percentage, 64)
				if math.IsNaN(progress) || math.IsInf(progress, 0) {
					progress = 0
				}

				job := Download{PostProcessing: mode == "history" && item.Loaded,
					JobID:    item.ID,
					Name:     name,
					State:    strings.ToLower(item.State),
					Progress: max(0, min(1, progress/100)),
					Size:     item.Bytes,
				}
				if strings.HasPrefix(name, "aldus-") {
					job.Tags = strings.TrimPrefix(name, "aldus-")
				}

				if mode == "history" && job.State == "completed" && !item.Loaded {
					job.ContentPath = item.Storage
					job.Progress = 1
				}

				jobs = append(jobs, job)
			}

			if len(result.Slots) < 200 {
				break
			}
		}
	}

	return jobs, nil
}

func (c sabnzbdBackend) CancelTracked(ctx context.Context, id, _ string) error {
	if !validSABJobID(id) {
		return ErrInvalid
	}

	jobs, err := c.Downloads(ctx)
	if err != nil {
		return err
	}

	for _, job := range jobs {
		if job.JobID != id {
			continue
		}

		if job.PostProcessing {
			return errors.New("SABnzbd is processing this download; wait for it to finish before canceling")
		}

		switch job.State {
		case "completed", "failed":
			return nil // Keep completed output and history, including other applications' files.
		case "downloading", "queued", "paused", "propagating", "fetching":
			response, err := c.request(ctx, url.Values{"mode": {"queue"}, "name": {"delete"}, "value": {id}, "del_files": {"0"}}, nil)
			if err != nil {
				return err
			}
			if response.Status == nil || !*response.Status {
				return errors.New("SABnzbd did not confirm cancellation")
			}
			return nil
		default:
			return errors.New("SABnzbd is processing this download; wait for it to finish before canceling")
		}
	}

	return nil
}

func (c sabnzbdBackend) RemoveTag(context.Context, string, string) error { return nil }

func (c sabnzbdBackend) retry(ctx context.Context, id string) (string, error) {
	if !validSABJobID(id) {
		return "", ErrInvalid
	}

	response, err := c.request(ctx, url.Values{"mode": {"retry"}, "value": {id}}, nil)
	if response.Status != nil && !*response.Status {
		return "", errors.New("SABnzbd could not retry this job; check its history")
	}

	if err != nil || response.Status == nil || !validSABJobID(response.ID) {
		return "", ErrSubmissionUnknown
	}

	return response.ID, nil
}

func (c sabnzbdBackend) validateCategory(ctx context.Context) error {
	category := c.options.SABnzbdCategory
	if category == "" || category == "*" {
		return nil
	}

	response, err := c.request(ctx, url.Values{"mode": {"get_cats"}}, nil)
	if err != nil {
		return err
	}

	if !slices.Contains(response.Categories, category) {
		return errors.New("the configured SABnzbd category does not exist; create it in SABnzbd or choose an existing category")
	}

	return nil
}
