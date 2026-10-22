/**
 * Guest accounts (#224) in Postgres: making one, keeping one (it gains a sign-in method and stays
 * the same user), moving a guest's groups into another account, deleting a guest, the clean-up of
 * empty and idle guests, the once-only inbox reminders and the counts the dashboard shows.
 *
 * A guest is a `users` row whose `guest_since` is set. A session must name a key, so a guest also
 * has one `auth_keys` row of method {@link GUEST_METHOD} with a random subject; no route signs in
 * with it, and keeping the account moves the guest's sessions to the new key and deletes it.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { SessionStatus } from "@spy4x/server/sign-in"
import {
  GUEST_EMPTY_DAYS,
  GUEST_IDLE_DAYS,
  GUEST_METHOD,
  GUEST_SESSION_DAYS,
  GUEST_SWITCH_MINUTES,
  GuestEventKind,
  GuestReminderKind,
  type GuestStats,
} from "@domain/identity"
import { NotificationKind } from "@domain/notifications"
import { createNotification } from "../notifications/create-notification.ts"
import { writeAuditEvent } from "../groups/audit.ts"
import { recordAccessChange } from "../groups/group-change-log.ts"
import { OWNERSHIP_TRANSFERRED_EVENT } from "../groups/postgres-group-repository.ts"
import { accountDeletionBlockers } from "./account-deletion.ts"

const DAY_MS = 24 * 60 * 60_000

/** The auth user and the guest key of a new guest, made by {@link createGuestIdentity}. */
export interface GuestIdentity {
  userId: number
  keyId: number
}

/**
 * Writes the `auth_users` row and the guest key of a new guest in the caller's transaction. The
 * caller writes the `users` row (with `guest_since`), the first group and the session after it.
 */
export async function createGuestIdentity(tx: postgres.Sql): Promise<GuestIdentity> {
  const [user] = await tx<{ id: number }[]>`INSERT INTO auth_users DEFAULT VALUES RETURNING id`
  const [key] = await tx<{ id: number }[]>`
    INSERT INTO auth_keys (user_id, method, subject)
    VALUES (${user.id}, ${GUEST_METHOD}, ${uuidV7()})
    RETURNING id
  `
  return { userId: user.id, keyId: key.id }
}

/** Writes one row of the dashboard's guest counts. */
export async function recordGuestEvent(tx: postgres.Sql, kind: GuestEventKind): Promise<void> {
  await tx`INSERT INTO guest_events (id, kind) VALUES (${uuidV7()}, ${kind})`
}

