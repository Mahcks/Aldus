package v1

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/ownership"
	"github.com/mahcks/aldus/server/internal/position"
)

func registerOwnershipRoutes(router chi.Router, store *ownership.Store) {
	router.Get("/works/{workID}/reading-session", readingSession(store))
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
		}, func(ctx context.Context, tx *sql.Tx) error {
			progress, states, err := position.ReadingSnapshotTx(ctx, tx, user.ID, workID)
			if err != nil {
				return err
			}
			if progress != nil {
				dto := canonicalDTO(*progress)
				snapshot.Progress = &dto
			}
			for _, state := range states {
				snapshot.RepresentationStates = append(snapshot.RepresentationStates, representationStateDTO(state))
			}
			return nil
		})
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
