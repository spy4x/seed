-- Note attachments (#225, docs/files.md). A file is kept in the file store under `object_key`;
-- this table says which note it belongs to. A note's group is the file's group, so a file moves
-- with its note and needs no group column of its own. Deleting the note (its purge, its group's,
-- its owner's account) deletes the row through the foreign key, and the trigger below queues the
-- stored object for the worker to delete.
CREATE TABLE note_attachments (
    id UUID PRIMARY KEY,
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    object_key VARCHAR(200) NOT NULL,
    name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INT4 NOT NULL,
    created_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT note_attachments_object_key_unique UNIQUE (object_key),
    CONSTRAINT note_attachments_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 255),
    CONSTRAINT note_attachments_size_check CHECK (size_bytes >= 1)
);

CREATE INDEX idx_note_attachments_note ON note_attachments (note_id, created_at, id);
CREATE INDEX idx_note_attachments_created_by ON note_attachments (created_by_user_id);

-- An upload that was signed. The browser PUTs to `staging_key`; the confirm settles this row
-- first (`settled_at`), so one upload is confirmed at most once, and only by `user_id`. The id is
-- the attachment's id once confirmed. The worker deletes rows older than a day.
CREATE TABLE note_attachment_uploads (
    id UUID PRIMARY KEY,
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    staging_key VARCHAR(200) NOT NULL,
    name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INT4 NOT NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- When the upload was confirmed or cancelled; NULL while it waits. A settled row stays until
    -- the clean-up, so the hourly upload budget still counts it.
    settled_at TIMESTAMPTZ(3),
    CONSTRAINT note_attachment_uploads_staging_key_unique UNIQUE (staging_key),
    CONSTRAINT note_attachment_uploads_size_check CHECK (size_bytes >= 1)
);

CREATE INDEX idx_note_attachment_uploads_note ON note_attachment_uploads (note_id);
CREATE INDEX idx_note_attachment_uploads_user ON note_attachment_uploads (user_id);
CREATE INDEX idx_note_attachment_uploads_created ON note_attachment_uploads (created_at);

-- Stored objects to delete. No foreign key, so the demo's nightly wipe keeps it (KEPT_TABLES) and
-- a deleted row's object is still found. The worker deletes the object, then the row.
CREATE TABLE file_deletions (
    object_key VARCHAR(200) PRIMARY KEY,
    queued_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE FUNCTION queue_note_attachment_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO file_deletions (object_key) VALUES (OLD.object_key) ON CONFLICT DO NOTHING;
    RETURN OLD;
END;
$$;

CREATE TRIGGER note_attachments_queue_deletion
    AFTER DELETE ON note_attachments
    FOR EACH ROW EXECUTE FUNCTION queue_note_attachment_deletion();
