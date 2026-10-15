-- #146: an operator can block a person. A blocked person cannot sign in, by password, by a
-- provider or with an API token, and every request of a session they still hold is refused.
-- `NULL` while the person is not blocked.
ALTER TABLE users ADD COLUMN blocked_at TIMESTAMPTZ;

-- 16 = an operator blocked the person; `identifier` names the operator (`operator:<id>`).
-- 17 = an operator unblocked the person; `identifier` as for 16.
-- An operator ending all of a person's sessions writes 7 (sessions ended) with the same identifier.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
