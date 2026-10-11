-- #293: a personal API token that ends keeps its row for a while. `revoked_at` is set when the owner
-- revokes it, changes or resets the password, leaves or is removed from the group, or the group is
-- deleted; a revoked token never works again and is not listed or counted. The row, and with it the
-- hash, stays so that a later request with the token can be tied to its owner and audited; the
-- worker deletes it 30 days after `revoked_at`.
ALTER TABLE api_tokens ADD COLUMN revoked_at TIMESTAMPTZ;

-- 12 = a request with a token was refused: the token was revoked or expired, or it may not do what
-- was asked. Every token row's `identifier` now names the token: its id, group, access and name.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;

-- Tokens the old code left asleep: before this migration a token outlived its owner's membership
-- and its group's move to the trash, and worked again once the person was added back or the group
-- was restored. They end here, each with its `API_TOKEN_REVOKED` row (10) in the format above, so
-- none of them wakes up. A group in the trash is named first: its members are still its members.
WITH revoked AS (
    UPDATE api_tokens
    SET revoked_at = now()
    FROM groups
    WHERE groups.id = api_tokens.group_id
        AND api_tokens.revoked_at IS NULL
        AND (
            groups.deleted_at IS NOT NULL
            OR NOT EXISTS (
                SELECT 1 FROM group_members
                WHERE group_members.group_id = api_tokens.group_id
                    AND group_members.user_id = api_tokens.user_id
            )
        )
    RETURNING api_tokens.id, api_tokens.user_id, api_tokens.group_id, api_tokens.access,
        api_tokens.name, groups.deleted_at IS NOT NULL AS group_deleted
)
INSERT INTO auth_audits (user_id, event_type, identifier)
SELECT user_id, 10,
    id::text || ' group=' || group_id::text
        || ' access=' || CASE access WHEN 2 THEN 'write' ELSE 'read' END
        || ' reason=' || CASE WHEN group_deleted THEN 'group-deleted' ELSE 'membership-ended' END
        || ' name=' || name
FROM revoked;
