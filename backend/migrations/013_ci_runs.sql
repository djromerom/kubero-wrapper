-- CI is independent of the historical deployment state. Preserve all existing data.
ALTER TABLE projects ADD COLUMN ci_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN registration_key UUID;
ALTER TABLE projects ADD COLUMN registration_hash TEXT;
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'pending';
CREATE UNIQUE INDEX projects_registration_key ON projects(user_id, registration_key)
    WHERE registration_key IS NOT NULL;

CREATE TABLE ci_runs (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo_url TEXT NOT NULL,
    branch TEXT NOT NULL,
    commit_sha TEXT NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
    status TEXT NOT NULL CHECK (status IN
        ('queued','blocked','submitting','submission_unknown','pending','running','verifying','published','failed','cancelled')),
    mode TEXT NOT NULL,
    woodpecker_repo_id BIGINT,
    pipeline_id BIGINT,
    pipeline_number BIGINT,
    image_repository TEXT,
    image_tag TEXT NOT NULL,
    image_digest TEXT,
    image_reference TEXT,
    platform TEXT NOT NULL DEFAULT 'linux/arm64',
    message TEXT,
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_poll_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (woodpecker_repo_id, pipeline_number)
);
CREATE UNIQUE INDEX ci_one_active_run ON ci_runs(project_id)
    WHERE status IN ('queued','blocked','submitting','submission_unknown','pending','running','verifying');
CREATE INDEX ci_poll_queue ON ci_runs(next_poll_at) WHERE completed_at IS NULL;
