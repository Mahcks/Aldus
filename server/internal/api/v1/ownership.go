package v1

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/ownership"
	"github.com/mahcks/aldus/server/internal/position"
)

func registerOwnershipRoutes(router chi.Router, store *ownership.Store) {
	router.Post("/works/{workID}/progress/reset", resetReadingProgress(store))
	router.Get("/works/{workID}/reading-session", readingSession(store))
	router.Get("/works/{workID}/reading-session/watch", watchReadingSession(store))
	router.Post("/works/{workID}/reading-session/claim", claimReadingSession(store))
	router.Post("/works/{workID}/reading-session/heartbeat", refreshReadingSession(store))
}

// readingSession has no side effects: book details use it to say who is active.
func readingSession(store *ownership.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Get(r.Context(), actor(r), chi.URLParam(r, "workID"))
		writeOwnershipResult(w, value, err)
	}
}

func claimReadingSession(store *ownership.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.ClaimReadingSessionRequest
		if !decode(w, r, &request) {
			return
		}
		var snapshot contracts.ReadingClaim
		snapshot.RepresentationStates = []contracts.RepresentationState{}
		user := actor(r)
		workID := chi.URLParam(r, "workID")
		value, err := store.ClaimWithSnapshot(r.Context(), user, workID, ownership.Claim{
			DeviceID:      request.DeviceID,
			Label:         request.Label,
			Platform:      request.Platform,
			RequestID:     request.RequestID,
			ExpectedEpoch: request.ExpectedEpoch,
		}, captureReadingSnapshot(&snapshot, user.ID, workID))
		if err != nil {
			writeOwnershipResult(w, nil, err)
			return
		}
		snapshot.Owner = *readingOwnerDTO(value)
		writeJSON(w, http.StatusOK, snapshot)
	}
}

func refreshReadingSession(store *ownership.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.ReadingOwnershipProof
		if !decode(w, r, &request) {
			return
		}
		value, err := store.Refresh(r.Context(), actor(r), chi.URLParam(r, "workID"), ownership.Proof{
			DeviceID: request.DeviceID,
			Epoch:    request.Epoch,
		})
		writeOwnershipResult(w, value, err)
	}
}

// writeOwnershipResult answers with the current owner, or null when nobody has claimed the book.
func writeOwnershipResult(w http.ResponseWriter, value *ownership.Session, err error) {
	var superseded *ownership.Superseded
	switch {
	case errors.As(err, &superseded):
		writeJSON(w, http.StatusConflict, contracts.ReadingOwnershipConflict{
			Code:  "ownership_superseded",
			Owner: readingOwnerDTO(superseded.Owner),
		})
	case errors.Is(err, ownership.ErrInvalid):
		http.Error(w, "invalid reading session", http.StatusBadRequest)
	case errors.Is(err, ownership.ErrNotFound):
		http.Error(w, "book not found", http.StatusNotFound)
	case err != nil:
		slog.Error("reading session request failed", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, readingOwnerDTO(value))
	}
}

// A completed JSON response avoids streaming/proxy buffering on native clients.
func watchReadingSession(store *ownership.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		epoch, err := strconv.ParseInt(r.URL.Query().Get("epoch"), 10, 64)
		if err != nil || epoch < 0 || epoch > 9007199254740991 {
			http.Error(w, "invalid reading epoch", http.StatusBadRequest)
			return
		}

		value, err := store.Watch(r.Context(), actor(r), chi.URLParam(r, "workID"), epoch, 25*time.Second)
		if r.Context().Err() != nil {
			return
		}
		if errors.Is(err, ownership.ErrWatchLimit) {
			w.Header().Set("Retry-After", "15")
			http.Error(w, "too many reading watches", http.StatusTooManyRequests)
			return
		}
		writeOwnershipResult(w, value, err)
	}
}

func resetReadingProgress(store *ownership.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.ClaimReadingSessionRequest
		if !decode(w, r, &request) {
			return
		}
		user := actor(r)
		workID := chi.URLParam(r, "workID")
		var snapshot contracts.ReadingClaim
		value, err := store.ResetWithClaim(r.Context(), user, workID, ownership.Claim{
			DeviceID:      request.DeviceID,
			Label:         request.Label,
			Platform:      request.Platform,
			RequestID:     request.RequestID,
			ExpectedEpoch: request.ExpectedEpoch,
		}, func(ctx context.Context, tx *sql.Tx) error {
			return position.ResetTx(ctx, tx, user.ID, workID)
		}, captureReadingSnapshot(&snapshot, user.ID, workID))
		if err != nil {
			writeOwnershipResult(w, nil, err)
			return
		}
		snapshot.Owner = *readingOwnerDTO(value)
		writeJSON(w, http.StatusOK, snapshot)
	}
}

func captureReadingSnapshot(snapshot *contracts.ReadingClaim, userID, workID string) func(context.Context, *sql.Tx) error {
	return func(ctx context.Context, tx *sql.Tx) error {
		epoch, err := position.ResetEpochTx(ctx, tx, userID, workID)
		if err != nil {
			return err
		}
		snapshot.ResetEpoch = epoch
		progress, states, err := position.ReadingSnapshotTx(ctx, tx, userID, workID)
		if err != nil {
			return err
		}
		if progress != nil {
			dto := canonicalDTO(*progress)
			snapshot.Progress = &dto
		}
		snapshot.RepresentationStates = []contracts.RepresentationState{}
		for _, state := range states {
			snapshot.RepresentationStates = append(snapshot.RepresentationStates, representationStateDTO(state))
		}
		return nil
	}
}
