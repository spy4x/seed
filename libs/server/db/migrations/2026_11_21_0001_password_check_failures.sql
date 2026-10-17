-- #406: wrong passwords typed by a signed-in account at the steps that ask for it again (two-factor
-- on or off, a new password or address, deleting the account, linking a provider, an API token,
-- handing a group over), counted per user with the sign-in page's short lock
-- (apps/api/services/password-failures.ts). Only a signed-in caller adds to it, so a stranger
-- cannot lock anybody.
CREATE TABLE password_check_failures (
    user_id INT4 PRIMARY KEY REFERENCES auth_users (id) ON DELETE CASCADE,
    failed_attempts INT4 DEFAULT 0 NOT NULL,
    locked_until TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    CONSTRAINT password_check_failures_failed_attempts_check CHECK (failed_attempts >= 0)
);
