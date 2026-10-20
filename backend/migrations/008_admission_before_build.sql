ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE projects ADD COLUMN registration_approved_at TIMESTAMPTZ;

UPDATE projects
SET registration_approved_at = updated_at
WHERE status IN ('approved', 'building', 'running');

UPDATE projects
SET status = 'pending', adaptation_claimed_at = NULL,
    adaptation_report = NULL, approved_image = NULL, updated_at = NOW()
WHERE status = 'adapting';
