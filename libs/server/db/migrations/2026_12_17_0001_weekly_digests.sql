-- #210: the opt-in weekly digest e-mail (docs/weekly-digest.md). One row per person who turned it
-- on; no row is off, the default. `weekday` (ISO, Monday = 1) and `hour` are wall-clock times in
-- `time_zone`. `next_at` is the next send, which the scheduler job advances by a week as it queues
-- the mail, so a second run in the same hour finds nothing due. `window_from` is where the next
-- digest's window starts: the end of the last one, sent or empty. `id` is new each time the digest
-- is turned on: the mail jobs are about it, so a job queued before the person turned it off sends
-- nothing. The row goes with the account.
CREATE TABLE weekly_digests (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    id UUID NOT NULL UNIQUE,
    weekday INT2 NOT NULL,
    hour INT2 NOT NULL,
    time_zone VARCHAR(64) NOT NULL,
    next_at TIMESTAMPTZ(3) NOT NULL,
    window_from TIMESTAMPTZ(3) NOT NULL,
    last_sent_at TIMESTAMPTZ(3),
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT weekly_digests_weekday_check CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT weekly_digests_hour_check CHECK (hour BETWEEN 0 AND 23)
);

-- The scheduler's scan for due digests.
CREATE INDEX idx_weekly_digests_next_at ON weekly_digests (next_at);

-- The first instant strictly after `after` whose wall clock in `zone` is ISO weekday `weekday` at
-- `hour`:00. A local hour that a change to summer time skips is read as the hour before the
-- change, so it still names one instant that week; an hour that a change back repeats names one of
-- its two instants. Either way a week has exactly one.
CREATE FUNCTION weekly_digest_next_at(after TIMESTAMPTZ, weekday INT2, hour INT2, zone TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN slot AT TIME ZONE zone > after THEN slot AT TIME ZONE zone
        ELSE (slot + INTERVAL '7 days') AT TIME ZONE zone END
    FROM (
        SELECT date_trunc('day', after AT TIME ZONE zone) + make_interval(
            days => (weekday - extract(isodow FROM after AT TIME ZONE zone)::int + 7) % 7,
            hours => hour
        ) AS slot
    ) AS local
$$;
