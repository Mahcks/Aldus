package api

import (
	"io/fs"
	"net/http"

	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/position"
)

type Dependencies struct {
	Web            fs.FS
	Media          http.FileSystem
	Position       *position.Store
	Auth           *auth.Store
	Catalog        *catalog.Store
	Ingest         *ingest.Store
	AlignmentJobs  *alignment.Manager
	KOReader       koreader.Credentials
	AllowedOrigins []string
}
