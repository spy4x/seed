-- #701: a group has one time zone, so every member sees the same days and months, and a job that
-- runs for the group has a zone to run in. An IANA name such as `Europe/Berlin`, checked in the
-- domain (`parseGroupTimeZone`); a new group takes its creator's zone.
--
-- Every existing group gets its owner's zone: the one saved in their preferences, else the one
-- their first device reported, else `UTC`. Only a name Postgres knows is taken, since the overview
-- cuts days with `AT TIME ZONE`. The default keeps a row written without a zone valid.
--
-- Safe to run twice: the column is added only when missing, and only groups without a zone are
-- filled.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64);

UPDATE groups
SET time_zone = COALESCE(
    (
        SELECT zone.name
        FROM user_preferences
        CROSS JOIN LATERAL (
            VALUES (1, user_preferences.value ->> 'timeZone'), (2, user_preferences.first_time_zone)
        ) AS candidate (rank, name)
        INNER JOIN pg_timezone_names AS zone ON zone.name = candidate.name
        WHERE user_preferences.user_id = groups.owner_user_id
        ORDER BY candidate.rank
        LIMIT 1
    ),
    'UTC'
)
WHERE time_zone IS NULL;

ALTER TABLE groups ALTER COLUMN time_zone SET DEFAULT 'UTC';
ALTER TABLE groups ALTER COLUMN time_zone SET NOT NULL;
