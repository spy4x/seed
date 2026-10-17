/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { GroupInvitationCreateCommand, GroupRole, InvitationError } from "@domain/groups"
import { UserMFAStatus } from "@domain/identity"
import {
  invitationLookup,
  newInvitationToken,
  PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"
import { sha256Hex } from "@spy4x/platform/tokens"
import { hasProvenAddress, provenAddressOwner } from "@server/auth/email-verification.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { createInvitationCreateHandler } from "../../apps/api/features/groups/invitations.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { insertUser, withSchema } from "./group-team.ts"

/**
 * An account whose address is not proven cannot invite (#411), against a real Postgres built from
 * schema.sql. The case it closes: somebody signs up first with the owner's address and invites a
 * second account of theirs into the first group; the owner's password reset gives the account
 * back but would leave that member in the group. A link made before invitations needed a proven
 * address is revoked by that reset. Needs "DB_HOST", "DB_USER", "DB_PASS" and
 * "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const EMAIL = "owner@example.com"

/** The invitation create handler over the real store and the real address check, as the API wires it. */
function buildInvite(sql: postgres.Sql, db: AppDbBase) {
  const create = createInvitationCreateHandler({
    invitations: new PostgresInvitationRepository(sql),
    ownerOf: (email) => provenAddressOwner(db.authStore, email),
    addressProven: (userId) => hasProvenAddress(db.authStore, userId),
    planOf: () => Promise.resolve({ maxMembers: null, memberRoles: true }),
    seatPriced: () => Promise.resolve(false),
    mail: {
      sender: null,
      brand: { webAppUrl: "https://app.example.com" },
      byAddress: () => Promise.resolve({ allowed: true } as never),
      log: () => {},
    },
    emit: () => {},
  })
  return (userId: number, groupId: string, email: string | null) => {
    const command = new GroupInvitationCreateCommand({
      actor: {
        userId,
        userMfa: UserMFAStatus.NOT_CONFIGURED,
        sessionSecondFactor: SecondFactorStatus.NotRequired,
      },
      groupId,
      role: GroupRole.ADMIN,
      expiresInDays: 7,
      maxUses: 10,
      email,
      sendEmail: false,
      acceptSeatPrice: false,
    })
    command.allowance = null
    return create(command)
  }
}

async function refusalCode(write: Promise<unknown>): Promise<string> {
  const error = await write.then(() => null, (caught) => caught)
  if (error instanceof InvitationError) return error.code
  throw error ?? new Error("The invitation was not refused")
}

async function groupState(sql: postgres.Sql, groupId: string) {
  const [members] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM group_members WHERE group_id = ${groupId}
  `
  const [invitations] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM group_invitations
    WHERE group_id = ${groupId} AND revoked_at IS NULL AND expires_at > now()
  `
  return { members: members.count, invitations: invitations.count }
}

Deno.test("an account whose address is not proven cannot invite, its older links die at the reset that proves it, and it can invite after", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    const signIn = createSignIn({
      db,
      pepper: PEPPER,
      cookieSecret: COOKIE_SECRET,
      secureCookie: false,
      sessionMinutes: 60,
      totpIssuer: "example.test",
    })
    // Sign-up sets a cookie, so it runs inside a request.
    const groupId = uuidV7()
    let userId: number | null = null
    await new Hono<APIContext>().post("/", async (c) => {
      userId = (await signIn.signUp(c, EMAIL, "Squatter-0123", groupId))?.user.id ?? null
      return c.body(null, 204)
    }).request("/", { method: "POST" })
    if (userId === null) throw new Error("The sign-up was refused")
    const invite = buildInvite(sql, db)

    // Whoever signed up with the address tries to let a second account in, by link and by address.
    expect(await refusalCode(invite(userId, groupId, null))).toBe("ADDRESS_NOT_PROVEN")
    expect(await refusalCode(invite(userId, groupId, "second@example.com"))).toBe(
      "ADDRESS_NOT_PROVEN",
    )

    // A link made before invitations needed a proven address: written to the store directly.
    const invitations = new PostgresInvitationRepository(sql)
    const oldToken = newInvitationToken()
    const old = await invitations.create(
      {
        groupId,
        role: GroupRole.ADMIN,
        expiresInDays: 7,
        maxUses: 10,
        email: null,
        tokenHash: await sha256Hex(oldToken),
      },
      userId,
      { maxMembers: null, memberRoles: true },
    )
    expect(old).not.toBeNull()
    expect(await groupState(sql, groupId)).toEqual({ members: 1, invitations: 1 })

    // The owner takes the account back with a reset link mailed to the address.
    const issued = await issuePasswordReset(db.authStore, EMAIL)
    if (!issued) throw new Error("No reset was issued")
    expect(await signIn.resetPassword(issued.email, issued.code, "Owner-0123456")).toBe(true)

    expect(await groupState(sql, groupId)).toEqual({ members: 1, invitations: 0 })
    // The reset revoked the old link: the squatter's second account cannot join through it.
    const second = await insertUser(sql)
    const accepted = invitations.accept(
      await invitationLookup({ token: oldToken }),
      second,
      { maxMembers: null, memberRoles: true },
    )
    expect(await refusalCode(accepted)).toBe("INVITATION_REVOKED")
    expect(await groupState(sql, groupId)).toEqual({ members: 1, invitations: 0 })

    // The reset proved the address, so the owner invites as before.
    const created = await invite(userId, groupId, null)
    expect(created.invitation.groupId).toBe(groupId)
    await invite(userId, groupId, "friend@example.com")
    expect(await groupState(sql, groupId)).toEqual({ members: 1, invitations: 2 })
  })
})
