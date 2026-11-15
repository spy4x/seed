-- Three optional parts of an import kind (docs/imports.md). `options`: what the kind's
-- `readOptions` made of the upload's options, such as the account a statement belongs to.
-- `choices`: the person's per-row choices at the save, row number to field values, read by the
-- commit job. `skipped_count`: valid rows the kind's review left out at the save, such as rows
-- saved before. Each is null for a kind without that part.
ALTER TABLE imports
    ADD COLUMN options JSONB,
    ADD COLUMN choices JSONB,
    ADD COLUMN skipped_count INT4;
