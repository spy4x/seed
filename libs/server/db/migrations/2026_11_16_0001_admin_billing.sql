-- #196: the operator area's billing actions. Each leaves an audit row on the operator's own trail;
-- `identifier` names the group, the provider's object and the operator's note.
-- 25 = a supervisor refunded a group's last payment in full.
-- 26 = an operator gave a group time at no charge (a new trial end).
-- 27 = an operator set a group's subscription to end at the end of its period.
-- 28 = a supervisor ended a group's subscription at once.
-- 29 = an operator took back a cancellation that waited for the period's end.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;

-- One row per billing action an operator asked for, by the idempotency key the page made when the
-- dialog opened. The key is claimed before the provider is called, so the same key sent for another
-- group, action or operator is refused instead of acting; a retry of the same request calls the
-- provider again with the same key (the provider acts once) and writes the audit row only if no
-- earlier try did (`audited_at`). No foreign key: the row outlives a deleted group or operator.
CREATE TABLE admin_billing_actions (
    idempotency_key UUID PRIMARY KEY,
    action VARCHAR(32) NOT NULL,
    group_id UUID NOT NULL,
    operator_id INT4 NOT NULL,
    -- The new trial end the first try computed for time at no charge, so a retry sends the provider
    -- the same request; `NULL` for the other actions.
    until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    audited_at TIMESTAMPTZ
);
