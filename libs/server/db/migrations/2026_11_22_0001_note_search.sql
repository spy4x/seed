-- #299: search over notes. `search_vector` is the title and the body as words, the title weighted
-- above the body so a title match ranks first. It is generated, so every write keeps it current
-- and nothing in the application writes it. The `simple` configuration lowercases words and does
-- nothing else: no stemming and no stop words, because a product built on this template is not
-- English-only, and one language's stemming gives wrong matches in the others.
--
-- Adding a stored generated column rewrites the table once, under an exclusive lock: every read
-- and write of notes waits until it is done.
ALTER TABLE notes ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, title), 'A')
    || setweight(to_tsvector('simple'::regconfig, body), 'B')
) STORED;

-- The search reads live notes only, so deleted ones stay out of the index.
CREATE INDEX idx_notes_search_vector_active ON notes USING GIN (search_vector)
    WHERE deleted_at IS NULL;
