/**
 * What a person's data export holds (#229, docs/data-export.md): one section per kind of row, each
 * a list of rows in the JSON file and a CSV file of its own. A new table that holds a person's
 * data adds its section here (docs/aggregates.md, "The person's data export").
 *
 * The rule every section keeps: a row is in the export only when it is about the person or was
 * made by them, and it carries no other person's data and no secret. In a shared group that means
 * the notes and tags the person created, never the ones others wrote; the person's groups by name
 * and role, never their members. No column holds a password, a token, a hash, a key or another
 * person's address or id.
 *
 * @module
 */

import type postgres from "postgres"
import { TELEGRAM_METHOD } from "@domain/identity"

/** One kind of row in the export. */
export interface DataExportSection {
  /** The JSON key and the CSV file's name: lower case words joined by `_`. */
  name: string
  /** The columns, in order: the JSON keys of every row and the CSV header. */
  columns: readonly string[]
  /** The person's rows, oldest first, with exactly {@link columns} as fields. */
  rows(sql: postgres.Sql, userId: number): postgres.PendingQuery<postgres.Row[]>
}

/** Groups the person belongs to now: the only groups whose notes and tags the export reads. */
const memberOf = (sql: postgres.Sql, userId: number) =>
  sql`SELECT group_members.group_id FROM group_members
    JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
    WHERE group_members.user_id = ${userId}`

/**
 * Every section, in the order the JSON file lists them. The SQL names each column as
 * {@link DataExportSection.columns} has it; the worker's pool turns `snake_case` into `camelCase`.
 */
