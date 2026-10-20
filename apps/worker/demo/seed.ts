import { Hono } from "hono"
import type postgres from "postgres"
import { UserRole } from "@domain/identity"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { DEMO_USER_EMAIL, DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { PostgresInvitationRepository } from "@server/groups/postgres-invitation-repository.ts"
import { createListCrypto, type SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { AppDbBase } from "../../api/services/db-base.ts"
import { createSignIn } from "../../api/services/sign-in.ts"
import { type FakeDemoData, fakeDemoData, type FakeMember } from "./fake-data.ts"

/** Who the audit rows of the seeded roles name (#425). */
export const SEED_ACTOR = `seed`

/** What the demo seed needs besides the database. */
export interface DemoSeedOptions {
  /** The API's `AUTH_PEPPER`: part of every password hash, so the accounts can sign in. */
  pepper: string
  /** The password of the shared demo account, and of the development administrator. */
  password: string
  /** Also seeds {@link DEV_ADMIN_EMAIL}, an administrator: development only, never the demo. */
  operator: boolean
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
 * Creates the public demo's data: the shared account, with no second factor, and the fake
 * data of {@link fakeDemoData}. Every person is created through the API's own sign-up, so their
 * rows are what a real sign-up writes, and every address is marked proven. With `operator`, the
 * development administrator is created too.
 *
 * `false` when the demo user exists already: then only the accounts' roles and proven addresses
 * are put right, and nothing else is written, so a second run adds no second copy.
 *
 * @throws {SeedRefusedError} When sign-up refuses an account that does not exist.
 */
export async function seedDemo(
  db: AppDbBase,
  sql: postgres.Sql,
  options: DemoSeedOptions,
): Promise<boolean> {
  // Sign-up answers `null` for a taken address and for a refused one alike, so "exists already"
  // is decided here, not from its answer.
  if (await db.authStore.findKey(PASSWORD_METHOD, DEMO_USER_EMAIL)) {
    if (options.operator) await ensureAccount(db, DEV_ADMIN_EMAIL, options.password, options.pepper)
    await settleAccounts(db, options.operator)
    return false
  }
  const demoId = await signUp(db, options.pepper, DEMO_USER_EMAIL, options.password)
  await setName(sql, demoId, `Demo`, `User`)
  if (options.operator) {
    const adminId = await signUp(db, options.pepper, DEV_ADMIN_EMAIL, options.password)
    await setName(sql, adminId, `Dev`, `Operator`)
  }
  await settleAccounts(db, options.operator)

  const data = fakeDemoData(options.dataSeed)
  const userIds: number[] = []
  for (const user of data.users) {
    // A password nobody knows: the fake people never sign in.
    const id = await signUp(db, options.pepper, user.email, randomBase64Url(24))
    await prove(db, user.email)
    await setName(sql, id, user.firstName, user.lastName)
    userIds.push(id)
  }
  const idOf = (member: FakeMember) => member === `demo` ? demoId : userIds[member]
  const owned = await seedGroups(db, sql, data, idOf)
  // The demo user opens the busy group they own, not their empty first group.
  if (owned) await db.group.select(demoId, owned)
  if (options.subscribers) await seedSubscribers(sql, data, options.subscribers)
  return true
}

/** Creates `email` when it has no account yet. */
async function ensureAccount(
  db: AppDbBase,
  email: string,
  password: string,
  pepper: string,
): Promise<void> {
  if (!(await db.authStore.findKey(PASSWORD_METHOD, email))) {
    await signUp(db, pepper, email, password)
  }
}

/**
 * Proves the demo user's address (an unproven one cannot invite, #411) and keeps it a plain user.
 * With `operator`, proves the development administrator too and makes it an administrator.
 */
async function settleAccounts(db: AppDbBase, operator: boolean): Promise<void> {
  await prove(db, DEMO_USER_EMAIL)
  await db.admin.setRoleByAddress(DEMO_USER_EMAIL, UserRole.VIEWER, SEED_ACTOR)
  if (!operator) return
  await prove(db, DEV_ADMIN_EMAIL)
  await db.admin.setRoleByAddress(DEV_ADMIN_EMAIL, UserRole.ADMIN, SEED_ACTOR)
}

/**
 * Groups, their members, tags, notes and pending invitations. Answers the id of the group the
 * demo user owns, or `null` when there is none.
 */
async function seedGroups(
  db: AppDbBase,
  sql: postgres.Sql,
  data: FakeDemoData,
  idOf: (member: FakeMember) => number,
): Promise<string | null> {
  const invitations = new PostgresInvitationRepository(sql)
  let demoOwned: string | null = null
  for (const group of data.groups) {
    const ownerId = idOf(group.owner)
    const groupId = uuidV7()
    if (group.owner === `demo`) demoOwned = groupId
    await db.group.create({ id: groupId, name: group.name }, ownerId)
    for (const { member, role } of group.members) {
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${groupId}, ${idOf(member)}, ${role}, ${ownerId})
        ON CONFLICT DO NOTHING
      `
    }
    const tagIds = new Map<string, string>()
    for (const tag of group.tags) {
      const id = uuidV7()
      await db.tag.create({ id, groupId, name: tag.name, color: tag.color }, ownerId)
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
        ownerId,
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
        ownerId,
        { maxMembers: null, memberRoles: true },
      )
    }
  }
  return demoOwned
}

/** The newsletter list, keyed as the subscribe flow keys it. */
async function seedSubscribers(
  sql: postgres.Sql,
  data: FakeDemoData,
  setup: SubscribersSetup,
): Promise<void> {
  const crypto = await createListCrypto(setup, DEFAULT_SUBSCRIBER_LIST)
  const now = Date.now()
  for (const [index, email] of data.subscribers.entries()) {
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
