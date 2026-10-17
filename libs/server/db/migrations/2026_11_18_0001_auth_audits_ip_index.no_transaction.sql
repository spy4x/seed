-- #462. Built CONCURRENTLY, so the table takes writes while it builds; Postgres cannot do that inside
-- a transaction, hence the `.no_transaction` ending and one statement per file. A build that fails
-- leaves an INVALID index behind and the next run stops at "already exists": drop that index by
-- hand and run the migrations again.
-- The audit log's IP filter matches the start of an address (`ip LIKE '192.0.2.%'`); the pattern
-- operator class lets that prefix read the index whatever the database's collation.
CREATE INDEX CONCURRENTLY idx_auth_audits_ip ON auth_audits (ip text_pattern_ops);
