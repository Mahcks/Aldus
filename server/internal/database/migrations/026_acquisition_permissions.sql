ALTER TABLE library_members ADD COLUMN can_bypass_acquisition_approval INTEGER NOT NULL DEFAULT 0 CHECK (can_bypass_acquisition_approval IN (0,1));
ALTER TABLE library_members ADD COLUMN can_advanced_acquisition_request INTEGER NOT NULL DEFAULT 0 CHECK (can_advanced_acquisition_request IN (0,1));

-- Preserve the direct, release-selecting request behavior existing members had.
UPDATE library_members
SET can_bypass_acquisition_approval=can_request_acquisitions,
    can_advanced_acquisition_request=can_request_acquisitions;
