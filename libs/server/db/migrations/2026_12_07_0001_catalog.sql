-- #466: the catalog. Operators keep categories and items with colours, sizes and photos in the
-- admin app; the public website shows the published items (docs/catalog.md).
--
-- - Every text a visitor reads is a JSONB object of one text per language tag
--   (`{"vi": "...", "en": "..."}`); the languages are the product's setting (`CATALOG_LANGUAGES`).
-- - `price` is a whole number of the smallest unit of the catalog's one currency
--   (`CATALOG_CURRENCY`): cents, or dong.
-- - `published_at` is when the item first went live; it never moves. A hidden item keeps it.
-- - `position` orders categories, colours, sizes and photos, 0 first; the constraints are checked
--   at commit, since a reorder moves every position in one statement.
-- - A sold-out row is one colour and size of an item; `NULL` stands for a side the item does not
--   have (an item with no colours has rows with no colour).
-- - A photo's id is its `images` row's (#464): the worker makes its widths, and deleting the photo
--   deletes the image, which queues every object for deletion.
-- - The public demo's nightly wipe empties these tables and its seed writes sample items
--   (docs/demo.md).
CREATE TABLE catalog_categories (
    id UUID PRIMARY KEY,
    slug VARCHAR(100) NOT NULL,
    name JSONB NOT NULL,
    position INT4 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    CONSTRAINT catalog_categories_slug_unique UNIQUE (slug),
    CONSTRAINT catalog_categories_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT catalog_categories_name_check CHECK (jsonb_typeof(name) = 'object'),
    CONSTRAINT catalog_categories_position_check CHECK (position >= 0),
    CONSTRAINT catalog_categories_position_unique UNIQUE (position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT catalog_categories_version_check CHECK (version >= 1)
);

CREATE TABLE catalog_items (
    id UUID PRIMARY KEY,
    slug VARCHAR(100) NOT NULL,
    category_id UUID REFERENCES catalog_categories (id),
    name JSONB NOT NULL,
    description JSONB DEFAULT '{}' NOT NULL,
    material JSONB DEFAULT '{}' NOT NULL,
    fit JSONB DEFAULT '{}' NOT NULL,
    care JSONB DEFAULT '{}' NOT NULL,
    price INT8 NOT NULL,
    status VARCHAR(16) DEFAULT 'draft' NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    CONSTRAINT catalog_items_slug_unique UNIQUE (slug),
    CONSTRAINT catalog_items_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT catalog_items_texts_check CHECK (
        jsonb_typeof(name) = 'object' AND jsonb_typeof(description) = 'object'
        AND jsonb_typeof(material) = 'object' AND jsonb_typeof(fit) = 'object'
        AND jsonb_typeof(care) = 'object'
    ),
    CONSTRAINT catalog_items_price_check CHECK (price BETWEEN 0 AND 1000000000000),
    CONSTRAINT catalog_items_status_check CHECK (status IN ('draft', 'published', 'hidden')),
    CONSTRAINT catalog_items_published_check
        CHECK (status = 'draft' OR published_at IS NOT NULL),
    CONSTRAINT catalog_items_category_check
        CHECK (status <> 'published' OR category_id IS NOT NULL),
    CONSTRAINT catalog_items_version_check CHECK (version >= 1)
);

CREATE INDEX idx_catalog_items_category ON catalog_items (category_id);

CREATE TABLE catalog_item_colours (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
    name JSONB NOT NULL,
    swatch VARCHAR(7) NOT NULL,
    position INT4 NOT NULL,
    CONSTRAINT catalog_item_colours_name_check CHECK (jsonb_typeof(name) = 'object'),
    CONSTRAINT catalog_item_colours_swatch_check CHECK (swatch ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT catalog_item_colours_position_unique
        UNIQUE (item_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE catalog_item_sizes (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
    label VARCHAR(40) NOT NULL,
    position INT4 NOT NULL,
    -- The size chart (docs/catalog.md): the heights and weights the size fits, both ends kept.
    height_min_cm INT2,
    height_max_cm INT2,
    weight_min_kg INT2,
    weight_max_kg INT2,
    CONSTRAINT catalog_item_sizes_height_check CHECK (
        (height_min_cm IS NULL) = (height_max_cm IS NULL) AND height_min_cm <= height_max_cm
    ),
    CONSTRAINT catalog_item_sizes_weight_check CHECK (
        (weight_min_kg IS NULL) = (weight_max_kg IS NULL) AND weight_min_kg <= weight_max_kg
    ),
    CONSTRAINT catalog_item_sizes_position_unique
        UNIQUE (item_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE catalog_sold_out (
    item_id UUID NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
    colour_id UUID REFERENCES catalog_item_colours (id) ON DELETE CASCADE,
    size_id UUID REFERENCES catalog_item_sizes (id) ON DELETE CASCADE,
    CONSTRAINT catalog_sold_out_unique UNIQUE NULLS NOT DISTINCT (item_id, colour_id, size_id)
);

CREATE TABLE catalog_photos (
    id UUID PRIMARY KEY REFERENCES images (id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
    colour_id UUID REFERENCES catalog_item_colours (id) ON DELETE SET NULL,
    alt JSONB DEFAULT '{}' NOT NULL,
    position INT4 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT catalog_photos_alt_check CHECK (jsonb_typeof(alt) = 'object'),
    CONSTRAINT catalog_photos_position_unique
        UNIQUE (item_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_catalog_photos_colour ON catalog_photos (colour_id);

-- A removed photo, and every photo of a deleted item, takes its image along: the image's trigger
-- queues its original and its widths for the worker to delete from the store.
CREATE FUNCTION delete_catalog_photo_image() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM images WHERE id = OLD.id;
    RETURN NULL;
END;
$$;

CREATE TRIGGER catalog_photos_delete_image
    AFTER DELETE ON catalog_photos
    FOR EACH ROW EXECUTE FUNCTION delete_catalog_photo_image();
