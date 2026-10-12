-- #355: a browser's push address can be longer than 256 characters (the push service chooses it,
-- not the person), and the request check accepts up to 2048. The column held 256, so a longer
-- address passed the check and failed the insert with a server error. The column now holds what
-- the check accepts: `PUSH_TOKEN_LIMITS.endpoint` in libs/domain/identity.
--
-- Safe on a table with rows: VARCHAR to TEXT keeps every value and rewrites nothing, and every
-- existing address is 256 characters or fewer, so the new CHECK holds. One statement, so the table
-- is locked once (ACCESS EXCLUSIVE) for a change of the catalogue and one read of the table to
-- validate the CHECK. `endpoint` is in no index, so none is rebuilt.
ALTER TABLE user_push_tokens
  ALTER COLUMN endpoint TYPE TEXT,
  ADD CONSTRAINT user_push_tokens_endpoint_check CHECK (length(endpoint) <= 2048);
