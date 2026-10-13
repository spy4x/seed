-- #387: wrong passwords are counted per sign-in name, from every network address together, with a
-- short lock (@spy4x/server/lockout). `subject` is the SHA-256 of the normalised address or
-- username that was typed, so the table holds nothing a person typed and has a row for a name no
-- account uses too: a locked name tells nothing about whether an account exists. The API deletes
-- the rows that no longer decide anything (apps/api/services/password-failures.ts).
CREATE TABLE password_failures (
    subject CHAR(64) PRIMARY KEY,
    failed_attempts INT4 DEFAULT 0 NOT NULL,
    locked_until TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    CONSTRAINT password_failures_failed_attempts_check CHECK (failed_attempts >= 0)
);
