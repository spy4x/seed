import { Hono } from "hono"
import type postgres from "postgres"
import { GROUP_FILE_EVENTS, GroupRole } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { createPasswordHasher, type PasswordHasher } from "@spy4x/server/sign-in"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { type AuditEventInput, writeAuditEvent } from "@server/groups/audit.ts"
import { PostgresInvitationRepository } from "@server/groups/postgres-invitation-repository.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { AppDbBase } from "../../api/services/db-base.ts"
import type { ServerFiles } from "@server/files/files.ts"
import { attachmentObjectKey } from "@domain/notes"
import { sampleFile } from "./sample-files.ts"
import { createSignIn } from "../../api/services/sign-in.ts"
import {
  fakeDemoData,
  type FakeGroup,
  type FakeMember,
  fakePeople,
  fakeWorkspace,
} from "./fake-data.ts"
import {
  type At,
  lastId,
  orderIdsByTime,
  writeBilling,
  writeDevelopmentBackup,
  writeNewsletter,
  writeOperator,
  writePeople,
} from "./history.ts"
import { seedSampleCatalog } from "@server/catalog/sample-catalog.ts"

/** Who the audit rows of the seeded roles name (#425). */
export const SEED_ACTOR = `development seed`

/** What the demo seed needs besides the database. */
export interface DemoSeedOptions {
  /** Part of every password hash; the API's `AUTH_PEPPER` when someone must sign in. */
  pepper: string
  /**
   * The password of {@link DEV_ADMIN_EMAIL}, an administrator: development only. `null` seeds no
   * administrator, as on the public demo.
   */
  adminPassword: string | null
  /** Picks the fake data; the same seed gives the same data. */
  dataSeed: number
  /** Signs the subscriber keys; `null` seeds no subscribers. */
  subscribers: SubscribersSetup | null
  /** The moment every time of the fake data counts back from; the current time by default. */
  now?: Date
}

/**
 * A hasher that hashes one random password, once, and gives that hash to every fake person: nobody
 * knows the password, and one hash instead of one per person keeps the seed fast.
 */
function oneUnknownPassword(pepper: string): PasswordHasher {
  const real = createPasswordHasher({ pepper })
  let hashed: Promise<string> | null = null
  return { ...real, hash: () => hashed ??= real.hash(randomBase64Url(24)) }
}

/** Raised when sign-up refuses an account the seed creates although no such account exists. */
export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `SeedRefusedError`
  }
}

/**
 * The address of the population's first fake person for `dataSeed`: once it has an account, the
 * population is seeded.
 */
export function populationMarker(dataSeed: number): string {
  return fakePeople(dataSeed)[0].email
}

/**
 * Creates the public demo's population, the fake data of {@link fakeDemoData}, with its history
 * counted back from `options.now`. Every person is created through the API's own sign-up, so their
 * rows are what a real sign-up writes, then moved to the day they joined. With `adminPassword`
 * (development), the administrator is created first, or put right when it exists, and the seed
 * adds what an operator did and a finished backup.
 *
 * `false` when the population exists already ({@link populationMarker}): then nothing else is
 * written, so a second run adds no second copy.
 *
 * @throws {SeedRefusedError} When sign-up refuses an account that does not exist.
 */
export async function seedDemo(
  db: AppDbBase,
  sql: postgres.Sql,
  options: DemoSeedOptions,
): Promise<boolean> {
  const now = options.now ?? new Date()
  const at: At = (ago) => new Date(now.getTime() - ago * 60_000)
  const firstAudit = await lastId(sql, `audit_events`)
  const firstSignInAudit = await lastId(sql, `auth_audits`)
  const admin = options.adminPassword === null
    ? null
    : await ensureAdmin(db, sql, options.pepper, options.adminPassword)
  // Sign-up answers `null` for a taken address and for a refused one alike, so "exists already"
  // is decided here, not from its answer.
  if (await db.authStore.findKey(PASSWORD_METHOD, populationMarker(options.dataSeed))) return false

  const data = fakeDemoData(options.dataSeed, now)
  const hasher = oneUnknownPassword(options.pepper)
  const userIds: number[] = []
  for (const user of data.users) {
    // A password nobody knows: the fake people never sign in.
    const id = await signUp(db, options.pepper, user.email, randomBase64Url(24), hasher)
    if (user.verified) await prove(db, user.email)
    await setName(sql, id, user.firstName, user.lastName)
    userIds.push(id)
  }
  await writePeople(sql, data.users, userIds, at, now)
  const groupIds = await seedGroups(
    db,
    sql,
    data.groups,
    (member) => member === `you` ? null : userIds[member],
    at,
    true,
  )
  const subscriptions = await writeBilling(sql, data, groupIds, at)
  if (options.subscribers) await writeNewsletter(sql, data, options.subscribers, at)
  // The shop's sample items, for a product that turns the catalog on (docs/catalog.md).
  await seedSampleCatalog(sql, at(0))
  if (admin) {
    await writeOperator(sql, admin.id, admin.created, data, userIds, subscriptions, at)
    await writeDevelopmentBackup(sql, at)
  }
  await orderIdsByTime(sql, `audit_events`, firstAudit)
  await orderIdsByTime(sql, `auth_audits`, firstSignInAudit)
  return true
}

