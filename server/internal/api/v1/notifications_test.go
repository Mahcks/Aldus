package v1

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/notification"
)

func TestNotificationInboxAPI(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	session, err := accounts.Setup(ctx, auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	inbox := notification.New(db)
	event, err := inbox.Publish(ctx, notification.Event{Kind: "acquisition.ready", Title: "Ready to read"}, []string{session.User.ID})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Auth: accounts, Notifications: inbox})

	response := request(t, handler, session.Token, http.MethodGet, "/me/notifications", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"title":"Ready to read"`) || !strings.Contains(response.Body.String(), `"unread_count":1`) {
		t.Fatalf("list = %d %s", response.Code, response.Body.String())
	}
	response = request(t, handler, session.Token, http.MethodPost, "/me/notifications/"+event.ID+"/read", "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("mark read = %d %s", response.Code, response.Body.String())
	}
	response = request(t, handler, session.Token, http.MethodGet, "/me/notifications/unread-count", "")
	if response.Code != http.StatusOK || response.Body.String() != "{\"unread_count\":0}\n" {
		t.Fatalf("unread = %d %s", response.Code, response.Body.String())
	}
	unauthorized := request(t, handler, "", http.MethodGet, "/me/notifications", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized = %d", unauthorized.Code)
	}
}
