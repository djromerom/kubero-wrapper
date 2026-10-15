ALTER TABLE projects ADD COLUMN source_commit VARCHAR(40);
ALTER TABLE projects ADD COLUMN adaptation_report JSONB;
ALTER TABLE projects ADD COLUMN approved_image TEXT;
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'adapting';
ALTER TABLE projects ADD COLUMN adaptation_claimed_at TIMESTAMPTZ;
