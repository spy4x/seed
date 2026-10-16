-- Sign-up proves the address before anything is created (#142).
--
-- Existing data is not touched. A sign-up with an address and a password waits here until the
-- code mailed to that address is entered; only then is the account created, or, when an account
-- already uses the address, nothing is. The same row is written for every address, so the answer
-- to a sign-up never tells whether an account uses it.

-- One sign-up that waits for its code. `secret` is the password hash, made before the row is
-- written, so the raw password is never stored. The row goes when the code is entered, when the
-- person starts again with another address, or, once `expires_at` has passed, at the nightly
-- cleanup. The code itself lives in auth_challenges, which stores only its hash.
CREATE TABLE sign_up_requests (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    secret TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT sign_up_requests_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

CREATE INDEX sign_up_requests_expires_at_idx ON sign_up_requests (expires_at);

-- One row per code mail of a waiting sign-up the worker has not sent yet. A job in outbox_events
-- carries no payload, so the job points at this row by id. The worker makes the code and mails it
-- in one step, so the raw code is never stored, and deletes the row once it has handled it.
CREATE TABLE sign_up_code_requests (
    id UUID PRIMARY KEY,
    sign_up_id UUID NOT NULL REFERENCES sign_up_requests (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX sign_up_code_requests_sign_up_id_idx ON sign_up_code_requests (sign_up_id);
