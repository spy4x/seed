-- =============================================================================
-- Template Database Schema
-- =============================================================================
-- The whole schema as the migrations build it; tests/integration/schema-snapshot.integration.test.ts
-- compares the two. Enums start at 1
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS plpgsql;

-- In a migrated database the runner of @spy4x/server/db creates its own history table, with
-- checksums; the snapshot test leaves this table out of the comparison.
CREATE TABLE migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Sign-in tables: AUTH_POSTGRES_SCHEMA of @spy4x/server 1.0.0 (auth/postgres).
CREATE TABLE auth_users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- One row per proven address: the user who owns it. The primary key is the one-owner rule.
CREATE TABLE auth_email_owners (
  email text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  CONSTRAINT auth_email_owners_email_user_key UNIQUE (email, user_id)
);

CREATE INDEX auth_email_owners_user_id_idx ON auth_email_owners (user_id);

CREATE TABLE auth_keys (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  method text NOT NULL,
  subject text NOT NULL,
  email text,
  secret text,
  proven_at timestamptz,
  -- The address, only while the key is proven. Referenced below, so a proven key's address is
  -- always owned by the key's own user.
  proven_email text GENERATED ALWAYS AS (CASE WHEN proven_at IS NULL THEN NULL ELSE email END) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_keys_method_subject_key UNIQUE (method, subject),
  CONSTRAINT auth_keys_id_user_key UNIQUE (id, user_id),
  CONSTRAINT auth_keys_proven_email_owner_fkey FOREIGN KEY (proven_email, user_id)
    REFERENCES auth_email_owners (email, user_id),
  CONSTRAINT auth_keys_method_check CHECK (length(method) BETWEEN 1 AND 64),
  CONSTRAINT auth_keys_subject_check CHECK (length(subject) BETWEEN 1 AND 255),
  CONSTRAINT auth_keys_email_check CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  CONSTRAINT auth_keys_secret_check CHECK (length(secret) BETWEEN 1 AND 1024),
  CONSTRAINT auth_keys_proven_email_check CHECK (proven_at IS NULL OR email IS NOT NULL)
);

CREATE INDEX auth_keys_user_id_idx ON auth_keys (user_id);
CREATE INDEX auth_keys_email_idx ON auth_keys (email) WHERE email IS NOT NULL;

-- #222: what only a passkey key has. See migration 2026_11_25_0001_auth_passkeys.sql.
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

-- Status: 1 = active, 2 = expired, 3 = signed out. Second factor: 1 = not required, 2 = pending,
-- 3 = completed. The values of SessionStatus and SecondFactorStatus in @spy4x/server/sign-in.
CREATE TABLE auth_sessions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  key_id integer NOT NULL,
  token_hash text NOT NULL,
  status smallint NOT NULL,
  second_factor smallint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- #151: "Firefox on Linux", the address with its last part hidden, the last time it was used.
  device_name text NOT NULL DEFAULT '',
  ip_hint text,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_device_name_check CHECK (length(device_name) <= 100),
  CONSTRAINT auth_sessions_ip_hint_check CHECK (length(ip_hint) <= 45),
  CONSTRAINT auth_sessions_key_fkey FOREIGN KEY (key_id, user_id)
    REFERENCES auth_keys (id, user_id) ON DELETE CASCADE,
  CONSTRAINT auth_sessions_status_check CHECK (status IN (1, 2, 3)),
  CONSTRAINT auth_sessions_second_factor_check CHECK (second_factor IN (1, 2, 3))
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_key_id_idx ON auth_sessions (key_id);
CREATE INDEX auth_sessions_active_expires_at_idx ON auth_sessions (expires_at) WHERE status = 1;

