-- Profile pictures (#228, docs/files.md). A person's picture is kept in the file store under
-- `pictures/<picture_id>`; a new picture gets a new id, so its URL changes with it.
-- `picture_type` is the type the store confirmed, which its download is served as.
ALTER TABLE users ADD COLUMN picture_id UUID;
ALTER TABLE users ADD COLUMN picture_type VARCHAR(20);
ALTER TABLE users ADD CONSTRAINT users_picture_id_unique UNIQUE (picture_id);
ALTER TABLE users ADD CONSTRAINT users_picture_check
    CHECK ((picture_id IS NULL) = (picture_type IS NULL));

-- The signed uploads of every feature, so one person's waiting uploads and hourly budget count
-- them all. A note attachment's row names its note; a profile picture's has none.
ALTER TABLE note_attachment_uploads RENAME TO file_uploads;
ALTER TABLE file_uploads ALTER COLUMN note_id DROP NOT NULL;
ALTER TABLE file_uploads RENAME CONSTRAINT note_attachment_uploads_pkey TO file_uploads_pkey;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_note_id_fkey TO file_uploads_note_id_fkey;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_user_id_fkey TO file_uploads_user_id_fkey;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_staging_key_unique TO file_uploads_staging_key_unique;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_size_check TO file_uploads_size_check;
-- Postgres 18 names each NOT NULL constraint after its table too.
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_id_not_null TO file_uploads_id_not_null;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_user_id_not_null TO file_uploads_user_id_not_null;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_staging_key_not_null TO file_uploads_staging_key_not_null;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_name_not_null TO file_uploads_name_not_null;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_content_type_not_null TO file_uploads_content_type_not_null;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_size_bytes_not_null TO file_uploads_size_bytes_not_null;
ALTER TABLE file_uploads
    RENAME CONSTRAINT note_attachment_uploads_created_at_not_null TO file_uploads_created_at_not_null;
ALTER INDEX idx_note_attachment_uploads_note RENAME TO idx_file_uploads_note;
ALTER INDEX idx_note_attachment_uploads_user RENAME TO idx_file_uploads_user;
ALTER INDEX idx_note_attachment_uploads_created RENAME TO idx_file_uploads_created;

-- A replaced or removed picture, and the picture of an account deleted for good, is queued for the
-- worker to delete from the store.
CREATE FUNCTION queue_user_picture_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.picture_id IS NOT NULL
        AND (TG_OP = 'DELETE' OR NEW.picture_id IS DISTINCT FROM OLD.picture_id) THEN
        INSERT INTO file_deletions (object_key) VALUES ('pictures/' || OLD.picture_id)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER users_queue_picture_deletion
    AFTER UPDATE OF picture_id OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION queue_user_picture_deletion();

-- 36: an operator removed the person's picture.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
