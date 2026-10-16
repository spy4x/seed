-- #424: the operator dashboard counts the people active on each of the last 30 days from the audit
-- trail. It reads `auth_audits` by `created_at` alone, which no index served: the existing one
-- leads with `user_id`. `audit_events` already has `idx_audit_events_created`.
CREATE INDEX idx_auth_audits_created_at ON auth_audits (created_at);