-- Guess-counted challenges. Expired rows are harmless and may be deleted at any time:
-- DELETE FROM auth_challenges WHERE expires_at <= now()
CREATE TABLE auth_challenges (
  purpose text NOT NULL,
  subject text NOT NULL,
  secret_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (purpose, subject),
  CONSTRAINT auth_challenges_purpose_check CHECK (length(purpose) BETWEEN 1 AND 64),
  CONSTRAINT auth_challenges_subject_check CHECK (length(subject) BETWEEN 1 AND 255),
  CONSTRAINT auth_challenges_secret_hash_check CHECK (length(secret_hash) BETWEEN 1 AND 1024),
  CONSTRAINT auth_challenges_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX auth_challenges_expires_at_idx ON auth_challenges (expires_at);

CREATE TABLE users (
    id INT4 PRIMARY KEY,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    role INT2 DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_login_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    mfa INT2 DEFAULT 1 NOT NULL,
    -- #152: last signed-in activity, written at most every five minutes.
    last_seen_at TIMESTAMPTZ,
    -- #298: when the person closed the first-steps checklist, and when they finished or skipped
    -- the tour. `NULL` while each is still shown.
    onboarding_dismissed_at TIMESTAMPTZ,
    onboarding_tour_seen_at TIMESTAMPTZ,
    -- #146: when an operator blocked the person. `NULL` while they are not blocked.
    blocked_at TIMESTAMPTZ,
    -- #205: the group the person's one billing trial went to, and when. `NULL` while unused.
    trial_group_id UUID,
    trial_used_at TIMESTAMPTZ,
    -- #224: when the guest account was made; NULL for an account with a sign-in method, and again
    -- once a guest keeps the account. `guest_visit_days` counts the days the guest used the app.
    guest_since TIMESTAMPTZ,
    guest_visit_days INT2 DEFAULT 0 NOT NULL,
    -- #228: the person's profile picture, kept in the file store as `pictures/<picture_id>`.
    -- `NULL` while they have none. `picture_type` is the type the store confirmed.
    picture_id UUID,
    picture_type VARCHAR(20),
    CONSTRAINT users_role_check CHECK (role >= 1 AND role <= 4),
    CONSTRAINT users_mfa_check CHECK (mfa = ANY (ARRAY[1, 2, 3])),
    CONSTRAINT users_id_auth_users_fkey FOREIGN KEY (id) REFERENCES auth_users (id)
        ON DELETE CASCADE,
    CONSTRAINT users_picture_id_unique UNIQUE (picture_id),
    CONSTRAINT users_picture_check CHECK ((picture_id IS NULL) = (picture_type IS NULL))
);

COMMENT ON COLUMN users.role IS '1=viewer, 2=operator, 3=supervisor, 4=administrator';
COMMENT ON COLUMN users.mfa IS '1=not_configured, 2=confuration_not_finished, 3=configured';
-- #462: the dashboard's counts of sign-ups, active people and blocked people.
CREATE INDEX idx_users_created_at ON users (created_at);
CREATE INDEX idx_users_last_seen_at ON users (last_seen_at);
CREATE INDEX idx_users_blocked_at ON users (blocked_at) WHERE blocked_at IS NOT NULL;
CREATE INDEX idx_users_guest_since ON users (guest_since) WHERE guest_since IS NOT NULL;

CREATE TABLE groups (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    owner_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    authorization_revision BIGINT DEFAULT 1 NOT NULL,
    next_change_sequence BIGINT DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ,
    description VARCHAR(2000) DEFAULT '' NOT NULL,
    color VARCHAR(16),
    emoji VARCHAR(32),
    imported_at TIMESTAMPTZ,
    CONSTRAINT groups_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT groups_description_check CHECK (char_length(description) <= 500),
    CONSTRAINT groups_color_check CHECK (color ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT groups_authorization_revision_check CHECK (authorization_revision >= 1),
    CONSTRAINT groups_next_change_sequence_check CHECK (next_change_sequence >= 1)
);

CREATE INDEX idx_groups_updated_id_active
    ON groups (updated_at DESC, id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_groups_deleted_at ON groups (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_groups_created_by ON groups (created_by_user_id);

CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INT2 NOT NULL,
    added_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role_check CHECK (role BETWEEN 1 AND 4)
);

COMMENT ON COLUMN group_members.role IS '1=viewer, 2=editor, 3=admin, 4=owner';

CREATE INDEX idx_group_members_user_group_role
    ON group_members (user_id, group_id) INCLUDE (role);
CREATE INDEX idx_group_members_group_role ON group_members (group_id, role);
CREATE INDEX idx_group_members_added_by ON group_members (added_by_user_id);
CREATE UNIQUE INDEX group_members_one_owner_key ON group_members (group_id) WHERE role = 4;

CREATE TABLE user_totp (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    confirmed_at TIMESTAMPTZ,
    last_accepted_step INT4,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    failed_attempts INT4 DEFAULT 0 NOT NULL,
    locked_until TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    CONSTRAINT user_totp_secret_check CHECK (length(secret) BETWEEN 1 AND 256),
    CONSTRAINT user_totp_last_accepted_step_check CHECK (last_accepted_step >= 0),
    CONSTRAINT user_totp_failed_attempts_check CHECK (failed_attempts >= 0)
);

CREATE TABLE user_push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT4 REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(256) NOT NULL,
    endpoint TEXT NOT NULL,
    auth VARCHAR(256) NOT NULL,
    p256dh VARCHAR(256) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ,
    -- The limits of `PUSH_SUBSCRIPTION_LIMITS` (`@spy4x/platform/model`). `endpoint` has no index,
    -- and must never get a btree one: 2048 characters can be 8192 bytes, past what an index row
    -- holds.
    CONSTRAINT user_push_tokens_endpoint_check CHECK (length(endpoint) <= 2048)
);

CREATE INDEX idx_user_push_tokens_by_deleted_at ON user_push_tokens (deleted_at);
CREATE INDEX idx_user_push_tokens_by_user_id_deleted_at ON user_push_tokens (user_id, deleted_at);
CREATE INDEX idx_user_push_tokens_by_device_user ON user_push_tokens (device_id, user_id);
CREATE UNIQUE INDEX idx_user_push_tokens_live_by_user_device
    ON user_push_tokens (user_id, device_id)
    WHERE deleted_at IS NULL;

CREATE TABLE audit_events (
    id BIGSERIAL PRIMARY KEY,
    event_kind VARCHAR(64) NOT NULL,
    actor_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    request_id VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    target_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    entity_type VARCHAR(32),
    entity_id UUID,
    details JSONB DEFAULT '{}' NOT NULL,
    CONSTRAINT audit_events_kind_check CHECK (length(btrim(event_kind)) BETWEEN 1 AND 64)
);

-- Deliberately not unique: an audit log must be able to record the same kind of
-- event for a group more than once.
CREATE INDEX idx_audit_events_group_kind_created
    ON audit_events (group_id, event_kind, created_at DESC);
CREATE INDEX idx_audit_events_actor_created
    ON audit_events (actor_user_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_events_group_id_desc ON audit_events (group_id, id DESC);
CREATE INDEX idx_audit_events_created ON audit_events (created_at);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    event_kind VARCHAR(64) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    actor_user_id INT4 REFERENCES users(id) ON DELETE RESTRICT,
    attempt_count INT4 DEFAULT 0 NOT NULL,
    available_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    claimed_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    last_error_code VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cancelled_at TIMESTAMPTZ,
    CONSTRAINT outbox_events_kind_check CHECK (length(btrim(event_kind)) BETWEEN 1 AND 64),
    CONSTRAINT outbox_events_aggregate_type_check CHECK (
        length(btrim(aggregate_type)) BETWEEN 1 AND 64
    ),
    CONSTRAINT outbox_events_aggregate_version_check CHECK (aggregate_version >= 1),
    CONSTRAINT outbox_events_attempt_count_check CHECK (attempt_count >= 0),
    CONSTRAINT outbox_events_group_actor_check CHECK ((group_id IS NULL) = (actor_user_id IS NULL))
);

CREATE UNIQUE INDEX idx_outbox_events_aggregate_version_kind
    ON outbox_events (aggregate_type, aggregate_id, aggregate_version, event_kind);
CREATE INDEX idx_outbox_events_available
    ON outbox_events (available_at, created_at)
    WHERE processed_at IS NULL;
CREATE INDEX idx_outbox_events_actor_user_id ON outbox_events (actor_user_id);

-- One row per command a client sent with an idempotency key (ADR 002, "Idempotency"). A retry
-- with the same key returns `result` instead of running the command again.
--
-- `status` is 1 while the first run is in flight and 2 once its result is stored. `updated_at`
-- is when the row was claimed or finished; a claim that stays at 1 past its lease belongs to a
-- run that died, and the next retry takes it over under a new `claim_token`; `complete` and
-- `release` change only the row whose token they hold. The store makes the token, a version 7
-- UUID; the column has no default. Rows older than seven days are removed by the worker's sweep
-- and are ignored by readers before that.
--
-- The key is scoped to the user, so one user cannot replay or block another user's key.
-- `request_hash` fingerprints the command's input: the same key with different input is refused
-- instead of answered with the first command's result.
CREATE TABLE idempotency_keys (
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(128) NOT NULL,
    command_name VARCHAR(100) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status INT2 NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    claim_token UUID NOT NULL,
    PRIMARY KEY (user_id, key),
    CONSTRAINT idempotency_keys_key_check CHECK (length(key) BETWEEN 1 AND 128),
    CONSTRAINT idempotency_keys_status_check CHECK (status = ANY (ARRAY[1, 2])),
    CONSTRAINT idempotency_keys_done_has_result_check CHECK (status = 1 OR result IS NOT NULL)
);

COMMENT ON COLUMN idempotency_keys.status IS '1=started, 2=done';

CREATE INDEX idx_idempotency_keys_created ON idempotency_keys (created_at);

-- Notes: the reference aggregate (docs/aggregates.md). See migration 2026_10_02_0001_notes.sql.
CREATE TABLE notes (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    body TEXT DEFAULT '' NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    change_sequence BIGINT NOT NULL,
    created_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ(3),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, title), 'A')
        || setweight(to_tsvector('simple'::regconfig, body), 'B')
    ) STORED,
    CONSTRAINT notes_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT notes_body_check CHECK (length(body) <= 10000),
    CONSTRAINT notes_version_check CHECK (version >= 1),
    CONSTRAINT notes_change_sequence_check CHECK (change_sequence >= 1)
);

