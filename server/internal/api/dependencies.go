package api

import (
	"github.com/mahcks/aldus/server/internal/acquisition"
	"io/fs"
	"net/http"

	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/position"
	"github.com/mahcks/aldus/server/internal/source"
)

type Dependencies struct {
	Web            fs.FS
	Media          http.FileSystem
	Position       *position.Store
	Auth           *auth.Store
	Catalog        *catalog.Store
	Ingest         *ingest.Store
	Sources        *source.Store
	AlignmentJobs  *alignment.Manager
	Acquisitions   *acquisition.Store
	KOReader       koreader.Credentials
	AllowedOrigins []string
}