/** Whether `userId` is a guest who has not kept the account. */
export async function isGuestUser(sql: postgres.Sql, userId: number): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM users WHERE id = ${userId} AND guest_since IS NOT NULL`
  return rows.length > 0
}

/**
 * Turns guest `userId` into a kept account, in the transaction that added the sign-in method
 * `keyId`: the guest's sessions move to that key (so this browser stays signed in), the guest key
 * goes, a waiting switch and the unread reminders go, and the dashboard counts one kept guest.
 * The sessions also stop at `sessionEnd` at the latest: a kept account's sessions last as long as
 * any other account's, not a guest's year. `false`, and nothing written, when the user is no guest
 * (any more): keeping twice keeps once.
 */
export async function keepGuest(
  tx: postgres.Sql,
  userId: number,
  keyId: number,
  sessionEnd: Date,
): Promise<boolean> {
  const kept = await tx`
    UPDATE users SET guest_since = NULL, updated_at = now()
    WHERE id = ${userId} AND guest_since IS NOT NULL
    RETURNING id
  `
  if (kept.length === 0) return false
  await tx`
    UPDATE auth_sessions SET key_id = ${keyId}, expires_at = LEAST(expires_at, ${sessionEnd})
    WHERE user_id = ${userId}
      AND key_id IN (SELECT id FROM auth_keys WHERE user_id = ${userId} AND method = ${GUEST_METHOD})
  `
  await tx`DELETE FROM auth_keys WHERE user_id = ${userId} AND method = ${GUEST_METHOD}`
  await tx`DELETE FROM guest_switches WHERE guest_user_id = ${userId}`
  await tx`
    DELETE FROM notifications
    WHERE user_id = ${userId} AND kind = ${NotificationKind.GuestReminder} AND read_at IS NULL
  `
  await recordGuestEvent(tx, GuestEventKind.Kept)
  return true
}

/**
 * Renews the session `sessionId` of guest `userId` to a full {@link GUEST_SESSION_DAYS} again, at
 * most once a day, and counts that day of use. Answers the new expiry when it renewed, so the
 * caller sends the cookie again, and how many days of use the guest has had; `null` when the
 * session was renewed less than a day ago, is not a guest's, or is no longer active.
 */
export async function renewGuestSession(
  sql: postgres.Sql,
  userId: number,
  sessionId: number,
  now: Date = new Date(),
): Promise<{ expiresAt: Date; visitDays: number } | null> {
  const expiresAt = new Date(now.getTime() + GUEST_SESSION_DAYS * DAY_MS)
  const renewedBefore = new Date(expiresAt.getTime() - DAY_MS)
  return await sql.begin(async (tx) => {
    const renewed = await tx`
      UPDATE auth_sessions SET expires_at = ${expiresAt}
      WHERE id = ${sessionId} AND user_id = ${userId} AND status = ${SessionStatus.Active}
        AND expires_at <= ${renewedBefore}
        AND EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND guest_since IS NOT NULL)
      RETURNING id
    `
    if (renewed.length === 0) return null
    const [user] = await tx<{ visitDays: number }[]>`
      UPDATE users SET guest_visit_days = LEAST(guest_visit_days + 1, 32767)
      WHERE id = ${userId}
      RETURNING guest_visit_days AS "visitDays"
    `
    return { expiresAt, visitDays: user?.visitDays ?? 0 }
  })
}

/** The inbox text of each reminder. The action is the notification's link: "Keep your account". */
export const GUEST_REMINDERS: Record<GuestReminderKind, { title: string; text: string }> = {
  [GuestReminderKind.FirstNote]: {
    title: "Keep the note you just wrote",
    text: "It lives only in this browser for now. Add a sign-in method to open it on any device.",
  },
  [GuestReminderKind.ThirdVisit]: {
    title: "Open this account on your other devices",
    text: "So far only this browser can open it. Add a sign-in method to reach it anywhere.",
  },
  [GuestReminderKind.Invite]: {
    title: "Add a sign-in method to invite people",
    text: "The people you invite see who invited them, and a guest account has no sign-in yet. " +
      "Add one, then invite from the group's settings.",
  },
}

/** The page every reminder opens. */
export const GUEST_KEEP_PATH = "/keep"

/**
 * Puts reminder `kind` in guest `userId`'s inbox, once ever: a second call, or a call for an
 * account that is no guest (any more), writes nothing. `true` when it wrote the notification.
 */
export async function remindGuest(
  sql: postgres.Sql,
  userId: number,
  kind: GuestReminderKind,
): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const claimed = await tx`
      INSERT INTO guest_reminders (user_id, kind)
      SELECT id, ${kind} FROM users WHERE id = ${userId} AND guest_since IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING user_id
    `
    if (claimed.length === 0) return false
    const { title, text } = GUEST_REMINDERS[kind]
    await createNotification(tx, {
      userId,
      kind: NotificationKind.GuestReminder,
      payload: { title, text },
      link: GUEST_KEEP_PATH,
    })
    return true
  })
}

/** The groups a guest owns and the notes in them, for the switch page. */
export async function guestHoldings(
  sql: postgres.Sql,
  userId: number,
): Promise<{ groups: { id: string; name: string }[]; notes: number }> {
  const groups = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM groups
    WHERE owner_user_id = ${userId} AND deleted_at IS NULL
    ORDER BY created_at, id
  `
  const [{ notes }] = await sql<{ notes: number }[]>`
    SELECT count(*)::int AS notes FROM notes
    INNER JOIN groups ON groups.id = notes.group_id
    WHERE groups.owner_user_id = ${userId} AND groups.deleted_at IS NULL
      AND notes.deleted_at IS NULL
  `
  return { groups, notes }
}

/** The choice that waits after a guest's new sign-in method turned out to be another account's. */
export interface GuestSwitch {
  targetUserId: number
  targetKeyId: number
  method: string
  needsPassword: boolean
}

