-- #462. Built CONCURRENTLY, so the table takes writes while it builds; Postgres cannot do that inside
-- a transaction, hence the `.no_transaction` ending and one statement per file. A build that fails
-- leaves an INVALID index behind and the next run stops at "already exists": drop that index by
-- hand and run the migrations again.
-- The dashboard counts blocked people; only they are indexed, and they are few.
CREATE INDEX CONCURRENTLY idx_users_blocked_at ON users (blocked_at) WHERE blocked_at IS NOT NULL;