/**
 * Gives the new account `userId` its sample groups ({@link fakeWorkspace}) and opens the one it
 * owns, so its first screen is a busy group whose activity goes back weeks. The members are the
 * population's fake people of `dataSeed`, found by address: one without an account is left out,
 * and a group whose owner has none is skipped.
 *
 * Runs once per account: one that is in any group besides its first has its sample groups
 * already, or the part a failed try wrote, and gets nothing more. A fake person gets none.
 */
export async function seedWorkspace(
  db: AppDbBase,
  sql: postgres.Sql,
  userId: number,
  dataSeed: number,
  now = new Date(),
  files: Pick<ServerFiles, "put"> | null = null,
): Promise<void> {
  const [{ groups }] = await sql<{ groups: number }[]>`
    SELECT COUNT(*)::int AS groups FROM group_members WHERE user_id = ${userId}
  `
  if (groups > 1) return
  const people = fakePeople(dataSeed).map((user) => user.email)
  const keys = await sql<{ userId: number; subject: string }[]>`
    SELECT user_id, subject FROM auth_keys
    WHERE method = ${PASSWORD_METHOD} AND subject IN ${sql(people)}
  `
  const ids = new Map(keys.map((key) => [key.subject, key.userId]))
  // The population signs up like anyone else, but a fake person gets no sample groups.
  if ([...ids.values()].includes(userId)) return
  const idOf = (member: FakeMember) => member === `you` ? userId : ids.get(people[member]) ?? null
  const at: At = (ago) => new Date(now.getTime() - ago * 60_000)
  const firstAudit = await lastId(sql, `audit_events`)
  const groupIds = await seedGroups(db, sql, fakeWorkspace(dataSeed), idOf, at, false, files)
  await orderIdsByTime(
    sql,
    `audit_events`,
    firstAudit,
    groupIds.filter((id): id is string => id !== null),
  )
  const owned = fakeWorkspace(dataSeed).findIndex((group) => group.owner === `you`)
  const ownedId = groupIds[owned]
  if (ownedId) await db.group.select(userId, ownedId)
}

/** Creates {@link DEV_ADMIN_EMAIL} when it has no account yet, proves it and makes it an admin. */
async function ensureAdmin(
  db: AppDbBase,
  sql: postgres.Sql,
  pepper: string,
  password: string,
): Promise<{ id: number; created: boolean }> {
  const key = await db.authStore.findKey(PASSWORD_METHOD, DEV_ADMIN_EMAIL)
  if (!key) return { id: await createAdmin(db, sql, pepper, password), created: true }
  await prove(db, DEV_ADMIN_EMAIL)
  await db.admin.setRoleByAddress(DEV_ADMIN_EMAIL, UserRole.ADMIN, SEED_ACTOR)
  return { id: key.userId, created: false }
}

/**
 * Signs {@link DEV_ADMIN_EMAIL} up, names, proves and makes it an admin. Answers its user id. The
 * public demo's reset calls it right after the wipe: an account that holds the address already was
 * made by a visitor in between, so it is refused, never promoted.
 *
 * @throws {SeedRefusedError} When the address has an account already.
 */
export async function createAdmin(
  db: AppDbBase,
  sql: postgres.Sql,
  pepper: string,
  password: string,
): Promise<number> {
  const id = await signUp(db, pepper, DEV_ADMIN_EMAIL, password)
  await setName(sql, id, `Emma`, `Walsh`)
  await prove(db, DEV_ADMIN_EMAIL)
  await db.admin.setRoleByAddress(DEV_ADMIN_EMAIL, UserRole.ADMIN, SEED_ACTOR)
  return id
}

