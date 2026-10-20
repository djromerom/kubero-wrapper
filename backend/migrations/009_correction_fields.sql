ALTER TABLE projects ADD COLUMN correction_fields TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE projects ADD CONSTRAINT projects_correction_fields_valid
    CHECK (correction_fields <@ ARRAY['name', 'repo_url', 'branch', 'purpose', 'requested_subdomain', 'course']::TEXT[]);

-- Existing requests used a fixed description-only correction form.
UPDATE projects SET correction_fields = ARRAY['purpose'] WHERE status = 'corrections';
