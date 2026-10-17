-- #163: a person's display preferences (theme, region format, time zone, clock), one row per
-- person, so every device shows the same. The value is checked by the API against the schema in
-- `libs/domain/identity/preferences.ts` and capped there at 512 bytes; the column is the stored
-- copy. `version` is `0` until the first save and grows by one with each one: a save names the
-- version it was based on, and an older one is refused, so two devices never overwrite each other
-- silently.
--
-- `first_time_zone` and `first_locale` are what the first device the person used reported. They
-- are not preferences: they are the zone and format the person signed up with, which operators
-- see on the person's account. The row goes with the account.
CREATE TABLE user_preferences (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    value JSONB DEFAULT '{}'::jsonb NOT NULL,
    version INT4 DEFAULT 0 NOT NULL,
    first_time_zone VARCHAR(64),
    first_locale VARCHAR(64),
    updated_at TIMESTAMPTZ(3),
    CONSTRAINT user_preferences_version_check CHECK (version >= 0)
);
