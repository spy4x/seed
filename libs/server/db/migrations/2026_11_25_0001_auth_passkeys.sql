-- #222: passkeys. A passkey is a sign-in method like the others: a row of `auth_keys` with
-- `method = 'passkey'` and the credential id (base64url) as `subject`, so the unique
-- `(method, subject)` refuses a credential registered twice and the sessions it starts end with
-- it. This table holds what only a passkey has: its public key (COSE, as the authenticator sent
-- it), the signature counter, how the browser reaches it, the name the person sees, and when it
-- was last used. Deleting the key deletes this row.
CREATE TABLE auth_passkeys (
    key_id INT4 PRIMARY KEY,
    user_id INT4 NOT NULL,
    public_key BYTEA NOT NULL,
    counter INT8 DEFAULT 0 NOT NULL,
    transports TEXT[] DEFAULT '{}' NOT NULL,
    backed_up BOOLEAN DEFAULT false NOT NULL,
    name TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    CONSTRAINT auth_passkeys_key_fkey FOREIGN KEY (key_id, user_id)
        REFERENCES auth_keys (id, user_id) ON DELETE CASCADE,
    CONSTRAINT auth_passkeys_public_key_check CHECK (octet_length(public_key) BETWEEN 1 AND 2048),
    CONSTRAINT auth_passkeys_counter_check CHECK (counter BETWEEN 0 AND 4294967295),
    CONSTRAINT auth_passkeys_name_check CHECK (length(name) BETWEEN 1 AND 64)
);

CREATE INDEX auth_passkeys_user_id_idx ON auth_passkeys (user_id);

-- 30 = the person renamed a passkey; `identifier` names the new and the old name.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
