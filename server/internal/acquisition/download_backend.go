package acquisition

import (
	"context"
	"strings"
)

// Both clients expose jobs; their IDs and completion rules remain provider-owned.
type downloadBackend interface {
	submitTracked(context.Context, string, string) (SubmissionReceipt, error)
	Downloads(context.Context) ([]Download, error)
	CancelTracked(context.Context, string, string) error
	RemoveTag(context.Context, string, string) error
}

type qbitBackend struct{ *Client }
type sabnzbdBackend struct{ *Client }

func (c *Client) backend() downloadBackend {
	if c.options.downloadKind == "sabnzbd" {
		return sabnzbdBackend{c}
	}

	return qbitBackend{c}
}

func (c *Client) submitTracked(ctx context.Context, releaseURL, marker string) (SubmissionReceipt, error) {
	return c.backend().submitTracked(ctx, releaseURL, marker)
}

func (c *Client) Downloads(ctx context.Context) ([]Download, error) {
	return c.backend().Downloads(ctx)
}

func (c *Client) CancelTracked(ctx context.Context, id, marker string) error {
	return c.backend().CancelTracked(ctx, id, marker)
}

func (c *Client) RemoveTag(ctx context.Context, id, marker string) error {
	return c.backend().RemoveTag(ctx, id, marker)
}

func (c *Client) sameJobID(left, right string) bool {
	if c.options.downloadKind == "sabnzbd" {
		return left == right
	}

	return strings.EqualFold(left, right)
}

type SubmissionReceipt struct {
	JobID     string
	Ownership string
}
