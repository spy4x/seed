-- #418: a post's old addresses. When "Change URL" moves a post that has been live, its old slug is
-- kept here, so `/blog/<old>` and `/<language>/blog/<old>` answer 301 to the post's current address
-- and links already shared, indexed or mailed keep working.
--
-- - A row names the post, never a slug, so a chain of changes (a → b → c) sends `a` straight to the
--   post's current slug, and no chain can loop.
-- - Only an address the public saw is kept: the post had gone live once (`published_at` is set). A
--   draft's or a scheduled post's slug changes freely and leaves nothing.
-- - A slug a post takes is the post's, so its row is deleted in the same write: a new post that
--   takes an old address owns it, and a post moved back to an old slug has no row pointing at
--   itself. The old row never comes back, also when the new post is later taken down.
-- - Deleting a post deletes its rows (`ON DELETE CASCADE`). The public website follows a row only
--   to a live post, so an unpublished one answers 404 at its old addresses as at its own.
--
-- The triggers write the rows, so every writer of `blog_posts` (the admin, Seed's own post files,
-- any later one) keeps them in the transaction of its own write. Slugs are unique across languages,
-- so the old slug alone names the address in every language. The table is new and empty, and the
-- triggers take a short lock on `blog_posts`, which holds a few hundred rows. `IF NOT EXISTS` and
-- `OR REPLACE` let a second run pass.
CREATE TABLE IF NOT EXISTS blog_slug_redirects (
    slug VARCHAR(100) PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- A post's rows, deleted with it.
CREATE INDEX IF NOT EXISTS idx_blog_slug_redirects_post ON blog_slug_redirects (post_id);

CREATE OR REPLACE FUNCTION keep_blog_slug_redirect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM blog_slug_redirects WHERE slug = NEW.slug;
    IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
        INSERT INTO blog_slug_redirects (slug, post_id) VALUES (OLD.slug, NEW.id)
        ON CONFLICT (slug) DO UPDATE SET post_id = EXCLUDED.post_id, created_at = now();
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER blog_posts_slug_insert
    AFTER INSERT ON blog_posts
    FOR EACH ROW EXECUTE FUNCTION keep_blog_slug_redirect();

CREATE OR REPLACE TRIGGER blog_posts_slug_update
    AFTER UPDATE OF slug ON blog_posts
    FOR EACH ROW WHEN (OLD.slug IS DISTINCT FROM NEW.slug)
    EXECUTE FUNCTION keep_blog_slug_redirect();
