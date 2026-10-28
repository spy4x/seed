-- #465: the website's contact links, which an operator edits in the admin app. The website's
-- footer and its Organization structured data read them. `value` is stored normalised and checked
-- by `contactValueProblem` (@spy4x/platform/universal/contact); `kind` names its channel.
--
-- - `position` orders the links, 0 first. Every write locks the table, so two operators adding or
--   reordering at once are served one after the other; the constraint is checked at commit, since
--   a reorder moves every position in one statement.
-- - The public demo's nightly wipe keeps this table (`KEPT_TABLES`, docs/demo.md): the links are
--   the website's own, not demo data.
CREATE TABLE contact_links (
    id UUID PRIMARY KEY,
    kind VARCHAR(16) NOT NULL,
    value VARCHAR(2000) NOT NULL,
    label VARCHAR(60),
    position INT4 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    CONSTRAINT contact_links_kind_check CHECK (
        kind IN ('telegram', 'zalo', 'whatsapp', 'instagram', 'facebook', 'phone', 'email', 'url')
    ),
    CONSTRAINT contact_links_position_check CHECK (position >= 0),
    CONSTRAINT contact_links_position_unique UNIQUE (position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT contact_links_version_check CHECK (version >= 1)
);
