package v1

import (
	"net/http"

	"github.com/mahcks/aldus/server/internal/auth"
)

func actor(r *http.Request) auth.User {
	user, _ := auth.UserFromContext(r.Context())
	return user
}
