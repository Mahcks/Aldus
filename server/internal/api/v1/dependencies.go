package v1

import (
	"context"
	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/collection"
	"github.com/mahcks/aldus/server/internal/diagnostics"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/notification"
	"github.com/mahcks/aldus/server/internal/position"
	"github.com/mahcks/aldus/server/internal/source"
)

type Dependencies struct {
	Position            *position.Store
	Auth                *auth.Store
	Catalog             *catalog.Store
	Collections         *collection.Store
	Ingest              *ingest.Store
	Sources             *source.Store
	AlignmentJobs       *alignment.Manager
	Acquisitions        *acquisition.Store
	AcquisitionPolicies *acquisition.PolicyStore
	TitleRequests       *acquisition.TitleRequestStore
	Diagnostics         *diagnostics.Store
	Notifications       *notification.Store
	Ready               func(context.Context) error
}
