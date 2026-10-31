-- #439: a device asks for the changes of a group after the sequence it holds, instead of reading
-- the whole group again (`GET /api/groups/:groupId/changes`, docs/offline.md).
--
-- A changed row carries its own `change_sequence`, but a row that is gone leaves nothing to read:
-- a deleted note, a note moved to another group, a deleted tag. Each of those writes one tombstone
-- here, in its own transaction, stamped with the group's change sequence of that write. A row that
-- leaves again replaces its tombstone. Only the kind and the id are kept, never the content.
--
-- `changes_oldest_sequence` is the lowest cursor above 0 the server can still answer: the nightly
-- cleanup forgets tombstones older than the retention window and raises it, and "move all data"
-- raises it to its own sequence instead of writing one tombstone per row. A device behind it reads
-- the group in full. 0 while nothing was ever forgotten, which is every group today: no row was
-- deleted before this table existed that a device with a cursor could still hold, because no
-- device has a cursor yet.
ALTER TABLE groups
    ADD COLUMN changes_oldest_sequence BIGINT DEFAULT 0 NOT NULL,
    ADD CONSTRAINT groups_changes_oldest_sequence_check CHECK (changes_oldest_sequence >= 0);

CREATE TABLE group_change_tombstones (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    entity_id UUID NOT NULL,
    change_sequence BIGINT NOT NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (group_id, kind, entity_id),
    CONSTRAINT group_change_tombstones_kind_check CHECK (length(kind) BETWEEN 1 AND 40),
    CONSTRAINT group_change_tombstones_change_sequence_check CHECK (change_sequence >= 1)
);

CREATE INDEX idx_group_change_tombstones_group_sequence
    ON group_change_tombstones (group_id, change_sequence);
CREATE INDEX idx_group_change_tombstones_created_at ON group_change_tombstones (created_at);
