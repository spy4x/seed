import { Hono } from "hono"
import type { Context } from "hono"
import { APIContext } from "../_types.ts"
import { validate } from "@spy4x/validation"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { normalizeEmail } from "@spy4x/server/auth"
import { authEmailSchema, authLoginSchema, UserRole } from "@domain/identity"
import { GroupRole } from "@domain/groups"
import { recordAccessChange } from "@server/groups/group-change-log.ts"
import { type } from "arktype"
import type { Sql, Transaction } from "@spy4x/server/db"
import type { AppDbBase } from "@api/services/db-base.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { normalizeUsername } from "@api/services/sign-in.ts"
import { signUpClient } from "../middlewares/auth-rate-limits.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"

/** What the development-only routes need. */
export interface DevRouteDeps {
  /** Refuses every request with 403 when false, in case the route is ever mounted outside dev. */
  isDev: boolean
  /** Finds the user behind a sign-in name. */
  db: Pick<AppDbBase, "authStore">
  /** The client the cleanup's transaction runs on. */
  sql: Sql
  /** Closes every open socket of a user like a dropped connection; returns how many it closed. */
  closeSockets(userId: number): number
  /**
   * Gives a normalised address back its hourly code mails: its own, its sign-up total and the
   * sign-up share of `client` (what `signUpClient` answers for the caller), so a spec that signs a
   * fixed address up again and again is not refused with 429 on a dev stack that outlives one run.
   */
  forgetCodeBudget(email: string, client: string): Promise<void>
}

/**
 * Routes that exist only in development, for the e2e specs and local scripts.
 *
 * Each route that names a user takes `{ login }`: what the user signs in with, an e-mail address or
 * an older account's username.
 *
 * `POST /cleanup-user` with `{ login }` deletes that user and everything that would stop the
 * delete: the groups they own or created (with their memberships, audit and outbox events), the
 * audit and outbox events they are the actor of, the notes they wrote, and the memberships they
 * granted in other groups.
 * It answers 200 when the login has no user, so a spec can call it before its own sign-up. For an
 * address it also forgets the code mails the address was sent this hour, which every sign-up
 * spends (#142), so the caller's next sign-up of the address gets its code. A sign-up is counted
 * per address and client together (#494), and the caller's client share is the one forgotten: the
 * e2e specs call this route through the same proxy as the browser they sign up with.
 *
 * `POST /add-member` with `{ login, groupId, role }` makes that user a member of a shared group
 * with the role (1 viewer, 2 editor, 3 admin), or changes the role of one who is. The product has
 * no way to add a member yet, and the notes e2e spec needs a second member of one group. It
 * answers 404 when the user or the shared group does not exist, and 409 for the group's owner,
 * whose role it never changes: a group has exactly one owner.
 *
 * `POST /close-sockets` with `{ login }` closes that user's WebSockets the way a dropped network
 * would, so an e2e spec can check that the app catches up after a reconnect. It answers with how
 * many sockets it closed.
 *
 * `POST /set-role` with `{ login, role }` gives that user the role (1 viewer, 2 operator,
 * 3 supervisor, 4 administrator), so the operator area's e2e spec has an operator. Production sets
 * a role with `deno task user:role` instead. It answers 404 when the user does not exist.
 *
 * `POST /last-mail` with `{ email }` answers the newest mail the worker sent to that address in
 * development (`dev_mail`): `{ subject, text }`, or 404 when there is none. The e2e specs read a
 * password reset link this way.
 */
