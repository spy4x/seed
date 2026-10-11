-- Tags: the second offline-writable aggregate and the parent of notes (docs/aggregates.md,
-- "Relations between aggregates"). A tag belongs to one group and has a name and a colour. Every
-- member reads a group's tags and an editor or above writes them; the handlers check that.
--
-- `version` and `change_sequence` work as on notes. A tag is deleted for good, so there is no
-- `deleted_at`: the delete still records one change on the group, which announces it.
--
-- Names are unique in a group without regard to case, so "Work" and "work" cannot both exist.
CREATE TABLE tags (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name VARCHAR(40) NOT NULL,
    color VARCHAR(10) DEFAULT 'gray' NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    change_sequence BIGINT NOT NULL,
    created_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT tags_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    CONSTRAINT tags_color_check CHECK (color IN ('gray', 'red', 'orange', 'green', 'blue', 'purple')),
    CONSTRAINT tags_version_check CHECK (version >= 1),
    CONSTRAINT tags_change_sequence_check CHECK (change_sequence >= 1)
);

CREATE UNIQUE INDEX idx_tags_group_name ON tags (group_id, lower(name));
CREATE INDEX idx_tags_group_change_sequence ON tags (group_id, change_sequence);
CREATE INDEX idx_tags_created_by ON tags (created_by_user_id);
CREATE INDEX idx_tags_updated_by ON tags (updated_by_user_id);

-- The link between a note and a tag. Deleting a tag removes its links and never touches the notes
-- (ADR 003, section 5, rule 3), so a tag's delete does not change any note's version. The tag
-- being in the note's group is kept by the repository, not by the database.
CREATE TABLE note_tags (
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX idx_note_tags_tag ON note_tags (tag_id);
