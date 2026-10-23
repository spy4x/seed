import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { GUEST_REFUSAL_CODE, type User } from "@domain/identity"
import { GroupRole } from "@domain/groups"
import { EMPTY_INVITATION_DRAFT } from "@ui/group-invitations.tsx"
import { createInvitationsStore, type InvitationFetch } from "./invitations.ts"
import { sessionState } from "./session.ts"
import { guestRefusal } from "./guest-refusal.ts"

const token = "A".repeat(43)

/** A fake API answering `routes["METHOD url"]` with a status and a JSON body; calls recorded. */
function harness(routes: Record<string, [number, unknown]>) {
  const calls: { method: string; url: string; body: unknown }[] = []
  /** The user each request named in `X-Realtime-User`, in order; `null` when it named nobody. */
  const pageUsers: (string | null)[] = []
  let offline = false
  const fetch: InvitationFetch = (url, init) => {
    const method = init?.method ?? "GET"
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    pageUsers.push(new Headers(init?.headers).get("x-realtime-user"))
    if (offline) return Promise.reject(new TypeError("Failed to fetch"))
    const [status, body] = routes[`${method} ${url}`] ?? [404, { error: { message: "No route" } }]
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }
  return {
    store: createInvitationsStore({ fetch, origin: () => "https://app.example.com" }),
    calls,
    pageUsers,
    goOffline: () => (offline = true),
  }
}

const row = {
  id: "i-1",
  role: GroupRole.EDITOR,
  email: null,
  maxUses: 1,
  uses: 0,
  expiresAt: "2026-10-09T10:00:00.000Z",
  createdBy: { userId: 1, name: "Ann" },
}

describe("invitations store", () => {
  it("creates from the draft and the price confirmation, shows the link once, clears both and reads the pending list again", async () => {
    const { store, calls } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [row] }],
      "POST /api/groups/g-1/invitations": [201, { invitation: row, token, mailSent: true }],
    })
    await store.open("g-1")
    store.draft.value = {
      ...EMPTY_INVITATION_DRAFT,
      email: " friend@example.com ",
      sendEmail: true,
    }
    store.acceptSeatPrice.value = true

    expect(await store.create()).toBe(true)

    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      role: GroupRole.EDITOR,
      expiresInDays: 7,
      maxUses: 1,
      email: "friend@example.com",
      sendEmail: true,
      acceptSeatPrice: true,
    })
    expect(store.created.value).toEqual({
      link: `https://app.example.com/invite/${token}`,
      mailAsked: true,
      mailSent: true,
    })
    expect(store.draft.value).toEqual(EMPTY_INVITATION_DRAFT)
    expect(store.acceptSeatPrice.value).toBe(false)
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(2)

    store.closeGroup()
    expect(store.created.value).toBeNull()
  })

  it("keeps the API's message and the plan's refusal when a create is refused", async () => {
    const plan = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxMembers",
      limit: 3,
      canUpgrade: true,
    }
    const { store } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [] }],
      "POST /api/groups/g-1/invitations": [402, {
        error: { code: "forbidden", message: "Full", reason: plan.code, details: plan },
      }],
    })
    await store.open("g-1")

    expect(await store.create()).toBe(false)

    expect(store.createError.value?.message).toBe("Full")
    expect(store.createError.value?.plan).toEqual(plan)
    expect(store.created.value).toBeNull()
  })

  it("hands a guest's refused invite to the frame's refusal dialog", async () => {
    const { store } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [] }],
      "POST /api/groups/g-1/invitations": [
        403,
        {
          error: {
            code: "forbidden",
            message: "Add a sign-in method first.",
            reason: GUEST_REFUSAL_CODE,
          },
        },
      ],
    })
    await store.open("g-1")
    try {
      expect(await store.create()).toBe(false)
      expect(guestRefusal.value).toBe("invite")
    } finally {
      guestRefusal.value = null
    }
  })

  it("posts the creator's price confirmation, keeps the refusal's code and forgets it when the page closes", async () => {
    const { store, calls } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [] }],
      "POST /api/groups/g-1/invitations": [400, {
        error: {
          code: "bad_request",
          message: "Confirm the price",
          reason: "SEAT_PRICE_NOT_ACCEPTED",
        },
      }],
    })
    await store.open("g-1")

    expect(await store.create()).toBe(false)
    expect(store.createError.value).toEqual({
      message: "Confirm the price",
      code: "SEAT_PRICE_NOT_ACCEPTED",
      plan: null,
    })

    store.acceptSeatPrice.value = true
    await store.create()
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body))
      .toMatchObject([{ acceptSeatPrice: false }, { acceptSeatPrice: true }])

    store.closeGroup()
    expect(store.acceptSeatPrice.value).toBe(false)
  })

  it("revokes one invitation and drops it from the list, or shows why under its row", async () => {
    const { store } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [row, { ...row, id: "i-2" }] }],
      "DELETE /api/groups/g-1/invitations/i-1": [200, { revoked: true }],
      "DELETE /api/groups/g-1/invitations/i-2": [403, {
        error: { code: "forbidden", message: "Only the owner", reason: "ROLE_INSUFFICIENT" },
      }],
    })
    await store.open("g-1")

    expect(await store.revoke("i-1")).toBe(true)
    expect(await store.revoke("i-2")).toBe(false)

    expect(store.invitations.value?.map((r) => r.id)).toEqual(["i-2"])
    expect(store.revokeError.value).toEqual({ invitationId: "i-2", message: "Only the owner" })
  })

  it("words a refusal of the shared guards in its own sentence, not in theirs", async () => {
    const { store } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [row] }],
      "DELETE /api/groups/g-1/invitations/i-1": [429, {
        error: { code: "rate_limited", message: "Too many requests" },
      }],
    })
    await store.open("g-1")

    expect(await store.revoke("i-1")).toBe(false)

    expect(store.revokeError.value).toEqual({
      invitationId: "i-1",
      message: "Something went wrong. Try again.",
    })
  })

  it("previews a link and says why it no longer works in the API's words", async () => {
    const { store, calls } = harness({
      "POST /api/invitations/preview": [410, {
        error: {
          code: "not_found",
          message: "This invitation has expired",
          reason: "INVITATION_EXPIRED",
        },
      }],
    })

    await store.loadPreview(token)

    expect(calls[0]).toEqual({ method: "POST", url: "/api/invitations/preview", body: { token } })
    expect(store.previewError.value).toBe("This invitation has expired")
    expect(store.preview.value).toBeNull()
  })

  it("accepts an invitation sent to the person by its id and drops it from their list", async () => {
    const mine = { id: "i-9", groupId: "g-2", groupName: "Team", inviterName: "Ann" }
    const { store, calls } = harness({
      "GET /api/invitations/mine": [200, { invitations: [mine] }],
      "POST /api/invitations/accept": [200, { groupId: "g-2", role: GroupRole.VIEWER }],
    })
    await store.loadMine()

    expect(await store.accept({ invitationId: "i-9" })).toEqual({
      groupId: "g-2",
      role: GroupRole.VIEWER,
    })

    expect(calls.at(-1)?.body).toEqual({ invitationId: "i-9" })
    expect(store.mine.value).toEqual([])
  })

  it("says the server is out of reach when an answer cannot be sent", async () => {
    const { store, goOffline } = harness({})
    goOffline()

    expect(await store.accept({ token })).toBeNull()

    expect(store.answerError.value).toMatchObject({ ref: token, message: /out of reach/ })
    expect(store.answering.value).toBeNull()
  })
})

