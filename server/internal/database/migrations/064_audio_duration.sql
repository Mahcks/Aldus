-- File duration is display metadata, not an authoritative reading position.
ALTER TABLE media ADD COLUMN duration_ms INTEGER CHECK (duration_ms > 0);
