-- #385: linking or unlinking a sign-in method mails the account's proven address, naming the
-- provider and the time. The row is written in the transaction of the change, beside its audit
-- row, and the mail job reads it, sends the mail and removes it. `event_type` is the audit row's:
-- 13 linked, 14 unlinked. `method` is the key's method, such as `oauth:google`.
CREATE TABLE sign_in_method_changes (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    event_type INT2 NOT NULL CHECK (event_type IN (13, 14)),
    method VARCHAR(64) NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_sign_in_method_changes_user_id ON sign_in_method_changes (user_id);
