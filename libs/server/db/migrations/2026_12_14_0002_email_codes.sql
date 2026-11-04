-- #752: sign-in and password reset by an e-mailed code instead of a link.
--
-- A sign-in request now waits for its code in the browser that asked, which a signed cookie names,
-- for as long as expires_at says; asking again for a new code moves it on. Requests and challenges
-- of links are of no use any more, so they go.
DELETE FROM auth_challenges WHERE purpose = 'app.sign-in-link';
DELETE FROM sign_in_link_requests;
ALTER TABLE sign_in_link_requests RENAME TO sign_in_code_requests;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_pkey TO sign_in_code_requests_pkey;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_email_check TO sign_in_code_requests_email_check;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_next_check TO sign_in_code_requests_next_check;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_language_check TO sign_in_code_requests_language_check;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_requested_by_user_id_fkey
    TO sign_in_code_requests_requested_by_user_id_fkey;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_id_not_null TO sign_in_code_requests_id_not_null;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_email_not_null TO sign_in_code_requests_email_not_null;
ALTER TABLE sign_in_code_requests
    RENAME CONSTRAINT sign_in_link_requests_created_at_not_null
    TO sign_in_code_requests_created_at_not_null;
ALTER INDEX idx_sign_in_link_requests_email RENAME TO idx_sign_in_code_requests_email;
ALTER TABLE sign_in_code_requests ADD COLUMN expires_at TIMESTAMPTZ NOT NULL;

-- A reset request waits for its code the same way. by_operator marks one an operator asked for in
-- the admin panel: its mail carries no code, since no browser waits for it, and tells the person
-- to ask for one. Old reset links no longer open anything, so their requests and challenges go.
DELETE FROM auth_challenges WHERE purpose = 'app.password-reset';
DELETE FROM password_reset_requests;
ALTER TABLE password_reset_requests
    ADD COLUMN expires_at TIMESTAMPTZ NOT NULL,
    ADD COLUMN by_operator BOOLEAN DEFAULT false NOT NULL;

-- A link mail still queued has no handler in the worker that ships with this migration, which would
-- fail it twenty times and log every failure. Its request is gone above, so the job goes too. A
-- queued reset mail keeps its kind: its request is gone, so its handler finds nothing and ends.
DELETE FROM outbox_events WHERE aggregate_type = 'job' AND event_kind = 'auth.sign-in-link-mail';
