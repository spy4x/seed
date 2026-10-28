-- #527: a blog post and a newsletter subscriber each have a language, so a product that speaks two
-- languages lists each post on its own language's index and mails each subscriber in theirs.
--
-- A post's `language` is one the apps ship; the API checks it, the column only its length. Existing
-- posts were written in English, the language every post had until now. The default only fills
-- them: every write names the language. `translation_of` points at the post this one translates,
-- which is a post of its own (the API checks that), and a post has at most one translation per
-- language. Deleting the original keeps its translations as posts of their own.
ALTER TABLE blog_posts
    ADD COLUMN language TEXT DEFAULT 'en' NOT NULL,
    ADD COLUMN translation_of UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
    ADD CONSTRAINT blog_posts_language_check CHECK (length(language) BETWEEN 2 AND 35),
    ADD CONSTRAINT blog_posts_translation_check CHECK (translation_of <> id);

ALTER TABLE blog_posts ALTER COLUMN language DROP DEFAULT;

CREATE UNIQUE INDEX blog_posts_translation_language_unique
    ON blog_posts (translation_of, language) WHERE translation_of IS NOT NULL;

-- The public index of one language, newest first.
CREATE INDEX idx_blog_posts_language_published
    ON blog_posts (language, published_at DESC) WHERE status = 'published';

-- The language of the page a subscribe request came from, which the confirm and welcome mails are
-- written in, and, once the address confirmed, the subscriber's. NULL for rows from before, and
-- for a request that named none: their mail is in the product's main language.
ALTER TABLE subscription_requests
    ADD COLUMN language TEXT,
    ADD CONSTRAINT subscription_requests_language_check CHECK (length(language) BETWEEN 2 AND 35);

ALTER TABLE subscribers
    ADD COLUMN language TEXT,
    ADD CONSTRAINT subscribers_language_check CHECK (length(language) BETWEEN 2 AND 35);

-- The language an issue is written in: it goes only to the subscribers of that language (a
-- subscriber with none counts as the main language's). NULL for an issue to the whole list, such as
-- one `deno task subscribers:send` queues.
ALTER TABLE subscriber_issue_content
    ADD COLUMN language TEXT,
    ADD CONSTRAINT subscriber_issue_content_language_check CHECK (length(language) BETWEEN 2 AND 35);
