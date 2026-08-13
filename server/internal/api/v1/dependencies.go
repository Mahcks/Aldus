package v1

import (
	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/position"
)

type Dependencies struct {
	Position      *position.Store
	Auth          *auth.Store
	Catalog       *catalog.Store
	Ingest        *ingest.Store
	AlignmentJobs *alignment.Manager
}
