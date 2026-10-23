-- #391: sign-in and sign-up by e-mail link. One row per link someone asked for. A job in
-- outbox_events carries no payload, so the job points at this row by id. The row holds the address
-- and the page to open after sign-in; the worker makes the link's secret and mails it in one step,
-- and only its hash is stored, in auth_challenges (libs/server/auth/sign-in-links.ts). The row
-- stays until a link to its address is used, and the nightly cleanup removes it a day on.
-- requested_by_user_id is the guest who asked, if any: only that guest's account is kept by the
-- link, so a guest who opens someone else's link never gets that address attached.
CREATE TABLE sign_in_link_requests (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    next TEXT,
    requested_by_user_id INT4 REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT sign_in_link_requests_email_check CHECK (length(email) BETWEEN 3 AND 254),
    CONSTRAINT sign_in_link_requests_next_check CHECK (length(next) BETWEEN 1 AND 2048)
);

CREATE INDEX idx_sign_in_link_requests_email ON sign_in_link_requests (email);
