-- Freeze the trust context before contacting CI. Existing submissions fail closed
-- until an operator reconciles them; do not invent their historical destination.
ALTER TABLE ci_runs ADD COLUMN woodpecker_url TEXT;
ALTER TABLE ci_runs ADD COLUMN registry_url TEXT;
ALTER TABLE ci_runs ADD COLUMN expected_author TEXT;
ALTER TABLE ci_runs ADD COLUMN authorization_expires_at TIMESTAMPTZ;
