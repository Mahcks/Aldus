package auth

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"regexp"
	"testing"
)

func TestReaderCredentialIsHumanTypableAndAuthenticates(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	session, err := store.Setup(ctx, Credentials{Username: "reader", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	credential, err := store.CreateReaderCredential(ctx, session.User, "Kindle")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$`).MatchString(credential.Secret) {
		t.Fatalf("secret is not human-typable: %q", credential.Secret)
	}
	if _, err := store.AuthenticateReader(ctx, session.User.Username, credential.Secret, false); err != nil {
		t.Fatal(err)
	}
	syncKey := md5.Sum([]byte(credential.Secret))
	if _, err := store.AuthenticateReader(ctx, session.User.Username, hex.EncodeToString(syncKey[:]), true); err != nil {
		t.Fatal(err)
	}
}
