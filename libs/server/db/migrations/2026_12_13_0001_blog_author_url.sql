-- #730: a link to a page about a post's author, which the post's byline and its structured data
-- (`BlogPosting.author.url`) point at, so readers, search engines and AI assistants can tell who
-- wrote it. NULL for no link: the post shows the plain name, as every post did until now.
--
-- The API stores only an `https:` address with a host (`isHttpsUrl` in `@domain/blog`), written as
-- the URL parser writes it, so it starts with `https://` in lower case; the column checks the start,
-- as `cover_url` does. Adding a nullable column with no default changes no row.
ALTER TABLE blog_posts
    ADD COLUMN author_url VARCHAR(2000),
    ADD CONSTRAINT blog_posts_author_url_check
        CHECK (author_url IS NULL OR author_url LIKE 'https://%');