export const DATA_EXPORT_SECTIONS: readonly DataExportSection[] = [
  {
    name: `profile`,
    columns: [
      `firstName`,
      `lastName`,
      `createdAt`,
      `lastLoginAt`,
      `lastSeenAt`,
      `twoFactorOnSince`,
      `selectedGroupId`,
      `pendingEmail`,
      `deletionScheduledFor`,
      `guestSince`,
      `trialUsedAt`,
      `onboardingDismissedAt`,
      `onboardingTourSeenAt`,
      `pictureId`,
    ],
    rows: (sql, userId) =>
      sql`SELECT users.first_name, users.last_name, users.created_at, users.last_login_at,
        users.last_seen_at, user_totp.confirmed_at AS two_factor_on_since,
        user_settings.selected_group_id, email_changes.email AS pending_email,
        account_deletions.delete_after AS deletion_scheduled_for, users.guest_since,
        users.trial_used_at, users.onboarding_dismissed_at, users.onboarding_tour_seen_at,
        users.picture_id
      FROM users
      LEFT JOIN user_totp ON user_totp.user_id = users.id
      LEFT JOIN user_settings ON user_settings.user_id = users.id
      LEFT JOIN email_changes ON email_changes.user_id = users.id
      LEFT JOIN account_deletions ON account_deletions.user_id = users.id
      WHERE users.id = ${userId}`,
  },
  {
    name: `preferences`,
    columns: [`settings`, `firstTimeZone`, `firstLocale`, `updatedAt`],
    rows: (sql, userId) =>
      sql`SELECT value AS settings, first_time_zone, first_locale, updated_at
      FROM user_preferences WHERE user_id = ${userId}`,
  },
  {
    // A linked Telegram account is an `auth_keys` row too, but no way in: it has its own section.
    name: `sign_in_methods`,
    columns: [`id`, `method`, `email`, `provenAt`, `passkeyName`, `lastUsedAt`, `createdAt`],
    rows: (sql, userId) =>
      sql`SELECT auth_keys.id, auth_keys.method, auth_keys.email, auth_keys.proven_at,
        auth_passkeys.name AS passkey_name, auth_passkeys.last_used_at, auth_keys.created_at
      FROM auth_keys
      LEFT JOIN auth_passkeys ON auth_passkeys.key_id = auth_keys.id
      WHERE auth_keys.user_id = ${userId} AND auth_keys.method <> ${TELEGRAM_METHOD}
      ORDER BY auth_keys.id`,
  },
  {
    name: `sessions`,
    columns: [`id`, `device`, `ipHint`, `status`, `createdAt`, `lastUsedAt`, `expiresAt`],
    rows: (sql, userId) =>
      sql`SELECT id, device_name AS device, ip_hint,
        CASE status WHEN 1 THEN 'active' WHEN 2 THEN 'expired' ELSE 'signed out' END AS status,
        created_at, last_used_at, expires_at
      FROM auth_sessions WHERE user_id = ${userId}
      ORDER BY id`,
  },
  {
    // `identifier` is left out: on an operator's action it names the operator. An action an
    // operator or the server's command line took on the person keeps its row, so the person sees
    // it happened, but not the address and browser it came from: those are the operator's.
    name: `account_activity`,
    columns: [`eventType`, `ip`, `userAgent`, `createdAt`],
    rows: (sql, userId) =>
      sql`SELECT event_type,
        CASE WHEN identifier LIKE 'operator:%' OR identifier LIKE 'cli:%' THEN NULL ELSE ip END
          AS ip,
        CASE WHEN identifier LIKE 'operator:%' OR identifier LIKE 'cli:%' THEN NULL
          ELSE user_agent END AS user_agent,
        created_at
      FROM auth_audits WHERE user_id = ${userId} AND deleted_at IS NULL
      ORDER BY created_at, id`,
  },
  {
    // The push endpoint and its keys are left out: they let anyone holding them reach the device.
    name: `push_devices`,
    columns: [`deviceId`, `createdAt`, `removedAt`],
    rows: (sql, userId) =>
      sql`SELECT device_id, created_at, deleted_at AS removed_at
      FROM user_push_tokens WHERE user_id = ${userId}
      ORDER BY id`,
  },
  {
    // The linked Telegram account (#269, docs/telegram.md): Seed keeps its user id only, no
    // Telegram name and no messages.
    name: `telegram`,
    columns: [`telegramUserId`, `linkedAt`],
    rows: (sql, userId) =>
      sql`SELECT subject AS telegram_user_id, created_at AS linked_at
      FROM auth_keys WHERE user_id = ${userId} AND method = ${TELEGRAM_METHOD}`,
  },
  {
    name: `groups`,
    columns: [`id`, `name`, `role`, `joinedAt`],
    rows: (sql, userId) =>
      sql`SELECT groups.id, groups.name,
        CASE group_members.role
          WHEN 1 THEN 'viewer' WHEN 2 THEN 'editor' WHEN 3 THEN 'admin' ELSE 'owner'
        END AS role,
        group_members.created_at AS joined_at
      FROM group_members
      JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
      WHERE group_members.user_id = ${userId}
      ORDER BY group_members.created_at, groups.id`,
  },
  {
    name: `notes`,
    columns: [`id`, `groupId`, `title`, `body`, `tagIds`, `createdAt`, `updatedAt`, `deletedAt`],
    rows: (sql, userId) =>
      sql`SELECT notes.id, notes.group_id, notes.title, notes.body,
        COALESCE((
          SELECT string_agg(note_tags.tag_id::text, ' ' ORDER BY note_tags.tag_id)
          FROM note_tags JOIN tags ON tags.id = note_tags.tag_id
          WHERE note_tags.note_id = notes.id AND tags.created_by_user_id = ${userId}
        ), '') AS tag_ids,
        notes.created_at, notes.updated_at, notes.deleted_at
      FROM notes
      WHERE notes.created_by_user_id = ${userId}
        AND notes.group_id IN (${memberOf(sql, userId)})
      ORDER BY notes.created_at, notes.id`,
  },
  {
    // The files the person attached, in groups they still belong to: what each is, never its
    // bytes, which stay in the app's file store and open from the note.
    name: `note_attachments`,
    columns: [`id`, `noteId`, `groupId`, `name`, `contentType`, `sizeBytes`, `createdAt`],
    rows: (sql, userId) =>
      sql`SELECT note_attachments.id, note_attachments.note_id, notes.group_id,
        note_attachments.name, note_attachments.content_type, note_attachments.size_bytes,
        note_attachments.created_at
      FROM note_attachments JOIN notes ON notes.id = note_attachments.note_id
      WHERE note_attachments.created_by_user_id = ${userId}
        AND notes.group_id IN (${memberOf(sql, userId)})
      ORDER BY note_attachments.created_at, note_attachments.id`,
  },
  {
    name: `tags`,
    columns: [`id`, `groupId`, `name`, `color`, `createdAt`, `updatedAt`],
    rows: (sql, userId) =>
      sql`SELECT id, group_id, name, color, created_at, updated_at
      FROM tags
      WHERE created_by_user_id = ${userId} AND group_id IN (${memberOf(sql, userId)})
      ORDER BY created_at, id`,
  },
  {
    // What the person did in their groups, by kind and id. `details` and the person acted on are
    // left out: they can name other people.
    name: `group_activity`,
    columns: [`kind`, `groupId`, `entityType`, `entityId`, `createdAt`],
    rows: (sql, userId) =>
      sql`SELECT event_kind AS kind, group_id, entity_type, entity_id, created_at
      FROM audit_events WHERE actor_user_id = ${userId}
      ORDER BY created_at, id`,
  },
  {
    // The invited address is left out: it is the other person's.
    name: `invitations_sent`,
    columns: [`id`, `groupId`, `role`, `maxUses`, `uses`, `createdAt`, `expiresAt`, `revokedAt`],
    rows: (sql, userId) =>
      sql`SELECT id, group_id,
        CASE role WHEN 1 THEN 'viewer' WHEN 2 THEN 'editor' ELSE 'admin' END AS role,
        max_uses, uses, created_at, expires_at, revoked_at
      FROM group_invitations WHERE created_by_user_id = ${userId}
      ORDER BY created_at, id`,
  },
  {
    name: `invitations_accepted`,
    columns: [`invitationId`, `acceptedAt`],
    rows: (sql, userId) =>
      sql`SELECT invitation_id, accepted_at
      FROM group_invitation_acceptances WHERE user_id = ${userId}
      ORDER BY accepted_at`,
  },
  {
    name: `notifications`,
    columns: [`id`, `kind`, `details`, `link`, `createdAt`, `readAt`],
    rows: (sql, userId) =>
      sql`SELECT id::text, kind, payload AS details, link, created_at, read_at
      FROM notifications WHERE user_id = ${userId}
      ORDER BY id`,
  },
  {
    // The token itself is never stored; its hash is left out too.
    name: `api_tokens`,
    columns: [
      `id`,
      `groupId`,
      `name`,
      `access`,
      `createdAt`,
      `expiresAt`,
      `lastUsedAt`,
      `revokedAt`,
    ],
    rows: (sql, userId) =>
      sql`SELECT id, group_id, name,
        CASE access WHEN 1 THEN 'read' ELSE 'read and write' END AS access,
        created_at, expires_at, last_used_at, revoked_at
      FROM api_tokens WHERE user_id = ${userId}
      ORDER BY created_at, id`,
  },
  {
    // The groups the person owns are the ones they pay for.
    name: `subscriptions`,
    columns: [`groupId`, `planId`, `status`, `trialEnd`, `currentPeriodEnd`, `cancelAtPeriodEnd`],
    rows: (sql, userId) =>
      sql`SELECT subscriptions.group_id, subscriptions.plan_id,
        CASE subscriptions.status
          WHEN 1 THEN 'trialing' WHEN 2 THEN 'active' WHEN 3 THEN 'past due'
          WHEN 4 THEN 'canceled' WHEN 5 THEN 'incomplete' ELSE 'paused'
        END AS status,
        subscriptions.trial_end, subscriptions.current_period_end,
        subscriptions.cancel_at_period_end
      FROM subscriptions
      JOIN group_members ON group_members.group_id = subscriptions.group_id
        AND group_members.user_id = ${userId} AND group_members.role = 4
      ORDER BY subscriptions.group_id`,
  },
  {
    // The unsubscribe key is left out: it is a secret.
    name: `newsletters`,
    columns: [`list`, `email`, `subscribedAt`],
    rows: (sql, userId) =>
      sql`SELECT list_id AS list, email, subscribed_at
      FROM subscribers
      WHERE email IN (SELECT email FROM auth_email_owners WHERE user_id = ${userId})
      ORDER BY subscribed_at`,
  },
  {
    name: `blog_posts`,
    columns: [`id`, `slug`, `title`, `status`, `publishedAt`, `createdAt`],
    rows: (sql, userId) =>
      sql`SELECT id, slug, title, status, published_at, created_at
      FROM blog_posts WHERE author_id = ${userId}
      ORDER BY created_at, id`,
  },
  {
    name: `data_exports`,
    columns: [`id`, `requestedAt`, `readyAt`, `expiresAt`],
    rows: (sql, userId) =>
      sql`SELECT id, requested_at, ready_at, expires_at
      FROM data_exports WHERE user_id = ${userId}
      ORDER BY requested_at`,
  },
]