/** Records the switch that waits for guest `userId`, replacing any older one. */
export async function saveGuestSwitch(
  sql: postgres.Sql,
  userId: number,
  sw: GuestSwitch,
  now: Date = new Date(),
): Promise<void> {
  const expiresAt = new Date(now.getTime() + GUEST_SWITCH_MINUTES * 60_000)
  await sql`
    INSERT INTO guest_switches
      (guest_user_id, target_user_id, target_key_id, method, needs_password, expires_at)
    VALUES (${userId}, ${sw.targetUserId}, ${sw.targetKeyId}, ${sw.method}, ${sw.needsPassword},
      ${expiresAt})
    ON CONFLICT (guest_user_id) DO UPDATE SET
      target_user_id = EXCLUDED.target_user_id, target_key_id = EXCLUDED.target_key_id,
      method = EXCLUDED.method, needs_password = EXCLUDED.needs_password,
      expires_at = EXCLUDED.expires_at, created_at = now()
  `
}

/** The switch that waits for guest `userId` and has not expired, or `null`. */
export async function findGuestSwitch(
  sql: postgres.Sql,
  userId: number,
  now: Date = new Date(),
): Promise<GuestSwitch | null> {
  const [row] = await sql<GuestSwitch[]>`
    SELECT target_user_id AS "targetUserId", target_key_id AS "targetKeyId", method,
      needs_password AS "needsPassword"
    FROM guest_switches
    WHERE guest_user_id = ${userId} AND expires_at > ${now}
  `
  return row ?? null
}

/** Forgets the switch that waits for guest `userId`, if any. */
export async function dropGuestSwitch(sql: postgres.Sql, userId: number): Promise<void> {
  await sql`DELETE FROM guest_switches WHERE guest_user_id = ${userId}`
}

/**
 * Moves every live group guest `guestId` owns to account `targetId`, in the caller's transaction:
 * the owner's membership, the owner column, and the guest's name on what they wrote become the
 * other account's, and each group records an ownership change so open pages update. A guest
 * cannot invite, so the groups a guest created have no other member; a group a guest was handed
 * after joining it by link can, and the move then fails as a whole if `targetId` is already one of
 * its members. Answers
 * how many groups moved. The caller deletes the guest afterwards.
 */
export async function moveGuestGroups(
  tx: postgres.TransactionSql,
  guestId: number,
  targetId: number,
): Promise<number> {
  const groups = await tx<{ id: string }[]>`
    SELECT id FROM groups
    WHERE owner_user_id = ${guestId} AND deleted_at IS NULL
    ORDER BY id
    FOR UPDATE
  `
  for (const { id } of groups) {
    await tx`
      UPDATE group_members SET user_id = ${targetId}, updated_at = CURRENT_TIMESTAMP
      WHERE group_id = ${id} AND user_id = ${guestId}
    `
    await tx`
      UPDATE groups SET owner_user_id = ${targetId}, created_by_user_id = ${targetId}
      WHERE id = ${id}
    `
    await tx`
      UPDATE notes SET created_by_user_id = ${targetId} WHERE group_id = ${id}
        AND created_by_user_id = ${guestId}
    `
    await tx`
      UPDATE notes SET updated_by_user_id = ${targetId} WHERE group_id = ${id}
        AND updated_by_user_id = ${guestId}
    `
    await tx`
      UPDATE tags SET created_by_user_id = ${targetId} WHERE group_id = ${id}
        AND created_by_user_id = ${guestId}
    `
    await tx`
      UPDATE tags SET updated_by_user_id = ${targetId} WHERE group_id = ${id}
        AND updated_by_user_id = ${guestId}
    `
    await writeAuditEvent(tx, {
      eventKind: OWNERSHIP_TRANSFERRED_EVENT,
      actorId: targetId,
      groupId: id,
      targetUserId: targetId,
    })
    await recordAccessChange(tx, id, targetId, OWNERSHIP_TRANSFERRED_EVENT, [])
  }
  // The group change rows the guest's work wrote name them as actor, and that foreign key does not
  // let the guest go; they are the same person's changes, so they name the other account now.
  await tx`UPDATE outbox_events SET actor_user_id = ${targetId} WHERE actor_user_id = ${guestId}`
  return groups.length
}

/**
 * Deletes guest `userId` with everything they own, in the caller's transaction, as the delete for
 * good of an account does: their group change rows, their groups (with every note and tag in them)
 * and the auth user, which takes the `users` row, the keys, the sessions and the rest along. Only
 * a guest: `false`, and nothing deleted, for an account that is no guest, or a guest whose group
 * someone else belongs to (nothing lets that happen today, but such a group is not theirs alone).
 */
