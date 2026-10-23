-- #229: a person downloads their data. A request writes one row and queues the worker job that
-- builds the ZIP into the file store under `data-exports/<id>.zip`. The job sets `ready_at`,
-- `expires_at` and `size_bytes` once the file is stored; a second job deletes the file at
-- `expires_at` and sets `expired_at`. A row still without `ready_at` a day after `requested_at`
-- reads as failed. One request a day per person: the request locks the person's `users` row and
-- looks for a row of the last 24 hours, so two requests at once still make one row.
--
-- The row hangs off `auth_users`, so deleting an account takes it along; the file goes with its
-- expiry job, which deletes the key whether or not the row still exists.
CREATE TABLE data_exports (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ready_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    size_bytes INT8,
    CONSTRAINT data_exports_ready_check
        CHECK ((ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL) = (size_bytes IS NULL)),
    CONSTRAINT data_exports_size_check CHECK (size_bytes >= 0)
);

-- A person's exports, newest first: the profile's latest one, the admin's list and the day's limit.
CREATE INDEX idx_data_exports_user_requested ON data_exports (user_id, requested_at DESC);