/**
 * Groups, their members, tags, notes, promotions and pending invitations, each at its time. `idOf`
 * answers `null` for someone without an account: such a member is left out, a row they wrote goes
 * to the group's first writer, and a group with such an owner is skipped. Answers each group's id,
 * or `null` for a skipped one.
 *
 * Every row is written by the app's own repositories, then given its time, with its audit row.
 * With `backdateGroups`, the group itself moves to its creation time too. A new account's sample
 * groups keep theirs: the starter-data job puts the welcome note in the account's oldest group.
 *
 * The content of the group `you` own is written by its made-up members, never by `you`: the
 * "Get started" checklist counts the notes and invitations a person made.
 */
async function seedGroups(
  db: AppDbBase,
  sql: postgres.Sql,
  groups: readonly FakeGroup[],
  idOf: (member: FakeMember) => number | null,
  at: At,
  backdateGroups: boolean,
  files: Pick<ServerFiles, "put"> | null = null,
): Promise<(string | null)[]> {
  const invitations = new PostgresInvitationRepository(sql)
  const ids: (string | null)[] = []
  for (const group of groups) {
    const ownerId = idOf(group.owner)
    if (ownerId === null) {
      ids.push(null)
      continue
    }
    const groupId = uuidV7()
    ids.push(groupId)
    const created = at(group.createdAgo)
    await db.group.create({ id: groupId, name: group.name }, ownerId)
    await sql`
      UPDATE audit_events SET created_at = ${created}
      WHERE group_id = ${groupId} AND event_kind = ${GROUP_CREATED}
    `
    // An imported group's log starts with the import, as a real one does.
    if (group.imported) {
      const items = { notes: group.notes.length, tags: group.tags.length }
      await sql`UPDATE groups SET imported_at = ${created} WHERE id = ${groupId}`
      await sql`
        UPDATE audit_events SET event_kind = ${GROUP_FILE_EVENTS.imported},
          details = ${sql.json({ ...items, count: items.notes + items.tags })}
        WHERE group_id = ${groupId} AND event_kind = ${GROUP_CREATED}
      `
    }
    if (backdateGroups) {
      await sql`
        UPDATE groups SET created_at = ${created}, updated_at = ${created} WHERE id = ${groupId}
      `
      await sql`UPDATE group_members SET created_at = ${created} WHERE group_id = ${groupId}`
    }
    for (const { member, role, joinedAgo } of group.members) {
      const memberId = idOf(member)
      if (memberId === null) continue
      const joined = at(joinedAgo)
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id, created_at, updated_at)
        VALUES (${groupId}, ${memberId}, ${role}, ${ownerId}, ${joined}, ${joined})
        ON CONFLICT DO NOTHING
      `
      // The new account joins now, by the sample data itself, so its log says nothing about it.
      if (member !== `you`) {
        await writeAuditAt(sql, joined, {
          eventKind: MEMBER_JOINED,
          actorId: memberId,
          groupId,
          details: { role },
        })
      }
    }
    for (const { member, ago } of group.promotions) {
      const memberId = idOf(member)
      if (memberId === null) continue
      await writeAuditAt(sql, at(ago), {
        eventKind: MEMBER_ROLE_CHANGED,
        actorId: ownerId,
        groupId,
        targetUserId: memberId,
        details: { from: GroupRole.EDITOR, to: GroupRole.ADMIN },
      })
    }
    const fallback = [group.owner, ...group.members.map((m) => m.member)]
      .filter((member) => member !== `you`)
      .map(idOf)
      .find((id) => id !== null) ?? null
    if (fallback === null) continue
    const writer = (member: FakeMember) => idOf(member) ?? fallback
    const tagIds = new Map<string, string>()
    for (const tag of group.tags) {
      const id = uuidV7()
      const when = at(tag.createdAgo)
      await db.tag.create({ id, groupId, name: tag.name, color: tag.color }, writer(tag.author))
      await sql`UPDATE tags SET created_at = ${when}, updated_at = ${when} WHERE id = ${id}`
      await dateAudit(sql, id, when)
      tagIds.set(tag.name, id)
    }
    for (const note of group.notes) {
      const id = uuidV7()
      const when = at(note.createdAgo)
      const author = writer(note.author)
      await db.note.create(
        {
          id,
          groupId,
          title: note.title,
          body: note.body,
          tagIds: note.tags.map((name) => tagIds.get(name)!),
        },
        author,
        null,
      )
      await sql`
        UPDATE notes SET created_at = ${when},
          updated_at = ${note.edit ? at(note.edit.ago) : when},
          updated_by_user_id = ${note.edit ? writer(note.edit.by) : author}
        WHERE id = ${id}
      `
      // A note's sample files: stored, then added as its author confirmed them.
      for (const file of files ? note.files ?? [] : []) {
        const fileId = uuidV7()
        const key = attachmentObjectKey(fileId)
        const sample = sampleFile(file.kind, note.title)
        await files!.put(key, sample.bytes)
        await db.attachment.add(
          groupId,
          {
            id: fileId,
            noteId: id,
            userId: author,
            stagingKey: key,
            name: file.name,
            contentType: sample.contentType,
            size: sample.bytes.length,
          },
          key,
          { maxFiles: null, maxBytes: null, maxPerNote: Infinity },
          author,
        )
        await sql`UPDATE note_attachments SET created_at = ${when} WHERE id = ${fileId}`
      }
      await dateAudit(sql, id, when)
    }
    for (const invitation of group.invitations) {
      const made = await invitations.create(
        {
          groupId,
          role: invitation.role,
          expiresInDays: 30,
          maxUses: invitation.email ? 1 : 10,
          email: invitation.email,
          // Nobody holds the token: the invitation only shows as pending.
          tokenHash: await sha256Hex(randomBase64Url(32)),
        },
        writer(invitation.author),
        { maxMembers: null, memberRoles: true },
      )
      if (!made) continue
      const when = at(invitation.createdAgo)
      await sql`UPDATE group_invitations SET created_at = ${when} WHERE id = ${made.invitation.id}`
      await dateAudit(sql, made.invitation.id, when)
    }
  }
  return ids
}

/** The audit kinds the seed writes or dates itself, as the group repositories name them. */
const GROUP_CREATED = `group.created`
const MEMBER_JOINED = `group.invitation_accepted`
const MEMBER_ROLE_CHANGED = `group.member_role_changed`

/** Moves the audit rows about `entityId` to `when`, after the code that wrote them dated them now. */
async function dateAudit(sql: postgres.Sql, entityId: string, when: Date): Promise<void> {
  await sql`UPDATE audit_events SET created_at = ${when} WHERE entity_id = ${entityId}`
}

/** One group audit row, written as the group repositories write it, at `when`. */
async function writeAuditAt(sql: postgres.Sql, when: Date, event: AuditEventInput): Promise<void> {
  await writeAuditEvent(sql, event)
  await sql`
    UPDATE audit_events SET created_at = ${when}
    WHERE id = (SELECT max(id) FROM audit_events WHERE group_id = ${event.groupId})
  `
}

/**
 * Signs `email` up through the API's own sign-up and signs the new session out at once. Sign-up
 * sets a cookie, so it runs inside a request; Hono would answer a throw with a 500, so the error is
 * kept and rethrown here.
 */
export async function signUp(
  db: AppDbBase,
  pepper: string,
  email: string,
  password: string,
  hasher?: PasswordHasher,
): Promise<number> {
  const signIn = createSignIn({
    db,
    pepper,
    hasher,
    // The session cookie never leaves this process, so any secret signs it.
    cookieSecret: crypto.randomUUID() + crypto.randomUUID(),
    secureCookie: false,
    sessionMinutes: 1,
    totpIssuer: `seed`,
  })
  let userId: number | null = null
  let failure: unknown = null
  const app = new Hono().post(`/`, async (c) => {
    try {
      userId = (await signIn.signUp(c, email, password))?.user.id ?? null
    } catch (error) {
      failure = error
    }
    return c.body(null, 204)
  })
  await app.request(`/`, { method: `POST` })
  if (failure) throw failure
  if (userId === null) throw new SeedRefusedError(`sign-up refused to create the user "${email}"`)
  await db.sessionStore.signOutUser(userId, null)
  return userId
}

/** Marks `email` proven, as a finished sign-up leaves it. Does nothing when it is proven. */
export async function prove(db: AppDbBase, email: string): Promise<void> {
  const key = await db.authStore.findKey(PASSWORD_METHOD, email)
  if (key && key.provenAt === null) await db.authStore.proveKey(key.id, new Date())
}

async function setName(
  sql: postgres.Sql,
  userId: number,
  firstName: string,
  lastName: string,
): Promise<void> {
  await sql`UPDATE users SET first_name = ${firstName}, last_name = ${lastName} WHERE id = ${userId}`
}
