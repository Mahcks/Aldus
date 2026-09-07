CREATE INDEX title_requests_library_created ON title_requests(library_id, created_at DESC, id);
CREATE INDEX title_requests_library_requester_created ON title_requests(library_id, requested_by, created_at DESC, id);
