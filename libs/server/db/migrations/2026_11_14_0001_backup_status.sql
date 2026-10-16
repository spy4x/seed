-- #429: the operator area's System page shows when the last backup finished. The backup service
-- (`infra/backup/backup.sh`) writes one row per target after a backup that finished well; the API
-- only reads it. `target` is `database` today.
CREATE TABLE backup_status (
    target VARCHAR(32) PRIMARY KEY,
    succeeded_at TIMESTAMPTZ NOT NULL
);
