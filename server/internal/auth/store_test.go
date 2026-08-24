package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/database"
)

const (
	testPassword = "a-secure-test-password"
)

func openTestStore(t *testing.T, options Options) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	store, err := New(db, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return store, path
}

func TestSetupAndSessionLifecycle(t *testing.T) {
	ctx := context.Background()
	store, path := openTestStore(t, Options{SessionTTL: time.Hour})
	available, err := store.SetupAvailable(ctx)
	if err != nil || !available {
		t.Fatalf("SetupAvailable() = %v, %v", available, err)
	}
	session, err := store.Setup(ctx, Credentials{Username: "Alice", DisplayName: "Alice Admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if !session.User.Admin || session.User.Username != "Alice" {
		t.Fatalf("setup user = %#v", session.User)
	}
	available, err = store.SetupAvailable(ctx)
	if err != nil || available {
		t.Fatalf("SetupAvailable() after setup = %v, %v", available, err)
	}
	if _, err := store.Setup(ctx, Credentials{Username: "other", Password: testPassword}); !errors.Is(err, ErrSetupClosed) {
		t.Fatalf("second setup error = %v", err)
	}

	var passwordHash string
	if err := store.db.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id=?`, session.User.ID).Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}
	if passwordHash == testPassword {
		t.Fatal("password stored in plaintext")
	}
	var rawCount, hashCount int
	hash := sha256.Sum256([]byte(session.Token))
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE token_hash=?`, []byte(session.Token)).Scan(&rawCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE token_hash=?`, hash[:]).Scan(&hashCount); err != nil {
		t.Fatal(err)
	}
	if rawCount != 0 || hashCount != 1 {
		t.Fatalf("stored session raw=%d hashed=%d", rawCount, hashCount)
	}

	login, err := store.Login(ctx, Credentials{Username: " alice ", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "missing", Password: testPassword}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("missing user error = %v", err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "alice", Password: "wrong"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password error = %v", err)
	}
	if err := store.db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := New(db, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if user, err := reopened.Authenticate(ctx, login.Token); err != nil || user.ID != session.User.ID {
		t.Fatalf("persisted session user = %#v, %v", user, err)
	}
	if err := reopened.Logout(ctx, login.Token); err != nil {
		t.Fatal(err)
	}
	if err := reopened.Logout(ctx, login.Token); err != nil {
		t.Fatalf("idempotent logout: %v", err)
	}
	if _, err := reopened.Authenticate(ctx, login.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("revoked session error = %v", err)
	}
	if _, err := reopened.Authenticate(ctx, "invalid"); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("invalid session error = %v", err)
	}
}

func TestConcurrentSetupCreatesOneAdmin(t *testing.T) {
	store, _ := openTestStore(t, Options{})
	start := make(chan struct{})
	errorsSeen := make(chan error, 2)
	var wait sync.WaitGroup
	for _, username := range []string{"alice", "other"} {
		wait.Add(1)
		go func(username string) {
			defer wait.Done()
			<-start
			_, err := store.Setup(context.Background(), Credentials{Username: username, Password: testPassword})
			errorsSeen <- err
		}(username)
	}
	close(start)
	wait.Wait()
	close(errorsSeen)
	var successes, closed int
	for err := range errorsSeen {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrSetupClosed):
			closed++
		default:
			t.Fatalf("setup error = %v", err)
		}
	}
	var admins int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin=1`).Scan(&admins); err != nil {
		t.Fatal(err)
	}
	if successes != 1 || closed != 1 || admins != 1 {
		t.Fatalf("successes=%d closed=%d admins=%d", successes, closed, admins)
	}
}

