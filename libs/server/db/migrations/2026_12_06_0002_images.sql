-- Processed images (#464, docs/files.md). An uploaded photo gets a row in `images`, keyed by its
-- original's object; the worker's `files.image-process` job stores its AVIF and WebP widths in
-- `image_variants` and then deletes the original, so no copy with its metadata stays.
-- `refused` is the processor's reason (`ImageRefusal` of @spy4x/server/images) when it made none.
CREATE TABLE images (
    id UUID PRIMARY KEY,
    object_key VARCHAR(200) NOT NULL,
    processed_at TIMESTAMPTZ(3),
    refused SMALLINT,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT images_object_key_unique UNIQUE (object_key)
);

CREATE TABLE image_variants (
    object_key VARCHAR(200) PRIMARY KEY,
    image_id UUID NOT NULL REFERENCES images (id) ON DELETE CASCADE,
    content_type VARCHAR(20) NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    CONSTRAINT image_variants_size_check CHECK (width > 0 AND height > 0)
);

CREATE INDEX idx_image_variants_image ON image_variants (image_id);

-- A deleted image queues its original and each variant for the worker to delete from the store.
CREATE FUNCTION queue_image_object_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO file_deletions (object_key) VALUES (OLD.object_key) ON CONFLICT DO NOTHING;
    RETURN NULL;
END;
$$;

CREATE TRIGGER images_queue_deletion
    AFTER DELETE ON images
    FOR EACH ROW EXECUTE FUNCTION queue_image_object_deletion();

CREATE TRIGGER image_variants_queue_deletion
    AFTER DELETE ON image_variants
    FOR EACH ROW EXECUTE FUNCTION queue_image_object_deletion();

-- A replaced or removed picture takes its image row along, and so its variants.
CREATE OR REPLACE FUNCTION queue_user_picture_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.picture_id IS NOT NULL
        AND (TG_OP = 'DELETE' OR NEW.picture_id IS DISTINCT FROM OLD.picture_id) THEN
        INSERT INTO file_deletions (object_key) VALUES ('pictures/' || OLD.picture_id)
        ON CONFLICT DO NOTHING;
        DELETE FROM images WHERE id = OLD.picture_id;
    END IF;
    RETURN NULL;
END;
$$;

-- Where a person's picture stands (`PictureState` of @domain/identity): 1 while the worker prepares
-- it, 2 once it is shown, 3 when it was refused. A picture kept before this change is ready.
ALTER TABLE users ADD COLUMN picture_state SMALLINT;
UPDATE users SET picture_state = 2 WHERE picture_id IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_picture_state_check CHECK (
    (picture_id IS NULL) = (picture_state IS NULL) AND picture_state BETWEEN 1 AND 3
);
