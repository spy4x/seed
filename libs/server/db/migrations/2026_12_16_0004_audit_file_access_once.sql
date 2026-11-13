-- One Download in the admin app wrote two `operator.file_downloaded` rows: Chromium fetched the
-- address a second time. The admin app names each file read with a request id in the address,
-- and this index lets an operator's read of one file under one id write one row. Older rows have
-- no request id and are left out, so duplicates among them cannot stop the index being built.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_file_access_once
    ON audit_events (event_kind, actor_user_id, group_id, entity_id, (details->>'name'), request_id)
    WHERE event_kind IN ('operator.file_opened', 'operator.file_downloaded')
        AND request_id IS NOT NULL;
