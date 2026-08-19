package v1

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/notification"
)

func registerNotificationRoutes(router chi.Router, store *notification.Store) {
	router.Get("/me/notifications", listNotifications(store))
	router.Get("/me/notifications/unread-count", unreadNotificationCount(store))
	router.Post("/me/notifications/{notificationID}/read", markNotificationRead(store))
	router.Post("/me/notifications/read-all", markAllNotificationsRead(store))
}

func listNotifications(store *notification.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		items, err := store.List(r.Context(), actor(r).ID, limit, offset)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		count, err := store.UnreadCount(r.Context(), actor(r).ID)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		values := make([]contracts.Notification, len(items))
		for i, item := range items {
			values[i] = notificationDTO(item)
		}
		writeJSON(w, http.StatusOK, contracts.NotificationList{Items: values, UnreadCount: count})
	}
}

func unreadNotificationCount(store *notification.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		count, err := store.UnreadCount(r.Context(), actor(r).ID)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, contracts.NotificationUnreadCount{UnreadCount: count})
	}
}

func markNotificationRead(store *notification.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.MarkRead(r.Context(), actor(r).ID, chi.URLParam(r, "notificationID")); err != nil {
			writeNotificationError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func markAllNotificationsRead(store *notification.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.MarkAllRead(r.Context(), actor(r).ID); err != nil {
			writeNotificationError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func notificationDTO(value notification.Event) contracts.Notification {
	return contracts.Notification{ID: value.ID, Kind: value.Kind, Title: value.Title, Body: value.Body, ActionURL: value.ActionURL, CreatedAt: value.CreatedAt, ReadAt: value.ReadAt}
}

func writeNotificationError(w http.ResponseWriter, err error) {
	if errors.Is(err, notification.ErrNotFound) {
		http.Error(w, "notification not found", http.StatusNotFound)
		return
	}
	slog.Error("notification request failed", "error", err)
	http.Error(w, "internal server error", http.StatusInternalServerError)
}
