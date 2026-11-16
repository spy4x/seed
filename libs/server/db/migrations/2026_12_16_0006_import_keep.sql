-- `keep`: the row numbers the person saves despite a skip the kind's review marks overridable
-- (docs/imports.md), as a JSON array, read by the commit job. Null when the save named none.
ALTER TABLE imports ADD COLUMN keep JSONB;
