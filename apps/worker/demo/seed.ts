import { Hono } from "hono"
import type postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { PostgresInvitationRepository } from "@server/groups/postgres-invitation-repository.ts"
import { createListCrypto, type SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { AppDbBase } from "../../api/services/db-base.ts"
import { createSignIn } from "../../api/services/sign-in.ts"
import { fakeDemoData, type FakeGroup, type FakeMember, fakeWorkspace } from "./fake-data.ts"

/** Who the audit rows of the seeded roles name (#425). */
export const SEED_ACTOR = `seed`

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
  return fakeDemoData(dataSeed).users[0].email
}

/**
 * Creates the public demo's population, the fake data of {@link fakeDemoData}. Every person is
 * created through the API's own sign-up, so their rows are what a real sign-up writes, and every
 * address is marked proven. With `adminPassword`, the development administrator is created first,
 * or put right when it exists.
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
  if (options.adminPassword !== null) {
    await ensureAdmin(db, sql, options.pepper, options.adminPassword)
  }
  // Sign-up answers `null` for a taken address and for a refused one alike, so "exists already"
  // is decided here, not from its answer.
  if (await db.authStore.findKey(PASSWORD_METHOD, populationMarker(options.dataSeed))) return false

  const data = fakeDemoData(options.dataSeed)
  const userIds: number[] = []
  for (const user of data.users) {
    // A password nobody knows: the fake people never sign in.
    const id = await signUp(db, options.pepper, user.email, randomBase64Url(24))
    await prove(db, user.email)
    await setName(sql, id, user.firstName, user.lastName)
    userIds.push(id)
  }
  await seedGroups(db, sql, data.groups, (member) => member === `you` ? null : userIds[member])
  if (options.subscribers) await seedSubscribers(sql, data.subscribers, options.subscribers)
  return true
}

/**
 * Gives the new account `userId` its sample groups ({@link fakeWorkspace}) and opens the one it
 * owns, so its first screen is a busy group. The members are the population's fake people of
 * `dataSeed`, found by address: one without an account is left out, and a group whose owner has
 * none is skipped.
 *
 * Runs once per account: one that is in any group besides its first has its sample groups
 * already, or the part a failed try wrote, and gets nothing more. A fake person gets none.
 */
export async function seedWorkspace(
  db: AppDbBase,
  sql: postgres.Sql,
  userId: number,
  dataSeed: number,
): Promise<void> {
  const [{ groups }] = await sql<{ groups: number }[]>`
    SELECT COUNT(*)::int AS groups FROM group_members WHERE user_id = ${userId}
  `
  if (groups > 1) return
  const people = fakeDemoData(dataSeed).users.map((user) => user.email)
  const keys = await sql<{ userId: number; subject: string }[]>`
    SELECT user_id, subject FROM auth_keys
    WHERE method = ${PASSWORD_METHOD} AND subject IN ${sql(people)}
  `
  const ids = new Map(keys.map((key) => [key.subject, key.userId]))
  // The population signs up like anyone else, but a fake person gets no sample groups.
  if ([...ids.values()].includes(userId)) return
  const idOf = (member: FakeMember) => member === `you` ? userId : ids.get(people[member]) ?? null
  const owned = await seedGroups(db, sql, fakeWorkspace(dataSeed), idOf)
  if (owned) await db.group.select(userId, owned)
}

/** Creates {@link DEV_ADMIN_EMAIL} when it has no account yet, proves it and makes it an admin. */
async function ensureAdmin(
  db: AppDbBase,
  sql: postgres.Sql,
  pepper: string,
  password: string,
): Promise<void> {
  if (!(await db.authStore.findKey(PASSWORD_METHOD, DEV_ADMIN_EMAIL))) {
    const id = await signUp(db, pepper, DEV_ADMIN_EMAIL, password)
    await setName(sql, id, `Dev`, `Operator`)
  }
  await prove(db, DEV_ADMIN_EMAIL)
  await db.admin.setRoleByAddress(DEV_ADMIN_EMAIL, UserRole.ADMIN, SEED_ACTOR)
}

/**
 * Groups, their members, tags, notes and pending invitations. `idOf` answers `null` for someone
 * without an account: such a member is left out, and a group with such an owner is skipped.
 * Answers the id of the group `you` own, or `null` when there is none.
 *
 * The content of the group `you` own is written by its made-up admin, never by `you`: the
 * "Get started" checklist counts the notes and invitations a person made. Without that admin the
 * group stays empty.
 */
async function seedGroups(
  db: AppDbBase,
  sql: postgres.Sql,
  groups: readonly FakeGroup[],
  idOf: (member: FakeMember) => number | null,
): Promise<string | null> {
  const invitations = new PostgresInvitationRepository(sql)
  let yours: string | null = null
  for (const group of groups) {
    const ownerId = idOf(group.owner)
    if (ownerId === null) continue
    const groupId = uuidV7()
    if (group.owner === `you`) yours = groupId
    await db.group.create({ id: groupId, name: group.name }, ownerId)
    for (const { member, role } of group.members) {
      const memberId = idOf(member)
      if (memberId === null) continue
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${groupId}, ${memberId}, ${role}, ${ownerId})
        ON CONFLICT DO NOTHING
      `
    }
    const admin = group.members.find((m) => m.member !== `you` && m.role === GroupRole.ADMIN)
    const authorId = group.owner === `you` ? (admin ? idOf(admin.member) : null) : ownerId
    if (authorId === null) continue
    const tagIds = new Map<string, string>()
    for (const tag of group.tags) {
      const id = uuidV7()
      await db.tag.create({ id, groupId, name: tag.name, color: tag.color }, authorId)
      tagIds.set(tag.name, id)
    }
    for (const note of group.notes) {
      await db.note.create(
        {
          id: uuidV7(),
          groupId,
          title: note.title,
          body: note.body,
          tagIds: note.tags.map((name) => tagIds.get(name)!),
        },
        authorId,
        null,
      )
    }
    for (const invitation of group.invitations) {
      await invitations.create(
        {
          groupId,
          role: invitation.role,
          expiresInDays: 30,
          maxUses: invitation.email ? 1 : 10,
          email: invitation.email,
          // Nobody holds the token: the invitation only shows as pending.
          tokenHash: await sha256Hex(randomBase64Url(32)),
        },
        authorId,
        { maxMembers: null, memberRoles: true },
      )
    }
  }
  return yours
}

/** The newsletter list, keyed as the subscribe flow keys it. */
async function seedSubscribers(
  sql: postgres.Sql,
  subscribers: readonly string[],
  setup: SubscribersSetup,
): Promise<void> {
  const crypto = await createListCrypto(setup, DEFAULT_SUBSCRIBER_LIST)
  const now = Date.now()
  for (const [index, email] of subscribers.entries()) {
    // Spread over the last 60 days, so the admin's growth numbers show something.
    const at = new Date(now - index * 36 * 60 * 60_000)
    await sql`
      INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES (${DEFAULT_SUBSCRIBER_LIST}, ${email}, ${await crypto.subscriberKey(email)}, ${at})
      ON CONFLICT DO NOTHING
    `
  }
}

/**
 * Signs `email` up through the API's own sign-up and signs the new session out at once. Sign-up
 * sets a cookie, so it runs inside a request; Hono would answer a throw with a 500, so the error is
 * kept and rethrown here.
 */
async function signUp(
  db: AppDbBase,
  pepper: string,
  email: string,
  password: string,
): Promise<number> {
  const signIn = createSignIn({
    db,
    pepper,
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
async function prove(db: AppDbBase, email: string): Promise<void> {
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
