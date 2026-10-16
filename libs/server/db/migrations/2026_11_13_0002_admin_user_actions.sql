-- #425: three more operator actions leave an audit row. 19 to 21 are the newsletter's (#428).
-- 22 = the person's role changed; `identifier` names who changed it and both roles
--      (`operator:<id> from viewer to operator`, or `cli:user-role from ...` from the role script).
-- 23 = an operator sent the person a password-reset link; `identifier` names the operator.
-- 24 = an operator exported the user list as CSV, on the operator's own trail; `identifier` names
--      the operator and the filter.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