func TestExpiredAndDisabledSessionsAreRejected(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	session, err := store.Setup(ctx, Credentials{Username: "alice", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(session.Token))
	if _, err := store.db.ExecContext(ctx, `UPDATE sessions SET expires_at=? WHERE token_hash=?`, formatTime(time.Now().Add(-time.Hour)), hash[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(ctx, session.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expired session error = %v", err)
	}
	session, err = store.Login(ctx, Credentials{Username: "alice", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE users SET disabled=1 WHERE id=?`, session.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(ctx, session.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("disabled session error = %v", err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "alice", Password: testPassword}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled login error = %v", err)
	}
}

func TestDemoSessionLifecycle(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{DemoLibraryID: "demo-library", DemoTTL: time.Hour, DemoCapacity: 1})
	admin, err := store.Setup(ctx, Credentials{Username: "admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO libraries(id,name,created_at,updated_at) VALUES('demo-library','Demo',?,?)`, formatTime(time.Now().UTC()), formatTime(time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	guest, err := store.CreateDemoSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if guest.User.Admin || guest.User.DemoExpiresAt == nil || guest.User.Username == admin.User.Username {
		t.Fatalf("demo user = %#v", guest.User)
	}
	if guest.DemoPassword == "" {
		t.Fatal("demo password is empty")
	}
	if _, err := store.Login(ctx, Credentials{Username: guest.User.Username, Password: guest.DemoPassword}); err != nil {
		t.Fatalf("demo login = %v", err)
	}
	users, err := store.Users(ctx, admin.User, 50, 0)
	if err != nil || len(users) != 1 || users[0].ID != admin.User.ID {
		t.Fatalf("admin users = %#v, %v", users, err)
	}
	var role string
	var exclusive, canRequest, canBypass, canAdvanced int
	if err := store.db.QueryRowContext(ctx, `SELECT role,exclusive,can_request_acquisitions,can_bypass_acquisition_approval,can_advanced_acquisition_request FROM library_members WHERE user_id=?`, guest.User.ID).Scan(&role, &exclusive, &canRequest, &canBypass, &canAdvanced); err != nil {
		t.Fatal(err)
	}
	if role != "reader" || exclusive != 0 || canRequest != 0 || canBypass != 0 || canAdvanced != 0 {
		t.Fatalf("demo membership = %q %d %d %d %d", role, exclusive, canRequest, canBypass, canAdvanced)
	}
	if _, err := store.CreateDemoSession(ctx); !errors.Is(err, ErrDemoCapacity) {
		t.Fatalf("capacity error = %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE users SET demo_expires_at=? WHERE id=?`, formatTime(time.Now().Add(-time.Hour)), guest.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(ctx, guest.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expired guest authentication = %v", err)
	}
	if err := store.CleanupExpiredDemoUsers(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id=?`, guest.User.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("expired guest count = %d, %v", count, err)
	}
	if _, err := store.CreateDemoSession(ctx); err != nil {
		t.Fatalf("replacement guest = %v", err)
	}
}

func TestDemoSessionRequiresConfiguredLibrary(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	if store.DemoAvailable() {
		t.Fatal("demo unexpectedly available")
	}
	if _, err := store.CreateDemoSession(ctx); !errors.Is(err, ErrDemoDisabled) {
		t.Fatalf("disabled demo error = %v", err)
	}
	configured, _ := openTestStore(t, Options{DemoLibraryID: "missing"})
	if ready, err := configured.DemoReady(ctx); err != nil || ready {
		t.Fatalf("missing demo library ready = %v, %v", ready, err)
	}
	if _, err := configured.CreateDemoSession(ctx); !errors.Is(err, ErrDemoDisabled) {
		t.Fatalf("missing library error = %v", err)
	}
}

func TestAdminUserManagement(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	session, err := store.Setup(ctx, Credentials{Username: "admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetDisabled(ctx, session.User, session.User.ID, true); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("disable last admin = %v", err)
	}
	user, err := store.CreateUser(ctx, session.User, Credentials{Username: "reader", Password: testPassword}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateUser(ctx, session.User, Credentials{Username: "READER", Password: testPassword}, false); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("duplicate username = %v", err)
	}
	if err := store.SetDisabled(ctx, user, user.ID, true); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-admin disable = %v", err)
	}
	if err := store.SetDisabled(ctx, session.User, user.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "reader", Password: testPassword}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled login = %v", err)
	}
	users, err := store.Users(ctx, session.User, 50, 0)
	if err != nil || len(users) != 2 {
		t.Fatalf("users = %#v, %v", users, err)
	}
}
