ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'corrections';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'approved';

ALTER TABLE projects ADD COLUMN requested_subdomain VARCHAR(63);
ALTER TABLE projects ADD COLUMN purpose TEXT;
ALTER TABLE projects ADD COLUMN course VARCHAR(255);
ALTER TABLE projects ADD COLUMN review_note TEXT;

CREATE UNIQUE INDEX projects_active_subdomain_unique
    ON projects (requested_subdomain)
    WHERE status != 'deleted';
