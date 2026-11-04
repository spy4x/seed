-- #733: what a post needs to be shared well.
--
-- - `intro`: two or three sentences that open the post's newsletter issue and its cross-post. The
--   post page never shows it. NULL: the issue opens with the description, as before.
-- - `related_feature`: the slug of the website's feature page the post is about
--   (`/features/<slug>`), linked under the byline. NULL: no link.
-- - `cover_file`: a cover kept as a file next to Seed's own posts
--   (`libs/server/blog/seed-posts/covers/<name>.webp`), which the website serves itself. Only the
--   post files set it; the admin app keeps `cover_url`. The name is a slug and `.webp`, so it can
--   never leave that folder, and it needs `cover_alt` as `cover_url` does.
-- - `crossposted_at` and `devto_url`: when the post's Dev.to cross-post was settled, once ever,
--   and the article's address when it was made. NULL `crossposted_at`: still to do once the post is
--   live. Every post published before this migration is settled now, so turning the cross-post on
--   never posts the whole archive at once.
-- - `blog_post_revisions` keeps `intro` and `related_feature` too, so an earlier version brings
--   them back with the rest of the post's fields.
--
-- Nullable columns with no default change no row; the one UPDATE touches only published posts, a
-- few hundred small rows at most, and a second run of it changes nothing it has not changed.
ALTER TABLE blog_posts
    ADD COLUMN IF NOT EXISTS intro VARCHAR(600),
    ADD COLUMN IF NOT EXISTS related_feature VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cover_file VARCHAR(120),
    ADD COLUMN IF NOT EXISTS crossposted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS devto_url VARCHAR(2000);

ALTER TABLE blog_posts
    DROP CONSTRAINT IF EXISTS blog_posts_related_feature_check,
    ADD CONSTRAINT blog_posts_related_feature_check
        CHECK (related_feature IS NULL OR related_feature ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    DROP CONSTRAINT IF EXISTS blog_posts_cover_file_check,
    ADD CONSTRAINT blog_posts_cover_file_check
        CHECK (cover_file IS NULL OR
            (cover_file ~ '^[a-z0-9]+(-[a-z0-9]+)*\.webp$' AND cover_alt IS NOT NULL)),
    DROP CONSTRAINT IF EXISTS blog_posts_devto_url_check,
    ADD CONSTRAINT blog_posts_devto_url_check
        CHECK (devto_url IS NULL OR (devto_url LIKE 'https://%' AND crossposted_at IS NOT NULL));

UPDATE blog_posts SET crossposted_at = now()
WHERE status = 'published' AND crossposted_at IS NULL;

ALTER TABLE blog_post_revisions
    ADD COLUMN IF NOT EXISTS intro VARCHAR(600),
    ADD COLUMN IF NOT EXISTS related_feature VARCHAR(100);
