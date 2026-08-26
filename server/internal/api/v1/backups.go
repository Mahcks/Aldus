package v1

import (
	"errors"
	"mime"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/backup"
)

func registerBackupRoutes(router chi.Router, manager *backup.Manager) {
	router.Get("/system/backups", listBackups(manager))
	router.Post("/system/backups", createBackup(manager))
	router.Get("/system/backups/{name}", downloadBackup(manager))
	router.Delete("/system/backups/{name}", deleteBackup(manager))
}

func listBackups(manager *backup.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		archives, err := manager.List(actor(r))
		if writeBackupError(w, err) {
			return
		}
		values := make([]contracts.BackupArchive, len(archives))
		for i, archive := range archives {
			values[i] = backupContract(archive)
		}
		writeJSON(w, http.StatusOK, values)
	}
}

func createBackup(manager *backup.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		archive, err := manager.Create(r.Context(), actor(r))
		if writeBackupError(w, err) {
			return
		}
		writeJSON(w, http.StatusCreated, backupContract(archive))
	}
}

func downloadBackup(manager *backup.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		file, archive, err := manager.Open(actor(r), chi.URLParam(r, "name"))
		if writeBackupError(w, err) {
			return
		}
		defer file.Close()
		w.Header().Set("Content-Type", "application/gzip")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": archive.Name}))
		http.ServeContent(w, r, archive.Name, archive.CreatedAt, file)
	}
}

func deleteBackup(manager *backup.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := manager.Delete(actor(r), chi.URLParam(r, "name")); writeBackupError(w, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func backupContract(archive backup.Archive) contracts.BackupArchive {
	return contracts.BackupArchive{Name: archive.Name, CreatedAt: archive.CreatedAt, SizeBytes: archive.SizeBytes}
}

func writeBackupError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, backup.ErrForbidden):
		http.Error(w, "forbidden", http.StatusForbidden)
	case errors.Is(err, backup.ErrNotFound):
		http.Error(w, "backup not found", http.StatusNotFound)
	default:
		http.Error(w, "backup operation failed", http.StatusInternalServerError)
	}
	return true
}
