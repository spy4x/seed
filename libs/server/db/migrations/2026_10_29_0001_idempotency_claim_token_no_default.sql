-- The claim token's default made a version 4 UUID in SQL (migration 2026_10_03_0001). It served
-- only an API older than the one that added the column, whose INSERT did not name it. The store of
-- spy4x/ts-libs has named the column and passed its own token in every INSERT since 1.63.0, and
-- from 1.64.1 that token is a version 7 UUID, so the default is never used and can go. The column
-- stays `uuid`, and the order of this migration and the API restart does not matter (docs/ids.md).
ALTER TABLE idempotency_keys ALTER COLUMN claim_token DROP DEFAULT;