describe("invitations store on a signed-in page", () => {
  afterEach(() => {
    sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
  })

  it("reads as the page's user, and is signed out when the read is refused with 401", async () => {
    sessionState.value = { ...sessionState.value, user: { id: 7 } as User, isMfaRequired: false }
    const { store, pageUsers } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [row] }],
      "GET /api/groups/g-2/invitations": [401, { error: { code: "unauthorized", message: "No" } }],
    })

    await store.open("g-1")
    const stillSignedIn = sessionState.value.user?.id
    await store.open("g-2")

    expect(pageUsers).toEqual(["7", "7"])
    expect([stillSignedIn, sessionState.value.user]).toEqual([7, null])
  })

  it("creates and revokes as the page's user, and is signed out when a write is refused with 401", async () => {
    sessionState.value = { ...sessionState.value, user: { id: 7 } as User, isMfaRequired: false }
    const { store, pageUsers, calls } = harness({
      "GET /api/groups/g-1/invitations": [200, { invitations: [row] }],
      "POST /api/groups/g-1/invitations": [201, { invitation: row, token, mailSent: false }],
      "DELETE /api/groups/g-1/invitations/i-1": [
        401,
        { error: { code: "unauthorized", message: "No" } },
      ],
    })
    await store.open("g-1")
    store.draft.value = { ...EMPTY_INVITATION_DRAFT }

    await store.create()
    const signedInAfterCreate = sessionState.value.user?.id
    await store.revoke("i-1")

    expect(calls.map((call) => call.method)).toContain("DELETE")
    expect(pageUsers).toEqual(calls.map(() => "7"))
    expect([signedInAfterCreate, sessionState.value.user]).toEqual([7, null])
  })
})
