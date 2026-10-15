-- #390: the worker's nightly cleanup also deletes unread notifications a year after they were
-- created. This index lets it find them across every user without reading the whole table.
CREATE INDEX idx_notifications_unread_created_at ON notifications (created_at) WHERE read_at IS NULL;
