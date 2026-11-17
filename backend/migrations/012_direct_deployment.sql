-- Keep the existing 'approved' enum value as the deployment queue state.
-- Administrative approval timestamps are retained only as historical data.
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'approved';

UPDATE projects
SET status = CASE
        WHEN source_commit ~ '^[a-fA-F0-9]{40}$' THEN 'approved'::project_status
        ELSE 'failed'::project_status
    END,
    adaptation_report = CASE
        WHEN source_commit ~ '^[a-fA-F0-9]{40}$' THEN NULL
        ELSE '{"summary":"Actualiza el proyecto para seleccionar un commit válido y vuelve a desplegar.","build_verified":false,"runtime_verified":false}'::jsonb
    END,
    approved_image = NULL, adaptation_claimed_at = NULL,
    review_note = NULL, correction_fields = '{}', updated_at = NOW()
WHERE status IN ('pending', 'corrections') AND deletion_requested_at IS NULL;
