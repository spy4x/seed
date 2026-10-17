-- #462. Built CONCURRENTLY, so the table takes writes while it builds; Postgres cannot do that inside
-- a transaction, hence the `.no_transaction` ending and one statement per file. A build that fails
-- leaves an INVALID index behind and the next run stops at "already exists": drop that index by
-- hand and run the migrations again.
-- The audit log's operator filter finds the rows an operator wrote on people (`operator:<id>`,
-- alone or followed by a note). Only those rows are indexed: sign-ins and the rest of the trail are
-- most of the table.
CREATE INDEX CONCURRENTLY idx_auth_audits_operator ON auth_audits (identifier text_pattern_ops)
    WHERE identifier LIKE 'operator:%';
