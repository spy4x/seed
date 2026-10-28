-- #483: tracking links. An operator keeps the places they share catalog items in (a Facebook
-- group, a Zalo group, Instagram, friends) as sources; an item's admin page makes one short link
-- per source the first time "Copy link" is pressed. `/s/<code>` on the website sends the visitor
-- through Umami, which counts the click, to the item's page tagged with the source
-- (docs/catalog.md).
--
-- - A source's `slug` is the `utm_source` of its links. `position` orders the sources, 0 first;
--   the constraint is checked at commit, since a reorder moves every position in one statement.
-- - A link is unique per item and source, so a second press, or two at once, finds the first.
--   `code` is the short address part, random and public. `umami_link_id` is set once Umami holds
--   the link; until then the link sends visitors straight to the item.
-- - Deleting an item or a source deletes its links: their addresses then answer 404.
-- - The public demo's nightly wipe empties these tables and its seed writes sample sources
--   (docs/demo.md).
CREATE TABLE catalog_link_sources (
    id UUID PRIMARY KEY,
    slug VARCHAR(100) NOT NULL,
    name VARCHAR(60) NOT NULL,
    position INT4 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    CONSTRAINT catalog_link_sources_slug_unique UNIQUE (slug),
    CONSTRAINT catalog_link_sources_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT catalog_link_sources_position_check CHECK (position >= 0),
    CONSTRAINT catalog_link_sources_position_unique UNIQUE (position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT catalog_link_sources_version_check CHECK (version >= 1)
);

CREATE TABLE catalog_tracking_links (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES catalog_link_sources (id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL,
    umami_link_id UUID,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT catalog_tracking_links_item_source_unique UNIQUE (item_id, source_id),
    CONSTRAINT catalog_tracking_links_code_unique UNIQUE (code),
    CONSTRAINT catalog_tracking_links_code_check CHECK (code ~ '^[A-Za-z0-9_-]{8,32}$')
);

CREATE INDEX idx_catalog_tracking_links_source ON catalog_tracking_links (source_id);
