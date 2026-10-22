-- #224: guest accounts. A guest is a person who tried the app with one click and has no sign-in
-- method yet. Their `auth_keys` row has `method = 'guest'` and a random subject that nobody signs
-- in with: it exists only because a session names a key. `guest_since` is when the guest account
-- was made; it goes back to NULL when the person keeps the account by adding a sign-in method.
ALTER TABLE users ADD COLUMN guest_since TIMESTAMPTZ;
-- Days on which the guest used the app, counted when the session is renewed (at most once a day),
-- for the reminder at the third one.
ALTER TABLE users ADD COLUMN guest_visit_days INT2 DEFAULT 0 NOT NULL;

-- The clean-up and the operator area's filter read guests only.
CREATE INDEX idx_users_guest_since ON users (guest_since) WHERE guest_since IS NOT NULL;

-- One row per guest account made (1), kept (2) or deleted by the clean-up (3). No user id: the
-- rows outlive the accounts, so the dashboard can count all three.
CREATE TABLE guest_events (
    id UUID PRIMARY KEY,
    kind INT2 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT guest_events_kind_check CHECK (kind BETWEEN 1 AND 3)
);

CREATE INDEX idx_guest_events_kind_created_at ON guest_events (kind, created_at);

-- A guest keeping the account with an address and a password waits for the address's code like a
-- sign-up; the right code adds the password to this guest instead of making a new account.
ALTER TABLE sign_up_requests
    ADD COLUMN guest_user_id INT4 REFERENCES users(id) ON DELETE CASCADE;

-- A guest whose new sign-in method already belongs to another account, until they choose what
-- happens (10 minutes). The other account's key is the one the switch signs in with; for an
-- address the person still owes that account's password.
CREATE TABLE guest_switches (
    guest_user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    target_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_key_id INT4 NOT NULL,
    method TEXT NOT NULL,
    needs_password BOOLEAN NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT guest_switches_key_fkey FOREIGN KEY (target_key_id, target_user_id)
        REFERENCES auth_keys (id, user_id) ON DELETE CASCADE,
    CONSTRAINT guest_switches_other_user_check CHECK (target_user_id <> guest_user_id)
);

-- Each reminder a guest gets in the inbox, once: 1 after the first note, 2 at the third day of
-- use, 3 when they tried to invite someone.
CREATE TABLE guest_reminders (
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind INT2 NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, kind),
    CONSTRAINT guest_reminders_kind_check CHECK (kind BETWEEN 1 AND 3)
);

-- 31 = a guest account was made, 32 = a guest kept the account (`identifier` names the method),
-- 33 = an operator deleted a guest account (on the operator's row, `identifier` = `user:<id>`).
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
