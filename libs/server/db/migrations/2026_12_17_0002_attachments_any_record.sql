-- #1180: attachments on any record kind, not only notes (docs/attachments-and-pictures.md).
-- A waiting upload names its record by kind and id instead of `note_id`; both are NULL for a
-- profile picture. No foreign key: the confirm checks the record is still live under the group's
-- lock, and the worker deletes rows older than a day.
ALTER TABLE file_uploads ADD COLUMN record_kind VARCHAR(40);
ALTER TABLE file_uploads ADD COLUMN record_id UUID;

UPDATE file_uploads SET record_kind = 'note', record_id = note_id WHERE note_id IS NOT NULL;

DROP INDEX idx_file_uploads_note;
ALTER TABLE file_uploads DROP COLUMN note_id;

ALTER TABLE file_uploads ADD CONSTRAINT file_uploads_record_check
    CHECK ((record_kind IS NULL) = (record_id IS NULL));
CREATE INDEX idx_file_uploads_record ON file_uploads (record_kind, record_id);

-- One deletion trigger function for every kind's attachment table.
CREATE FUNCTION queue_attachment_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO file_deletions (object_key) VALUES (OLD.object_key) ON CONFLICT DO NOTHING;
    RETURN OLD;
END;
$$;

DROP TRIGGER note_attachments_queue_deletion ON note_attachments;
CREATE TRIGGER note_attachments_queue_deletion
    AFTER DELETE ON note_attachments
    FOR EACH ROW EXECUTE FUNCTION queue_attachment_deletion();

DROP FUNCTION queue_note_attachment_deletion();
