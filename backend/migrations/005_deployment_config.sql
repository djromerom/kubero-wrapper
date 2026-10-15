ALTER TABLE projects ADD COLUMN deployment_config jsonb NOT NULL DEFAULT '{}'::jsonb;
