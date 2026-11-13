-- #696: records brought in from a file a person uploads (docs/imports.md). One row per upload,
-- holding the file's bytes until the batch is saved, the read fails or the nightly cleanup drops
-- an import nobody saved within a day. `kind` names the import kind in the server's registry
-- (`libs/server/imports/registry.ts`). `status`: 1 reading, 2 ready, 3 failed, 4 saving, 5 saved,
-- 6 undone. Each step's time is kept, so the admin can show how long each one took.
CREATE TABLE imports (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(64) NOT NULL,
    status INT2 NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size INT4 NOT NULL,
    file BYTEA,
    columns JSONB,
    sample JSONB,
    mapping JSONB,
    row_count INT4,
    saved_count INT4,
    error_count INT4,
    failure VARCHAR(500),
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read_at TIMESTAMPTZ(3),
    failed_at TIMESTAMPTZ(3),
    commit_requested_at TIMESTAMPTZ(3),
    committed_at TIMESTAMPTZ(3),
    undone_at TIMESTAMPTZ(3),
    CONSTRAINT imports_status_check CHECK (status BETWEEN 1 AND 6),
    CONSTRAINT imports_file_size_check CHECK (file_size >= 0),
    CONSTRAINT imports_failure_check CHECK ((failure IS NULL) = (failed_at IS NULL))
);

-- A person's imports in a group, newest first; the cleanup's scan by age.
CREATE INDEX idx_imports_group_user_created ON imports (group_id, user_id, created_at DESC);
CREATE INDEX idx_imports_created ON imports (created_at) WHERE committed_at IS NULL;
CREATE INDEX idx_imports_user ON imports (user_id);

-- The records one saved import made, so undo removes that batch and nothing else. A join table
-- rather than a column on each aggregate: a kind adds no column to its own table, and the
-- records keep no trace of the import once its row is gone.
CREATE TABLE import_records (
    import_id UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    record_id UUID NOT NULL,
    PRIMARY KEY (import_id, record_id)
);
