-- The places posts are shared in: a subreddit, a Telegram channel, a newsletter. Every live post
-- in one of `languages` that went live on or after `starts_at` (any, when NULL) lists the channel
-- on its sharing checklist, until the channel is archived. `utm_source` tags the links to the post.
CREATE TABLE IF NOT EXISTS blog_channels (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    address VARCHAR(2000) NOT NULL,
    utm_source VARCHAR(60) NOT NULL,
    add_utm BOOLEAN DEFAULT true NOT NULL,
    languages TEXT[] NOT NULL,
    starts_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    CONSTRAINT blog_channels_utm_source_unique UNIQUE (utm_source),
    CONSTRAINT blog_channels_kind_check CHECK (kind IN (
        'devto', 'telegram', 'mastodon', 'bluesky', 'hashnode', 'linkedin', 'x', 'reddit',
        'hackernews', 'newsletter', 'other'
    )),
    CONSTRAINT blog_channels_name_check CHECK (length(btrim(name)) >= 1),
    CONSTRAINT blog_channels_address_check CHECK (length(btrim(address)) >= 1),
    CONSTRAINT blog_channels_utm_source_check CHECK (utm_source ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT blog_channels_languages_check CHECK (cardinality(languages) BETWEEN 1 AND 20),
    CONSTRAINT blog_channels_version_check CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS blog_channels_name_unique ON blog_channels (lower(name));

-- What happened to one post on one channel. No row means "to do", the same as a `todo` row.
CREATE TABLE IF NOT EXISTS blog_post_shares (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES blog_channels(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL,
    url VARCHAR(2000),
    shared_at TIMESTAMPTZ,
    skip_reason VARCHAR(200),
    automatic BOOLEAN DEFAULT false NOT NULL,
    error VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT blog_post_shares_post_channel_unique UNIQUE (post_id, channel_id),
    CONSTRAINT blog_post_shares_status_check
        CHECK (status IN ('todo', 'suggested', 'posted', 'skipped')),
    CONSTRAINT blog_post_shares_url_check CHECK (url IS NULL OR url LIKE 'https://%'),
    CONSTRAINT blog_post_shares_skip_reason_check CHECK (skip_reason IS NULL OR status = 'skipped')
);

CREATE INDEX IF NOT EXISTS idx_blog_post_shares_channel ON blog_post_shares (channel_id);

-- The numbers one shared copy got, as read at `read_at`: by the results job or typed by hand.
-- Counts only; NULL is a number the channel does not show.
CREATE TABLE IF NOT EXISTS blog_share_results (
    id UUID PRIMARY KEY,
    share_id UUID NOT NULL REFERENCES blog_post_shares(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source VARCHAR(8) NOT NULL,
    views INT4,
    reactions INT4,
    comments INT4,
    score INT4,
    CONSTRAINT blog_share_results_source_check CHECK (source IN ('job', 'hand')),
    CONSTRAINT blog_share_results_counts_check CHECK (
        (views IS NULL OR views >= 0) AND (reactions IS NULL OR reactions >= 0) AND
        (comments IS NULL OR comments >= 0) AND (score IS NULL OR score >= 0)
    ),
    CONSTRAINT blog_share_results_any_check CHECK (num_nonnulls(views, reactions, comments, score) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_blog_share_results_share
    ON blog_share_results (share_id, read_at DESC);

-- Posts already cross-posted to Dev.to: one Dev.to channel, starting with the first of them, and a
-- posted share per post. `devto_url` stays on the post. Running this twice adds nothing.
INSERT INTO blog_channels (id, name, kind, address, utm_source, add_utm, languages, starts_at)
SELECT uuidv7(), 'Dev.to', 'devto', 'https://dev.to', 'devto', true,
    ARRAY(SELECT DISTINCT language FROM blog_posts WHERE devto_url IS NOT NULL ORDER BY 1),
    (SELECT min(published_at) FROM blog_posts WHERE devto_url IS NOT NULL)
WHERE EXISTS (SELECT 1 FROM blog_posts WHERE devto_url IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM blog_channels WHERE kind = 'devto')
ON CONFLICT DO NOTHING;

INSERT INTO blog_post_shares (id, post_id, channel_id, status, url, shared_at, automatic)
SELECT uuidv7(), post.id, channel.id, 'posted', post.devto_url, post.crossposted_at, true
FROM blog_posts post
CROSS JOIN LATERAL (
    SELECT id FROM blog_channels WHERE kind = 'devto' ORDER BY created_at, id LIMIT 1
) channel
WHERE post.devto_url IS NOT NULL
ON CONFLICT (post_id, channel_id) DO NOTHING;
