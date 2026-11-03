-- #416: a post's reading minutes, kept on the row, so the public blog's index and feed list posts
-- without reading every body.
--
-- Postgres computes the column from `body_md` on every write, so the admin's writes, Seed's own
-- posts (`seed-posts/`) and any later writer get it with no code of their own, and adding it fills
-- every existing post: the backfill is the column's own expression. It is the count of the
-- renderer's `readingMinutes` (`@spy4x/platform/universal/text`): words are runs of what JavaScript's
-- `\S` matches, at 230 a minute, rounded, at least one. The bracket lists JavaScript's `\s`, so the
-- count does not hang on the database's locale.
--
-- Adding a stored generated column rewrites the table under a lock. The blog holds a few hundred
-- small rows, so that takes well under a second, and a deploy runs migrations while the API is
-- stopped (docs/handoff.md). `IF NOT EXISTS` lets a second run pass.
ALTER TABLE blog_posts
    ADD COLUMN IF NOT EXISTS reading_minutes INT4 GENERATED ALWAYS AS (
        GREATEST(1, round(regexp_count(
            body_md, '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
        ) / 230.0))::int4
    ) STORED;
