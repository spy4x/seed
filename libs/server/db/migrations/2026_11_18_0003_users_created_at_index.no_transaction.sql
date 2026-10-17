-- #462. Built CONCURRENTLY, so the table takes writes while it builds; Postgres cannot do that inside
-- a transaction, hence the `.no_transaction` ending and one statement per file. A build that fails
-- leaves an INVALID index behind and the next run stops at "already exists": drop that index by
-- hand and run the migrations again.
-- The dashboard counts sign-ups of the last 30 days and of the last two weeks.
CREATE INDEX CONCURRENTLY idx_users_created_at ON users (created_at);
