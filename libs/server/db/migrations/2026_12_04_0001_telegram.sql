-- #269: Telegram. A linked Telegram account is a row of `auth_keys` with `method = 'telegram'` and
-- the Telegram user id as `subject`, so the unique `(method, subject)` keeps one Telegram account
-- on one account here. It is no sign-in method: nobody signs in with it. An account links one
-- Telegram account at most: the link replaces the one before under a lock on the person's row
-- (`telegramLinks().link`), because `auth_keys` is the auth package's table and takes no index of
-- ours.

-- A notification on its way to the person's Telegram chat. The worker's job names this row (a job
-- names a UUID, a notification has a number), reads the notification and the link when it runs,
-- and deletes the row once the message is sent: unlinked by then, nothing is sent. The row goes
-- with its notification and with its person.
CREATE TABLE telegram_messages (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_telegram_messages_user_id ON telegram_messages (user_id);
CREATE INDEX idx_telegram_messages_notification_id ON telegram_messages (notification_id);

-- 34 = the person linked a Telegram account, 35 = it was unlinked.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
