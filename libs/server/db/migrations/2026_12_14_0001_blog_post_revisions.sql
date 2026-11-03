-- #418: a post's earlier versions. Every save of a post in the admin app (creating it, saving it,
-- and the save before a publish) keeps the fields as saved here, so an operator who saved over a
-- good paragraph, or whose colleague did, can bring the earlier text back into the editor.
--
-- - The admin's repository writes a row in the transaction of the save, with who saved it. Seed's
--   own posts from files write none: their history is the files'.
-- - Each post keeps its newest 50 rows; the same write deletes older ones.
-- - `saved_by_id` has no foreign key and `saved_by_name` copies the operator's name (or address),
--   so a row still names who saved it once the account is gone, and the public demo's nightly wipe,
--   which empties `users` with `TRUNCATE ... CASCADE`, keeps the rows (`KEPT_TABLES`, docs/demo.md).
-- - `translation_of` has no foreign key either: the post it named may be deleted later, and the
--   editor's save checks a restored link again.
-- - Deleting a post deletes its rows (`ON DELETE CASCADE`).
--
-- The table is new and empty, so creating it locks nothing a request waits for. `IF NOT EXISTS`
-- lets a second run pass.
CREATE TABLE IF NOT EXISTS blog_post_revisions (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    slug VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    seo_title VARCHAR(70),
    description VARCHAR(300) NOT NULL,
    tldr TEXT[] DEFAULT '{}' NOT NULL,
    topic VARCHAR(50),
    cover_url VARCHAR(2000),
    cover_alt VARCHAR(300),
    author_url VARCHAR(2000),
    body_md TEXT NOT NULL,
    language TEXT NOT NULL,
    translation_of UUID,
    saved_by_id INT4,
    saved_by_name VARCHAR(320),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- A post's rows, newest first: the History list, the trim to 50, and the delete with the post.
CREATE INDEX IF NOT EXISTS idx_blog_post_revisions_post
    ON blog_post_revisions (post_id, created_at DESC, id DESC);