export async function deleteGuest(tx: postgres.TransactionSql, userId: number): Promise<boolean> {
  const [user] = await tx`
    SELECT id FROM users WHERE id = ${userId} AND guest_since IS NOT NULL FOR UPDATE
  `
  if (!user) return false
  await tx`SELECT id FROM groups WHERE owner_user_id = ${userId} ORDER BY id FOR UPDATE`
  if ((await accountDeletionBlockers(tx, userId)).length > 0) return false
  await tx`DELETE FROM outbox_events WHERE actor_user_id = ${userId}`
  await tx`DELETE FROM groups WHERE owner_user_id = ${userId}`
  await tx`DELETE FROM auth_users WHERE id = ${userId}`
  return true
}

/**
 * Deletes the guests the clean-up is due to delete at `now`, each in a transaction of its own, and
 * counts each one for the dashboard. Due: a guest made over {@link GUEST_EMPTY_DAYS} days ago who
 * has nothing of their own (no note but an unedited welcome note, no tag, no membership of a
 * group they do not own), and any guest not seen for {@link GUEST_IDLE_DAYS} days. Running it
 * twice deletes nobody twice. Answers how many it deleted.
 */
export async function cleanUpGuests(
  sql: postgres.Sql,
  now: Date = new Date(),
  batch = 500,
): Promise<number> {
  const emptyBefore = new Date(now.getTime() - GUEST_EMPTY_DAYS * DAY_MS)
  const idleBefore = new Date(now.getTime() - GUEST_IDLE_DAYS * DAY_MS)
  const due = await sql<{ id: number }[]>`
    SELECT users.id FROM users
    WHERE users.guest_since IS NOT NULL AND ${dueToCleanUp(sql, emptyBefore, idleBefore)}
    ORDER BY users.id
    LIMIT ${batch}
  `
  let deleted = 0
  for (const { id } of due) {
    const gone = await sql.begin(async (tx) => {
      // Asked again under the lock: a guest who wrote something since the list was read stays.
      await tx`SELECT id FROM users WHERE id = ${id} FOR UPDATE`
      const still = await tx`
        SELECT 1 FROM users
        WHERE id = ${id} AND guest_since IS NOT NULL AND ${
        dueToCleanUp(tx, emptyBefore, idleBefore)
      }
      `
      if (still.length === 0) return false
      if (!(await deleteGuest(tx, id))) return false
      await recordGuestEvent(tx, GuestEventKind.CleanedUp)
      return true
    })
    if (gone) deleted++
  }
  return deleted
}

/** The clean-up's rule for the `users` row in the query around it, as an SQL fragment. */
function dueToCleanUp(sql: postgres.Sql, emptyBefore: Date, idleBefore: Date) {
  return sql`(
        COALESCE(users.last_seen_at, users.guest_since) <= ${idleBefore}
        OR (
          users.guest_since <= ${emptyBefore}
          AND NOT EXISTS (
            SELECT 1 FROM notes
            INNER JOIN group_members ON group_members.group_id = notes.group_id
            WHERE group_members.user_id = users.id
              AND NOT (notes.version = 1 AND notes.id IN (
                SELECT starter_data_requests.id FROM starter_data_requests
                WHERE starter_data_requests.user_id = users.id
              ))
          )
          AND NOT EXISTS (
            SELECT 1 FROM tags
            INNER JOIN group_members ON group_members.group_id = tags.group_id
            WHERE group_members.user_id = users.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM group_members
            INNER JOIN groups ON groups.id = group_members.group_id
            WHERE group_members.user_id = users.id AND groups.owner_user_id <> users.id
          )
        )
  )`
}

/** Guest accounts made, kept and cleaned up since `since` (all time without it). */
export async function guestStats(sql: postgres.Sql, since?: Date): Promise<GuestStats> {
  const rows = await sql<{ kind: number; count: number }[]>`
    SELECT kind, count(*)::int AS count FROM guest_events
    ${since ? sql`WHERE created_at >= ${since}` : sql``}
    GROUP BY kind
  `
  const count = (kind: GuestEventKind) => rows.find((row) => row.kind === kind)?.count ?? 0
  return {
    created: count(GuestEventKind.Created),
    kept: count(GuestEventKind.Kept),
    cleanedUp: count(GuestEventKind.CleanedUp),
  }
}
