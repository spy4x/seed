-- #394: when an operator cancelled a job in the admin panel's Jobs module. A cancel also sets
-- processed_at, so the worker never claims the row and the nightly cleanup removes it a week later
-- with the other processed rows; this column tells a cancelled row from one that ran. `NULL` for
-- every row nobody cancelled.
ALTER TABLE outbox_events ADD COLUMN cancelled_at TIMESTAMPTZ;
