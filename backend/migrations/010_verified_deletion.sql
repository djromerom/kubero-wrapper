ALTER TABLE projects ADD COLUMN deletion_requested_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN deletion_error TEXT;

CREATE INDEX idx_projects_deletion_queue ON projects(deletion_requested_at)
WHERE deletion_requested_at IS NOT NULL AND status != 'deleted';
