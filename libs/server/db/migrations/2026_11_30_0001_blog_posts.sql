-- #395: the blog. Operators write posts in the admin app; the public website reads the published
-- ones. A post is a draft, scheduled (a `blog.publish` job waits for `publish_at`) or published.
--
-- - `published_at` is when the post first went live; it never moves, so unpublishing and
--   publishing again keeps the date readers saw. Once it is set the slug is locked: only the
--   admin's "Change URL" changes it, and old links then stop working (no redirects).
-- - `content_updated_at` moves only when the operator ticks "Significant update" while saving a
--   published post.
-- - `author_id` has no foreign key on purpose: the public demo's nightly wipe empties `users`
--   with `TRUNCATE ... CASCADE`, which would empty this table too, and the blog must survive it
--   (`KEPT_TABLES`, docs/demo.md). `author_name` keeps the name shown on the post.
-- - `newsletter_sent_at` is set once, in the transaction that queues the post's newsletter issue,
--   so a post is mailed once ever, also after unpublishing and publishing again.
CREATE TABLE blog_posts (
    id UUID PRIMARY KEY,
    slug VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    seo_title VARCHAR(70),
    description VARCHAR(300) NOT NULL,
    tldr TEXT[] DEFAULT '{}' NOT NULL,
    topic VARCHAR(50),
    cover_url VARCHAR(2000),
    cover_alt VARCHAR(300),
    body_md TEXT DEFAULT '' NOT NULL,
    status VARCHAR(16) DEFAULT 'draft' NOT NULL,
    publish_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    content_updated_at TIMESTAMPTZ,
    author_id INT4,
    author_name VARCHAR(101),
    newsletter_list VARCHAR(64),
    newsletter_sent_at TIMESTAMPTZ,
    newsletter_recipients INT4,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    CONSTRAINT blog_posts_slug_unique UNIQUE (slug),
    CONSTRAINT blog_posts_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'scheduled', 'published')),
    CONSTRAINT blog_posts_tldr_check CHECK (cardinality(tldr) <= 5),
    CONSTRAINT blog_posts_body_check CHECK (length(body_md) <= 200000),
    CONSTRAINT blog_posts_cover_check
        CHECK (cover_url IS NULL OR (cover_url LIKE 'https://%' AND cover_alt IS NOT NULL)),
    CONSTRAINT blog_posts_scheduled_check CHECK (status <> 'scheduled' OR publish_at IS NOT NULL),
    CONSTRAINT blog_posts_published_check
        CHECK (status <> 'published' OR (publish_at IS NOT NULL AND published_at IS NOT NULL)),
    CONSTRAINT blog_posts_version_check CHECK (version >= 1)
);

-- The public website's reads: newest published first, and the same per topic.
CREATE INDEX idx_blog_posts_published ON blog_posts (published_at DESC) WHERE status = 'published';
CREATE INDEX idx_blog_posts_topic_published
    ON blog_posts (topic, published_at DESC) WHERE status = 'published';
-- The admin list, most recently changed first.
CREATE INDEX idx_blog_posts_updated ON blog_posts (updated_at DESC, id DESC);
