package v1

import (
	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/position"
)

func userDTO(v auth.User) contracts.User {
	return contracts.User{ID: v.ID, Username: v.Username, DisplayName: v.DisplayName, Admin: v.Admin, Disabled: v.Disabled, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func sessionDTO(v auth.Session) contracts.Session {
	return contracts.Session{Token: v.Token, ExpiresAt: v.ExpiresAt, User: userDTO(v.User)}
}
func libraryDTO(v catalog.Library) contracts.Library {
	return contracts.Library{ID: v.ID, Name: v.Name, Role: v.Role, CanRequestAcquisitions: v.CanRequest, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func workDTO(v catalog.Work) contracts.Work {
	return contracts.Work{ID: v.ID, LibraryID: v.LibraryID, Title: v.Title, Author: v.Author, CoverURL: v.CoverURL, CoverFit: v.CoverFit, CoverFocalX: v.CoverFocalX, CoverFocalY: v.CoverFocalY, GeneratedCoverStyle: v.GeneratedCoverStyle, GeneratedCoverTone: v.GeneratedCoverTone, GeneratedCoverLayout: v.GeneratedCoverLayout, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func workDetailDTO(v catalog.WorkDetail) contracts.WorkDetail {
	return contracts.WorkDetail{Work: workDTO(v.Work), InProgress: v.InProgress, ProgressUpdatedAt: v.ProgressUpdatedAt, CompletionPercent: v.CompletionPercent, ActiveSeconds: v.ActiveSeconds, ReadingSeconds: v.ReadingSeconds, ListeningSeconds: v.ListeningSeconds, LastMode: v.LastMode}
}
func representationDTO(v catalog.Representation) contracts.Representation {
	return contracts.Representation{ID: v.ID, WorkID: v.WorkID, Kind: v.Kind, Label: v.Label, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func membershipDTO(v catalog.Membership) contracts.Membership {
	return contracts.Membership{UserID: v.UserID, Username: v.Username, DisplayName: v.DisplayName, Role: v.Role, CanRequestAcquisitions: v.CanRequest}
}
func mediaDTO(v ingest.Media) contracts.Media {
	return contracts.Media{ID: v.ID, RepresentationID: v.RepresentationID, Kind: v.Kind, SHA256: v.SHA256, OriginalFilename: v.OriginalFilename, SizeBytes: v.SizeBytes, CreatedAt: v.CreatedAt}
}
func audioChapterDTOs(values []ingest.AudioChapter) []contracts.AudioChapter {
	out := make([]contracts.AudioChapter, len(values))
	for i, value := range values {
		out[i] = contracts.AudioChapter{Title: value.Title, StartMS: value.StartMS, EndMS: value.EndMS}
	}
	return out
}
func jobDTO(v alignment.Job) contracts.AlignmentJob {
	return contracts.AlignmentJob{ID: v.ID, AlignmentID: v.AlignmentID, EPUBMediaID: v.EPUBMediaID, AudioMediaID: v.AudioMediaID, State: v.State, Attempts: v.Attempts, WorkerVersion: v.WorkerVersion, Model: v.Model, ArtifactID: v.ArtifactID, Error: v.Error, CreatedAt: v.CreatedAt, StartedAt: v.StartedAt, FinishedAt: v.FinishedAt}
}
func canonicalDTO(v position.Canonical) contracts.CanonicalPosition {
	return contracts.CanonicalPosition{WorkID: v.WorkID, AlignmentID: v.AlignmentID, SegmentID: v.SegmentID, Offset: v.Offset, Revision: v.Revision, UpdatedAt: v.UpdatedAt, SourceDevice: v.SourceDevice, AlignmentState: v.AlignmentState, Resolvable: v.Resolvable}
}
func activityDTO(v position.ActivitySession) contracts.ActivitySession {
	return contracts.ActivitySession{ID: v.ID, WorkID: v.WorkID, Mode: v.Mode, StartedAt: v.StartedAt, LastSeenAt: v.LastSeenAt, EndedAt: v.EndedAt, ActiveSeconds: v.ActiveSeconds}
}
func representationStateDTO(v position.RepresentationState) contracts.RepresentationState {
	return contracts.RepresentationState{RepresentationID: v.RepresentationID, EPUBLocator: v.EPUBLocator, AudioTimestampMS: v.AudioTimestampMS, PlaybackSpeed: v.PlaybackSpeed, ReaderLayout: v.ReaderLayout, Zoom: v.Zoom, ReaderTheme: v.ReaderTheme, LineHeight: v.LineHeight, Margin: v.Margin, Revision: v.Revision, UpdatedAt: v.UpdatedAt}
}
func epubLocatorDTO(v position.EPUBLocator) contracts.EPUBLocator {
	return contracts.EPUBLocator{Href: v.Href, Locator: v.Locator, Offset: v.Offset}
}
func audioLocatorDTO(v position.AudioLocator) contracts.AudioLocator {
	return contracts.AudioLocator{Resource: v.Resource, TimestampMS: v.TimestampMS}
}
func alignmentDTO(v position.Alignment) contracts.Alignment {
	out := contracts.Alignment{ID: v.ID, Revision: v.Revision, State: v.State, EPUBSHA256: v.EPUBSHA256, AudioSHA256: v.AudioSHA256, Segments: make([]contracts.AlignmentSegment, len(v.Segments))}
	for i, s := range v.Segments {
		out.Segments[i] = contracts.AlignmentSegment{ID: s.ID, Ordinal: s.Ordinal, Text: s.Text, EPUBHref: s.EPUBHref, EPUBLocator: s.EPUBLocator, KOReaderLocator: s.KOReaderLocator, AudioResource: s.AudioResource, AudioStartMS: s.AudioStartMS, AudioEndMS: s.AudioEndMS, Highlightable: s.Highlightable, AlignmentStatus: s.AlignmentStatus, WordTimings: s.WordTimings}
	}
	return out
}

func libraryDTOs(values []catalog.Library) []contracts.Library {
	out := make([]contracts.Library, len(values))
	for i, v := range values {
		out[i] = libraryDTO(v)
	}
	return out
}
func workDTOs(values []catalog.Work) []contracts.Work {
	out := make([]contracts.Work, len(values))
	for i, v := range values {
		out[i] = workDTO(v)
	}
	return out
}
func representationDTOs(values []catalog.Representation) []contracts.Representation {
	out := make([]contracts.Representation, len(values))
	for i, v := range values {
		out[i] = representationDTO(v)
	}
	return out
}
func membershipDTOs(values []catalog.Membership) []contracts.Membership {
	out := make([]contracts.Membership, len(values))
	for i, v := range values {
		out[i] = membershipDTO(v)
	}
	return out
}
func mediaDTOs(values []ingest.Media) []contracts.Media {
	out := make([]contracts.Media, len(values))
	for i, v := range values {
		out[i] = mediaDTO(v)
	}
	return out
}
