-- #277: e-mails in the recipient's language. A sign-up code and a sign-in link go out before the
-- worker knows whose account, if any, the address belongs to, so each request keeps the language
-- of the page that asked for it. The API stores only a language the apps offer, else NULL, and the
-- worker checks it again before use. Existing rows keep NULL: their mail is in English, as before.
ALTER TABLE sign_up_requests
    ADD COLUMN language TEXT,
    ADD CONSTRAINT sign_up_requests_language_check CHECK (length(language) BETWEEN 2 AND 35);

ALTER TABLE sign_in_link_requests
    ADD COLUMN language TEXT,
    ADD CONSTRAINT sign_in_link_requests_language_check CHECK (length(language) BETWEEN 2 AND 35);
