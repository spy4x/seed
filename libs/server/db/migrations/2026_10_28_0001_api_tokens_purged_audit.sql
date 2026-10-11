-- #293: the worker deletes a personal API token 30 days after it expired and writes an
-- `auth_audits` row for its owner.
-- 11 = the worker deleted expired tokens of this person; `identifier` is their count, a colon and
-- their ids.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])) NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