-- The list: a group's live notes, newest first, paged by (updated_at, id).
CREATE INDEX idx_notes_group_updated_id_active
    ON notes (group_id, updated_at DESC, id)
    WHERE deleted_at IS NULL;
-- The "Show deleted" list and the nightly purge. See migration 2026_10_23_0001.
CREATE INDEX idx_notes_group_updated_id_deleted
    ON notes (group_id, updated_at DESC, id)
    WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_notes_deleted_at ON notes (deleted_at) WHERE deleted_at IS NOT NULL;
-- Search over live notes (#299). See migration 2026_11_22_0001.
CREATE INDEX idx_notes_search_vector_active ON notes USING GIN (search_vector)
    WHERE deleted_at IS NULL;

-- A future pull by cursor: a group's notes changed after a sequence, deleted ones included.
CREATE INDEX idx_notes_group_change_sequence ON notes (group_id, change_sequence);
CREATE INDEX idx_notes_created_by ON notes (created_by_user_id);
CREATE INDEX idx_notes_updated_by ON notes (updated_by_user_id);

-- Per-user settings. See migration 2026_10_05_0001_user_settings.sql.
-- `version` grows by one with every change of the selection. It is not the sequence of a hint: the
-- selection's hint is sent by `GroupSelectedEvent`, from the handler.
CREATE TABLE user_settings (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    selected_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    version INT4 DEFAULT 1 NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_settings_version_check CHECK (version >= 1)
);

CREATE INDEX idx_user_settings_selected_group
    ON user_settings (selected_group_id)
    WHERE selected_group_id IS NOT NULL;

-- Password reset by e-mail. See migration 2026_10_06_0001_password_reset.sql.
CREATE TABLE password_reset_requests (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT password_reset_requests_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

-- Development only: the worker copies every mail here with ENV=dev, for the e2e specs.
CREATE TABLE dev_mail (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    text_body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX dev_mail_to_address_idx ON dev_mail (to_address, id);

-- A new address waiting for its code; the old one stays until it is proven (#140).
CREATE TABLE email_changes (
    user_id INT4 PRIMARY KEY REFERENCES auth_users (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT email_changes_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

-- Code mails the worker has not sent yet; the code itself is made at send time.
CREATE TABLE email_code_requests (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT email_code_requests_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

CREATE INDEX email_code_requests_user_id_idx ON email_code_requests (user_id);

-- Wrong e-mail codes per user, with a lock that grows per failure.
CREATE TABLE email_code_failures (
    user_id INT4 PRIMARY KEY REFERENCES auth_users (id) ON DELETE CASCADE,
    failed_attempts INT4 DEFAULT 0 NOT NULL,
    locked_until TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    CONSTRAINT email_code_failures_failed_attempts_check CHECK (failed_attempts >= 0)
);

-- Wrong passwords per sign-in name (the SHA-256 of what was typed), with a short lock (#387).
CREATE TABLE password_failures (
    subject CHAR(64) PRIMARY KEY,
    failed_attempts INT4 DEFAULT 0 NOT NULL,
    locked_until TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    CONSTRAINT password_failures_failed_attempts_check CHECK (failed_attempts >= 0)
);

-- Wrong passwords a signed-in account types at the steps that ask for it again (#406).
CREATE TABLE password_check_failures (
    user_id INT4 PRIMARY KEY REFERENCES auth_users (id) ON DELETE CASCADE,
    failed_attempts INT4 DEFAULT 0 NOT NULL,
    locked_until TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    CONSTRAINT password_check_failures_failed_attempts_check CHECK (failed_attempts >= 0)
);

-- One subscription per group, paid through a provider (#202). See the migration for the why.
CREATE TABLE billing_customers (
    group_id UUID PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
    provider_customer_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX idx_billing_customers_provider_customer_id
    ON billing_customers (provider_customer_id);

-- Customers handed over by a transfer of ownership (#250), for good. See the migration for the why.
CREATE TABLE billing_handed_over_customers (
    provider_customer_id VARCHAR(255) PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    -- The owner who paid with this customer; `NULL` once their account is deleted.
    previous_owner_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    handed_over_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- A group's subscription as the newest applied event left it. `provider_event_at` and
-- `provider_event_rank` (1 created, 2 updated, 3 canceled) order the events: one that sorts before
-- them is older and changes nothing, so a late delivery never rolls the plan back.
CREATE TABLE subscriptions (
    group_id UUID PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
    provider_subscription_id VARCHAR(255) NOT NULL,
    plan_id VARCHAR(64),
    status INT2 NOT NULL,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE NOT NULL,
    provider_event_at TIMESTAMPTZ NOT NULL,
    provider_event_rank INT2 NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- When the provider first reported it past due (#204): the grace period counts from here. A
    -- later past-due event keeps it; any other status clears it.
    past_due_since TIMESTAMPTZ,
    -- When the trial ends (#204), as the provider last reported it; `NULL` without a trial.
    trial_end TIMESTAMPTZ,
    -- The seats the provider last reported the subscription bills (#205). A per-member plan bills
    -- one per member; the worker changes the subscription when the member count differs.
    quantity INTEGER,
    -- Whether this subscription was ever active, so it has paid at least once (#247). Only then
    -- does a failed payment get the grace period; a trial whose first charge fails gets none.
    ever_active BOOLEAN DEFAULT FALSE NOT NULL,
    -- The customer this subscription bills (#250), so a handed-over customer's subscription is
    -- known by its own customer and not by the group's current one.
    provider_customer_id VARCHAR(255),
    CONSTRAINT subscriptions_status_check CHECK (status BETWEEN 1 AND 6),
    CONSTRAINT subscriptions_provider_event_rank_check CHECK (provider_event_rank BETWEEN 1 AND 3),
    CONSTRAINT subscriptions_past_due_since_check
        CHECK ((status = 3) = (past_due_since IS NOT NULL))
);

COMMENT ON COLUMN subscriptions.status IS
    '1=trialing, 2=active, 3=past_due, 4=canceled, 5=incomplete, 6=paused';

CREATE INDEX idx_subscriptions_provider_subscription_id
    ON subscriptions (provider_subscription_id);

-- Every webhook event already handled, by the provider's event id. It is written in the transaction
-- that applies the event, so a second delivery finds it and changes nothing.
CREATE TABLE billing_events (
    id VARCHAR(255) PRIMARY KEY,
    event_type INT2 NOT NULL,
    received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT billing_events_event_type_check CHECK (event_type BETWEEN 1 AND 5)
);

-- Invitations to a group (#131). See the migration for the why.
CREATE TABLE group_invitations (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL,
    role INT2 NOT NULL,
    email TEXT,
    max_uses INT4 DEFAULT 1 NOT NULL,
    uses INT4 DEFAULT 0 NOT NULL,
    created_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT group_invitations_role_check CHECK (role BETWEEN 1 AND 3),
    CONSTRAINT group_invitations_max_uses_check CHECK (max_uses BETWEEN 1 AND 100),
    CONSTRAINT group_invitations_uses_check CHECK (uses BETWEEN 0 AND max_uses),
    CONSTRAINT group_invitations_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT group_invitations_email_check
        CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254)
);

COMMENT ON COLUMN group_invitations.role IS '1=viewer, 2=editor, 3=admin';

-- A link finds its invitation by the token's hash.
CREATE UNIQUE INDEX idx_group_invitations_token_hash ON group_invitations (token_hash);
-- The group's Invitations section, newest first.
CREATE INDEX idx_group_invitations_group_created ON group_invitations (group_id, created_at DESC);
-- The invitations a person sees for the addresses they proved.
CREATE INDEX idx_group_invitations_email ON group_invitations (email) WHERE email IS NOT NULL;
-- Whether a person ever made an invitation (the first-steps checklist), and the cascade when a
-- user is deleted.
CREATE INDEX idx_group_invitations_created_by ON group_invitations (created_by_user_id);

-- Who accepted each invitation. A person accepts one invitation once: a member removed from the
-- group cannot come back through the team link they joined with.
CREATE TABLE group_invitation_acceptances (
    invitation_id UUID NOT NULL REFERENCES group_invitations(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (invitation_id, user_id)
);

-- Mail subscriptions for visitors. See migration 2026_10_17_0001_subscribers.sql.
CREATE TABLE subscribers (
  list_id text NOT NULL,
  email text NOT NULL,
  key text NOT NULL,
  subscribed_at timestamptz NOT NULL,
  PRIMARY KEY (list_id, email),
  CONSTRAINT subscribers_list_key_unique UNIQUE (list_id, key)
);

CREATE INDEX idx_subscribers_list_subscribed ON subscribers (list_id, subscribed_at);

CREATE TABLE subscriber_unsubscribes (
  list_id text NOT NULL,
  mark text NOT NULL,
  unsubscribed_at timestamptz NOT NULL,
  PRIMARY KEY (list_id, mark)
);

CREATE INDEX idx_subscriber_unsubscribes_at ON subscriber_unsubscribes (list_id, unsubscribed_at);

CREATE TABLE subscriber_sends (
  list_id text NOT NULL,
  issue text NOT NULL,
  subject text NOT NULL,
  started_at timestamptz NOT NULL,
  audience text[],
  recipients text[],
  sent integer,
  failed integer,
  completed_at timestamptz,
  PRIMARY KEY (list_id, issue)
);

-- One row per mail the worker has not sent yet: a confirm link after POST /api/subscribers, or a
-- welcome mail after a confirm. A job in outbox_events carries no payload, so the job points at
-- this row by id. The API writes the row and the job the same way for a known and a new address,
-- and only the worker signs a token. The worker deletes the row once it has handled it; the nightly
-- cleanup removes rows it never reached.
CREATE TABLE subscription_requests (
  id UUID PRIMARY KEY,
  list_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT subscription_requests_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

CREATE INDEX idx_subscription_requests_created ON subscription_requests (created_at);

-- The rendered issue `deno task subscribers:send` stores for the send-issue job, which points at it
-- by id. `html` and `text` hold the unsubscribe placeholder that sendIssue fills per recipient.
-- Kept after the send, so a rerun of the same issue mails only the addresses the first run missed.
CREATE TABLE subscriber_issue_content (
  id UUID PRIMARY KEY,
  list_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT subscriber_issue_content_list_issue_unique UNIQUE (list_id, issue_id)
);

-- A person's request to delete their account (#144). See migration 2026_10_20_0001.
CREATE TABLE account_deletions (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    delete_after TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_account_deletions_delete_after ON account_deletions (delete_after);

-- A restore whose mail is not sent yet (#144). See migration 2026_10_20_0001.
CREATE TABLE account_restorations (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    restored_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_account_restorations_user_id ON account_restorations (user_id);

-- A sign-in method linked or unlinked whose mail is not sent yet (#385). See migration
-- 2026_11_07_0001.
CREATE TABLE sign_in_method_changes (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    event_type INT2 NOT NULL CHECK (event_type IN (13, 14)),
    method VARCHAR(64) NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_sign_in_method_changes_user_id ON sign_in_method_changes (user_id);

-- #147: the in-app inbox. One row is one thing the app tells a person: an invitation, a role
-- change, a removal, a group handed to them. The row is written in the transaction of the change it
-- tells about, so it exists exactly when the change does. `payload` holds the few facts the
-- sentence needs, never a note body or an address. `link` is the in-app page the notification is
-- about. A row of a deleted account goes with the account; a read row is deleted by the worker's
-- nightly cleanup 90 days after `read_at`.
CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(64) NOT NULL,
    payload JSONB DEFAULT '{}' NOT NULL,
    link TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT notifications_kind_check CHECK (length(btrim(kind)) BETWEEN 1 AND 64),
    CONSTRAINT notifications_link_check CHECK (
        length(link) BETWEEN 1 AND 500
        AND link LIKE '/%'
        AND link NOT LIKE '//%'
        AND position('\' IN link) = 0
        AND link !~ '[[:space:][:cntrl:]]'
    )
);

-- A person's inbox: their notifications, newest first, paged by id.
CREATE INDEX idx_notifications_user_id_desc ON notifications (user_id, id DESC);
-- The bell's number: only unread rows, so it stays cheap in a long inbox.
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
-- The retention job: read rows past their 90 days, across every user.
CREATE INDEX idx_notifications_read_at ON notifications (read_at) WHERE read_at IS NOT NULL;
-- The retention job: unread rows past their year. See migration 2026_11_06_0001.
CREATE INDEX idx_notifications_unread_created_at ON notifications (created_at) WHERE read_at IS NULL;

-- #167: personal API tokens. See migration 2026_10_25_0001_api_tokens.sql. A person lets a script use the API in one of their groups. Only a
-- keyed SHA-256 of the token is kept (`token_hash`): the token itself is shown once and never
-- stored. `access` is 1 for read-only, 2 for read-write. `expires_at` is NULL for a token that
-- never expires. `last_used_at` is written at most every few minutes. Revoking sets `revoked_at`
-- (migration 2026_10_30_0001_api_token_hardening.sql), so the next request with the token is refused
-- and can still be audited; the worker deletes the row 30 days later. The row goes with its owner
-- and with its group.
CREATE TABLE api_tokens (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    access INT2 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT api_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT api_tokens_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    CONSTRAINT api_tokens_access_check CHECK (access IN (1, 2)),
    CONSTRAINT api_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

-- A person's list of tokens, newest first.
CREATE INDEX idx_api_tokens_user_id ON api_tokens (user_id, created_at DESC);
-- The cascade from a deleted group.
CREATE INDEX idx_api_tokens_group_id ON api_tokens (group_id);

-- The audit rows of an account: sign-in, sign-out, profile, sessions and personal API tokens. See
-- migration 2026_01_26_0002_auth_profiles_audit.sql and, for the event types, the migrations that
-- widen the check (the last is 2026_12_04_0001_telegram.sql). `identifier` is plain
-- text with no foreign key, so a row outlives what it names.
CREATE TABLE auth_audits (
    id SERIAL PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type INT2 NOT NULL,
    identifier VARCHAR(320),
    ip VARCHAR(45),
    user_agent VARCHAR(300),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]))
);

CREATE INDEX idx_auth_audits_user_created_at ON auth_audits (user_id, created_at DESC);
CREATE INDEX idx_auth_audits_event_type ON auth_audits (event_type);
-- #424: the dashboard's active people per day read the trail by time alone.
CREATE INDEX idx_auth_audits_created_at ON auth_audits (created_at);
-- #462: the audit log's filters by IP prefix and by operator (`operator:<id>` rows only).
CREATE INDEX idx_auth_audits_ip ON auth_audits (ip text_pattern_ops);
CREATE INDEX idx_auth_audits_operator ON auth_audits (identifier text_pattern_ops)
    WHERE identifier LIKE 'operator:%';

-- #165: starter data on sign-up. See migration 2026_10_26_0001_starter_data.sql. Sign-up writes one
-- row here and queues a worker job that names it. The job creates the welcome note in the person's
-- first group, then sets `done_at` in a second write. The note's id is the request's id, so a job
-- that runs again, even after a crash between the two writes, finds the note and adds none. One
-- row per user: the unique key also stops a second request. The row goes with
-- the auth user.
CREATE TABLE starter_data_requests (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    done_at TIMESTAMPTZ
);

-- Tags: the second offline-writable aggregate and the parent of notes (docs/aggregates.md,
-- "Relations between aggregates"). A tag belongs to one group and has a name and a colour. Every
-- member reads a group's tags and an editor or above writes them; the handlers check that.
--
-- `version` and `change_sequence` work as on notes. A tag is deleted for good, so there is no
-- `deleted_at`: the delete still records one change on the group, which announces it.
--
-- Names are unique in a group without regard to case, so "Work" and "work" cannot both exist.
CREATE TABLE tags (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name VARCHAR(40) NOT NULL,
    color VARCHAR(10) DEFAULT '#4b5563' NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    change_sequence BIGINT NOT NULL,
    created_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT tags_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    CONSTRAINT tags_color_check CHECK (color ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT tags_version_check CHECK (version >= 1),
    CONSTRAINT tags_change_sequence_check CHECK (change_sequence >= 1)
);

CREATE UNIQUE INDEX idx_tags_group_name ON tags (group_id, lower(name));
CREATE INDEX idx_tags_group_change_sequence ON tags (group_id, change_sequence);
CREATE INDEX idx_tags_created_by ON tags (created_by_user_id);
CREATE INDEX idx_tags_updated_by ON tags (updated_by_user_id);

-- The link between a note and a tag. Deleting a tag removes its links and never touches the notes
-- (ADR 003, section 5, rule 3), so a tag's delete does not change any note's version. The tag
-- being in the note's group is kept by the repository, not by the database.
CREATE TABLE note_tags (
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX idx_note_tags_tag ON note_tags (tag_id);

-- #429: when the backup service last finished a backup well, per target (`database` today). See
-- migration 2026_11_14_0001_backup_status.sql. `infra/backup/backup.sh` writes it; the API reads it.
CREATE TABLE backup_status (
    target VARCHAR(32) PRIMARY KEY,
    succeeded_at TIMESTAMPTZ NOT NULL
);

-- #196: one row per billing action an operator asked for, by the idempotency key the page made.
-- The key is claimed before the provider is called; the audit row is written once (`audited_at`).
-- See migration 2026_11_16_0001_admin_billing.sql.
CREATE TABLE admin_billing_actions (
    idempotency_key UUID PRIMARY KEY,
    action VARCHAR(32) NOT NULL,
    group_id UUID NOT NULL,
    operator_id INT4 NOT NULL,
    -- The new trial end the first try computed for time at no charge, so a retry sends the provider
    -- the same request; `NULL` for the other actions.
    until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    audited_at TIMESTAMPTZ
);

-- #142: a sign-up waits here for the code mailed to its address; the account is created only
-- once the code is entered. See migration 2026_11_17_0001_sign_up_requests.sql.
CREATE TABLE sign_up_requests (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    secret TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- #224: set when a guest keeps their own account with this address and password.
    guest_user_id INT4 REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT sign_up_requests_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

CREATE INDEX sign_up_requests_expires_at_idx ON sign_up_requests (expires_at);

-- One code mail of a waiting sign-up that the worker has not sent yet.
CREATE TABLE sign_up_code_requests (
    id UUID PRIMARY KEY,
    sign_up_id UUID NOT NULL REFERENCES sign_up_requests (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX sign_up_code_requests_sign_up_id_idx ON sign_up_code_requests (sign_up_id);

-- #163: a person's display preferences, one versioned row per person. See migration
-- 2026_11_20_0001_user_preferences.sql.
CREATE TABLE user_preferences (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    value JSONB DEFAULT '{}'::jsonb NOT NULL,
    version INT4 DEFAULT 0 NOT NULL,
    first_time_zone VARCHAR(64),
    first_locale VARCHAR(64),
    updated_at TIMESTAMPTZ(3),
    CONSTRAINT user_preferences_version_check CHECK (version >= 0)
);

-- #224: guest accounts. See migration 2026_11_26_0001_guest_accounts.sql.
CREATE TABLE guest_events (
    id UUID PRIMARY KEY,
    kind INT2 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT guest_events_kind_check CHECK (kind BETWEEN 1 AND 3)
);

CREATE INDEX idx_guest_events_kind_created_at ON guest_events (kind, created_at);

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

CREATE TABLE guest_reminders (
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind INT2 NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, kind),
    CONSTRAINT guest_reminders_kind_check CHECK (kind BETWEEN 1 AND 3)
);

-- #391: sign-in by e-mail link. See migration 2026_11_29_0001_sign_in_links.sql.
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

-- #395: the blog's posts. See migration 2026_11_30_0001_blog_posts.sql.
CREATE TABLE blog_posts (
    id UUID PRIMARY KEY,
    slug VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    seo_title VARCHAR(70),
    description VARCHAR(300) NOT NULL,
    tldr TEXT[] DEFAULT '{}' NOT NULL,
    topic VARCHAR(50),
    cover_url VARCHAR(2000),
    cover_alt VARCHAR(300),
    body_md TEXT DEFAULT '' NOT NULL,
    status VARCHAR(16) DEFAULT 'draft' NOT NULL,
    publish_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    content_updated_at TIMESTAMPTZ,
    author_id INT4,
    author_name VARCHAR(101),
    newsletter_list VARCHAR(64),
    newsletter_sent_at TIMESTAMPTZ,
    newsletter_recipients INT4,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    CONSTRAINT blog_posts_slug_unique UNIQUE (slug),
    CONSTRAINT blog_posts_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'scheduled', 'published')),
    CONSTRAINT blog_posts_tldr_check CHECK (cardinality(tldr) <= 5),
    CONSTRAINT blog_posts_body_check CHECK (length(body_md) <= 200000),
    CONSTRAINT blog_posts_cover_check
        CHECK (cover_url IS NULL OR (cover_url LIKE 'https://%' AND cover_alt IS NOT NULL)),
    CONSTRAINT blog_posts_scheduled_check CHECK (status <> 'scheduled' OR publish_at IS NOT NULL),
    CONSTRAINT blog_posts_published_check
        CHECK (status <> 'published' OR (publish_at IS NOT NULL AND published_at IS NOT NULL)),
    CONSTRAINT blog_posts_version_check CHECK (version >= 1)
);

-- The public website's reads: newest published first, and the same per topic.
CREATE INDEX idx_blog_posts_published ON blog_posts (published_at DESC) WHERE status = 'published';
CREATE INDEX idx_blog_posts_topic_published
    ON blog_posts (topic, published_at DESC) WHERE status = 'published';
-- The admin list, most recently changed first.
CREATE INDEX idx_blog_posts_updated ON blog_posts (updated_at DESC, id DESC);

-- #229: a person's data exports. See migration 2026_12_01_0001_data_exports.sql.
CREATE TABLE data_exports (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ready_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    size_bytes INT8,
    CONSTRAINT data_exports_ready_check
        CHECK ((ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL) = (size_bytes IS NULL)),
    CONSTRAINT data_exports_size_check CHECK (size_bytes >= 0)
);

CREATE INDEX idx_data_exports_user_requested ON data_exports (user_id, requested_at DESC);

-- #269: a notification on its way to the person's Telegram chat. See migration
-- 2026_12_04_0001_telegram.sql. The worker's job names this row, reads the notification and the
-- link when it runs, and deletes the row once the message is sent.
CREATE TABLE telegram_messages (
    id UUID PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_telegram_messages_user_id ON telegram_messages (user_id);
CREATE INDEX idx_telegram_messages_notification_id ON telegram_messages (notification_id);

-- Note attachments (#225, docs/files.md). A file is kept in the file store under `object_key`;
-- this table says which note it belongs to. A note's group is the file's group, so a file moves
-- with its note and needs no group column of its own. Deleting the note (its purge, its group's,
-- its owner's account) deletes the row through the foreign key, and the trigger below queues the
-- stored object for the worker to delete.
CREATE TABLE note_attachments (
    id UUID PRIMARY KEY,
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    object_key VARCHAR(200) NOT NULL,
    name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INT4 NOT NULL,
    created_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT note_attachments_object_key_unique UNIQUE (object_key),
    CONSTRAINT note_attachments_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 255),
    CONSTRAINT note_attachments_size_check CHECK (size_bytes >= 1)
);

CREATE INDEX idx_note_attachments_note ON note_attachments (note_id, created_at, id);
CREATE INDEX idx_note_attachments_created_by ON note_attachments (created_by_user_id);

-- An upload that was signed, by any feature: a note attachment's names its note, a profile
-- picture's (#228) has none. The browser PUTs to `staging_key`; the confirm settles this row
-- first (`settled_at`), so one upload is confirmed at most once, and only by `user_id`. The id is
-- the file's id once confirmed. The worker deletes rows older than a day.
CREATE TABLE file_uploads (
    id UUID PRIMARY KEY,
    note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    staging_key VARCHAR(200) NOT NULL,
    name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INT4 NOT NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- When the upload was confirmed or cancelled; NULL while it waits. A settled row stays until
    -- the clean-up, so the hourly upload budget still counts it.
    settled_at TIMESTAMPTZ(3),
    CONSTRAINT file_uploads_staging_key_unique UNIQUE (staging_key),
    CONSTRAINT file_uploads_size_check CHECK (size_bytes >= 1)
);

CREATE INDEX idx_file_uploads_note ON file_uploads (note_id);
CREATE INDEX idx_file_uploads_user ON file_uploads (user_id);
CREATE INDEX idx_file_uploads_created ON file_uploads (created_at);

-- Stored objects to delete. No foreign key, so the demo's nightly wipe keeps it (KEPT_TABLES) and
-- a deleted row's object is still found. The worker deletes the object, then the row.
CREATE TABLE file_deletions (
    object_key VARCHAR(200) PRIMARY KEY,
    queued_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE FUNCTION queue_note_attachment_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO file_deletions (object_key) VALUES (OLD.object_key) ON CONFLICT DO NOTHING;
    RETURN OLD;
END;
$$;

CREATE TRIGGER note_attachments_queue_deletion
    AFTER DELETE ON note_attachments
    FOR EACH ROW EXECUTE FUNCTION queue_note_attachment_deletion();

CREATE FUNCTION queue_user_picture_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.picture_id IS NOT NULL
        AND (TG_OP = 'DELETE' OR NEW.picture_id IS DISTINCT FROM OLD.picture_id) THEN
        INSERT INTO file_deletions (object_key) VALUES ('pictures/' || OLD.picture_id)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER users_queue_picture_deletion
    AFTER UPDATE OF picture_id OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION queue_user_picture_deletion();