export function createDevRoute(deps: DevRouteDeps) {
  return new Hono<APIContext>()
    .post("/cleanup-user", async (c) => {
      const user = await readLogin(c, deps)
      if (user instanceof Response) return user
      if (user.userId !== null) {
        await deleteUser(deps.sql, user.userId)
      }
      if (user.email !== null) await deps.forgetCodeBudget(user.email, signUpClient(c))
      return c.json({ success: true })
    })
    .post("/add-member", async (c) => {
      if (!deps.isDev) return errorResponse(c, `forbidden`, { message: "Not allowed" })
      let body: unknown = null
      try {
        body = await readApiJson(c)
      } catch (_error) {
        body = null
      }
      const validation = validate(addMemberSchema, body)
      if (validation.error) {
        return validationResponse(c, validation.error.details)
      }
      const { login, groupId, role } = validation.data
      const key = await findPasswordKey(deps, login)
      if (!key) return errorResponse(c, `not_found`, { message: "No such user" })
      // Through `recordAccessChange`, as every member change goes: the group's revision rises
      // and its open pages hear of the change.
      const added = await deps.sql.begin(async (tx: Transaction) => {
        const rows = await tx`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          SELECT groups.id, ${key.userId}, ${role}, groups.owner_user_id
          FROM groups
          WHERE groups.id = ${groupId} AND groups.deleted_at IS NULL
          ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
            WHERE group_members.role <> ${GroupRole.OWNER}
          RETURNING user_id
        `
        if (rows.length > 0) {
          const [{ ownerUserId }] = await tx<{ ownerUserId: number }[]>`
            SELECT owner_user_id FROM groups WHERE id = ${groupId}
          `
          await recordAccessChange(tx, groupId, ownerUserId, "group.member_added", [])
        }
        return rows
      })
      if (added.length === 0) {
        const owner = await deps.sql`
          SELECT 1 FROM group_members
          WHERE group_id = ${groupId} AND user_id = ${key.userId} AND role = ${GroupRole.OWNER}
        `
        if (owner.length > 0) {
          return errorResponse(c, `conflict`, { message: "The owner's role is not changed here" })
        }
        return errorResponse(c, `not_found`, { message: "No such group" })
      }
      return c.json({ success: true })
    })
    .post("/set-role", async (c) => {
      if (!deps.isDev) return errorResponse(c, `forbidden`, { message: "Not allowed" })
      let body: unknown = null
      try {
        body = await readApiJson(c)
      } catch (_error) {
        body = null
      }
      const validation = validate(setRoleSchema, body)
      if (validation.error) {
        return validationResponse(c, validation.error.details)
      }
      const key = await findPasswordKey(deps, validation.data.login)
      if (!key) return errorResponse(c, `not_found`, { message: "No such user" })
      await deps.sql`
        UPDATE users SET role = ${validation.data.role}, updated_at = NOW() WHERE id = ${key.userId}
      `
      return c.json({ success: true })
    })
    .post("/close-sockets", async (c) => {
      const user = await readLogin(c, deps)
      if (user instanceof Response) return user
      const closed = user.userId === null ? 0 : deps.closeSockets(user.userId)
      return c.json({ success: true, closed })
    })
    .post("/last-mail", async (c) => {
      if (!deps.isDev) return errorResponse(c, `forbidden`, { message: "Not allowed" })
      let body: unknown = null
      try {
        body = await readApiJson(c)
      } catch (_error) {
        body = null
      }
      const validation = validate(authEmailSchema, body)
      if (validation.error) {
        return validationResponse(c, validation.error.details)
      }
      const email = normalizeEmail(validation.data.email) ?? validation.data.email
      const [mail] = await deps.sql<{ subject: string; textBody: string }[]>`
        SELECT subject, text_body FROM dev_mail WHERE to_address = ${email}
        ORDER BY id DESC LIMIT 1
      `
      if (!mail) return errorResponse(c, `not_found`, { message: "No mail for this address" })
      return c.json({ subject: mail.subject, text: mail.textBody })
    })
}

/** The password key of `login`, an address or an older account's username, normalised first. */
function findPasswordKey(deps: DevRouteDeps, login: string) {
  const subject = normalizeEmail(login) ?? normalizeUsername(login)
  return subject === null ? null : deps.db.authStore.findKey(PASSWORD_METHOD, subject)
}

/** The body of `POST /add-member`. Owner is left out: a group has one, and it is not moved here. */
const addMemberSchema = authLoginSchema.and({
  groupId: UUID_PATTERN,
  role: type.enumerated(GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN),
})

/** The body of `POST /set-role`. */
const setRoleSchema = authLoginSchema.and({
  role: type.enumerated(UserRole.VIEWER, UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN),
})

/**
 * Reads `{ login }` from the body and finds the user behind it (`null` when there is none), or
 * answers with the refusal: 403 outside development, 400 for a body that names no login.
 */
async function readLogin(
  c: Context<APIContext>,
  deps: DevRouteDeps,
): Promise<{ userId: number | null; email: string | null } | Response> {
  if (!deps.isDev) {
    return errorResponse(c, `forbidden`, { message: "Not allowed" })
  }
  let body: unknown = null
  try {
    body = await readApiJson(c)
  } catch (_error) {
    body = null
  }
  const validation = validate(authLoginSchema, body)
  if (validation.error) {
    return validationResponse(c, validation.error.details)
  }
  const key = await findPasswordKey(deps, validation.data.login)
  const email = normalizeEmail(validation.data.login)
  // An account a sign-in link made has no password key: its proven address finds it (#391).
  const userId = key?.userId ??
    (email === null ? null : await deps.db.authStore.findUserIdByProvenEmail(email))
  return { userId, email }
}

/** Deletes the user `userId` and every row that references them or a group they own. */
async function deleteUser(sql: Sql, userId: number): Promise<void> {
  await sql.begin(async (tx: Transaction) => {
    // A fresh fragment per statement: postgres.js runs a query object once.
    const owned = () =>
      tx`SELECT id FROM groups WHERE owner_user_id = ${userId} OR created_by_user_id = ${userId}`
    await tx`
      DELETE FROM notes
      WHERE created_by_user_id = ${userId} OR updated_by_user_id = ${userId}
        OR group_id IN (${owned()})
    `
    // Tags of the user's groups go with the groups (ON DELETE CASCADE), and with them their links;
    // tags the user wrote in other people's groups keep a null author. Nothing to delete by hand.
    await tx`DELETE FROM audit_events WHERE actor_user_id = ${userId} OR group_id IN (${owned()})`
    await tx`DELETE FROM outbox_events WHERE actor_user_id = ${userId} OR group_id IN (${owned()})`
    await tx`
      DELETE FROM group_members WHERE added_by_user_id = ${userId} OR group_id IN (${owned()})
    `
    await tx`DELETE FROM groups WHERE id IN (${owned()})`
    await tx`DELETE FROM auth_audits WHERE user_id = ${userId}`
    await tx`DELETE FROM user_push_tokens WHERE user_id = ${userId}`
    // Deleting the auth user also deletes its keys, sessions, profile row and TOTP enrolment.
    await tx`DELETE FROM auth_users WHERE id = ${userId}`
  })
}
