-- Historical failures are not evidence that the current attempt is retryable.
ALTER TABLE acquisition_requests ADD COLUMN failure_kind TEXT NOT NULL DEFAULT ''
    CHECK (failure_kind IN ('', 'release'));
