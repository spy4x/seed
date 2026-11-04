import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { EmailChangeOutcome, EmailVerifyOutcome } from "../services/email-change.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { sameOriginHeaders, sameOriginWithoutCookieHeaders } from "../_testing/mutation-requests.ts"
import {
  createAuthRateLimits,
  EMAIL_CHANGE_MAILS_PER_ACCOUNT,
  EMAIL_CHANGE_MAILS_PER_ADDRESS,
  EMAIL_CODE_MAILS_PER_ADDRESS,
} from "../middlewares/auth-rate-limits.ts"
import { EMAIL_CODE_REFUSED, PROVIDER_PROOF_REQUIRED } from "./auth-answers.ts"
import {
  EMAIL_ALREADY_CARRIED,
  EMAIL_CHANGE_TOO_MANY,
  EMAIL_NOTHING_TO_VERIFY,
  EMAIL_TAKEN,
} from "./auth-email-change.ts"
import { apiError } from "../_testing/api-error.ts"
import {
  brokenStore,
  buildApp,
  generousLimits,
  memoryStore,
  PROVEN,
  send,
  sessionRoutes,
} from "../_testing/auth-routes.ts"

describe("auth routes prove an e-mail address with a code", () => {
  const route = (path: string) => sessionRoutes.find((candidate) => candidate.path === path)!
  const verify = route("/auth/email/verify")
  const sendCode = route("/auth/email/send")
  const change = route("/auth/email/change")

  it("counts a code check before running it and gives the slot back when the code is right", async () => {
    const { app, codeFailureCalls } = buildApp()
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(codeFailureCalls).toEqual(["begin", "refund"])
  })

  it("answers a wrong or expired code with one message and records the failure", async () => {
    const { app, codeFailureCalls } = buildApp(undefined, { succeed: false })
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_CODE_REFUSED)
    expect(codeFailureCalls).toEqual(["begin", "fail"])
  })

  it("answers 429 with Retry-After while the user is locked, without checking the code", async () => {
    const { app, calls, codeFailureCalls } = buildApp(undefined, { codeLockedForMs: 60_200 })
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("61")
    expect(codeFailureCalls).toEqual(["begin"])
    expect(calls).toEqual([])
  })

  it("answers 409 when a right code proves an address another account owns", async () => {
    const { app, codeFailureCalls } = buildApp(undefined, {
      signIn: { verifyEmail: () => Promise.resolve(EmailVerifyOutcome.Taken) },
    })
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(EMAIL_TAKEN)
    expect(codeFailureCalls).toEqual(["begin", "refund"])
  })

  it("queues a new code for the unproven address", async () => {
    const { app, mailed } = buildApp()
    const response = await send(app, sendCode, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(mailed).toEqual(["alice@example.com"])
  })

  it("queues a new code for the address waiting to replace a proven one", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { emailStatus: () => Promise.resolve({ ...PROVEN, pending: "new@example.com" }) },
    })
    await send(app, sendCode, sameOriginHeaders)

    expect(mailed).toEqual(["new@example.com"])
  })

  it("queues no code when the address is proven and no change waits", async () => {
    const { app, mailed } = buildApp(undefined, { succeed: false })
    const response = await send(app, sendCode, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_NOTHING_TO_VERIFY)
    expect(mailed).toEqual([])
  })

  it(`answers code mail ${EMAIL_CODE_MAILS_PER_ADDRESS + 1} to one address in an hour with 429`, async () => {
    const { app, mailed } = buildApp()
    const statuses = []
    for (let attempt = 0; attempt <= EMAIL_CODE_MAILS_PER_ADDRESS; attempt++) {
      statuses.push((await send(app, sendCode, sameOriginHeaders)).status)
    }

    expect(statuses).toEqual([...Array(EMAIL_CODE_MAILS_PER_ADDRESS).fill(200), 429])
    expect(mailed).toHaveLength(EMAIL_CODE_MAILS_PER_ADDRESS)
  })

  it(`answers address change ${EMAIL_CHANGE_MAILS_PER_ACCOUNT + 1} from one account to one address in an hour with 429`, async () => {
    const { app, mailed } = buildApp()
    const statuses = []
    for (let attempt = 0; attempt <= EMAIL_CHANGE_MAILS_PER_ACCOUNT; attempt++) {
      statuses.push((await send(app, change, sameOriginHeaders)).status)
    }
    const refused = await send(app, change, sameOriginHeaders)

    expect(statuses).toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ACCOUNT).fill(200), 429])
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/)
    expect(mailed).toHaveLength(EMAIL_CHANGE_MAILS_PER_ACCOUNT)
  })

  it(`leaves the owner a code and a reset code after ${EMAIL_CHANGE_MAILS_PER_ACCOUNT} requests from another account to move to their address`, async () => {
    // One set of limits, as one API process holds; the stranger is user 2, the owner user 1.
    const rateLimits = createAuthRateLimits(generousLimits)
    const owned = "alice@example.com"
    const stranger = buildApp(buildAuthData({ user: { id: 2 } }), {
      rateLimits,
      signIn: { emailStatus: () => Promise.resolve({ ...PROVEN, pending: owned }) },
    })
    const toOwned = { ...change, body: { email: owned, password: "correct-horse" } }
    const strangerStatuses = []
    for (let attempt = 0; attempt < EMAIL_CHANGE_MAILS_PER_ACCOUNT; attempt++) {
      strangerStatuses.push((await send(stranger.app, toOwned, sameOriginHeaders)).status)
    }
    // A resend of the stranger's pending change spends the stranger's budget too.
    const resend = await send(stranger.app, sendCode, sameOriginHeaders)
    strangerStatuses.push(resend.status)
    const owner = buildApp(undefined, { rateLimits })
    const anonymous = buildApp(null, { rateLimits })

    const code = await send(owner.app, sendCode, sameOriginHeaders)
    const reset = await send(
      anonymous.app,
      { method: "POST", path: "/auth/password/forgot", body: { email: owned } },
      sameOriginWithoutCookieHeaders,
    )

    expect(reset.status).toBe(200)
    expect(anonymous.queued).toEqual([owned])
    expect(code.status).toBe(200)
    expect(owner.mailed).toEqual([owned])
    expect(strangerStatuses).toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ACCOUNT).fill(200), 429])
    // The same words as a refused change, so a refusal tells nothing about who owns the address.
    expect((await apiError(resend)).message).toBe(EMAIL_CHANGE_TOO_MANY)
  })

  it(`answers change mail ${EMAIL_CHANGE_MAILS_PER_ADDRESS + 1} to one address from as many accounts with 429, and leaves the owner a code and a reset code`, async () => {
    const rateLimits = createAuthRateLimits(generousLimits)
    const owned = "alice@example.com"
    const toOwned = { ...change, body: { email: owned, password: "correct-horse" } }
    const responses = []
    let strangerMails = 0
    // Users 2, 3, … each ask once, so no account's own budget is near its end.
    for (let attempt = 0; attempt <= EMAIL_CHANGE_MAILS_PER_ADDRESS; attempt++) {
      const stranger = buildApp(buildAuthData({ user: { id: attempt + 2 } }), { rateLimits })
      responses.push(await send(stranger.app, toOwned, sameOriginHeaders))
      strangerMails += stranger.mailed.length
    }
    const owner = buildApp(undefined, { rateLimits })
    const anonymous = buildApp(null, { rateLimits })

    const code = await send(owner.app, sendCode, sameOriginHeaders)
    const reset = await send(
      anonymous.app,
      { method: "POST", path: "/auth/password/forgot", body: { email: owned } },
      sameOriginWithoutCookieHeaders,
    )

    expect(responses.map((response) => response.status))
      .toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ADDRESS).fill(200), 429])
    expect(await apiError(responses.at(-1)!)).toMatchObject({ message: EMAIL_CHANGE_TOO_MANY })
    expect(strangerMails).toBe(EMAIL_CHANGE_MAILS_PER_ADDRESS)
    expect(code.status).toBe(200)
    expect(owner.mailed).toEqual([owned])
    expect(reset.status).toBe(200)
    expect(anonymous.queued).toEqual([owned])
  })

  it("gives each account its own change budget, whatever the addresses", async () => {
    const rateLimits = createAuthRateLimits(generousLimits)
    const changeTo = (email: string) => ({
      ...change,
      body: { email, password: "correct-horse" },
    })
    const first = buildApp(buildAuthData({ user: { id: 2 } }), { rateLimits })
    const second = buildApp(buildAuthData({ user: { id: 3 } }), { rateLimits })
    const firstStatuses = []
    // A new address each time, so only the account's budget runs out.
    for (let attempt = 0; attempt <= EMAIL_CHANGE_MAILS_PER_ACCOUNT; attempt++) {
      const email = `first-${attempt}@example.com`
      firstStatuses.push((await send(first.app, changeTo(email), sameOriginHeaders)).status)
    }

    const other = await send(second.app, changeTo("second@example.com"), sameOriginHeaders)

    expect(firstStatuses).toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ACCOUNT).fill(200), 429])
    expect(other.status).toBe(200)
    expect(second.mailed).toEqual(["second@example.com"])
  })

  for (const broken of ["ratelimit-email-change", "ratelimit-email-change-address"]) {
    it(`refuses an address change and a pending resend without mailing while ${broken} is down`, async () => {
      const { app, mailed } = buildApp(undefined, {
        rateLimits: createAuthRateLimits({
          ...generousLimits,
          store: (name) => name === broken ? brokenStore() : memoryStore(),
        }),
        signIn: { emailStatus: () => Promise.resolve({ ...PROVEN, pending: "new@example.com" }) },
      })

      const changed = await send(app, change, sameOriginHeaders)
      const resent = await send(app, sendCode, sameOriginHeaders)

      expect(changed.status).toBe(500)
      expect(resent.status).toBe(500)
      expect(mailed).toEqual([])
    })
  }

  it("queues a code for the new address as normalizeEmail leaves it", async () => {
    const { app, mailed } = buildApp()
    const response = await send(
      app,
      { ...change, body: { email: " New@Example.COM ", password: "correct-horse" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(200)
    expect(mailed).toEqual(["new@example.com"])
  })

  it("queues nothing when the password for an address change is wrong", async () => {
    const { app, mailed } = buildApp(undefined, { succeed: false })
    const response = await send(app, change, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(mailed).toEqual([])
  })

  it("queues nothing when the new address is the one the account has", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { requestEmailChange: () => Promise.resolve(EmailChangeOutcome.Kept) },
    })
    const response = await send(app, change, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(mailed).toEqual([])
  })

  it("queues nothing when an account with no password has no recent provider sign-in", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { requestEmailChange: () => Promise.resolve(EmailChangeOutcome.ProofRequired) },
    })
    const response = await send(
      app,
      { ...change, body: { email: "new@example.com" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(PROVIDER_PROOF_REQUIRED)
    expect(mailed).toEqual([])
  })

  it("refuses, and queues nothing, when another sign-in method of the account carries the address", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { requestEmailChange: () => Promise.resolve(EmailChangeOutcome.AlreadyCarried) },
    })
    const response = await send(
      app,
      { ...change, body: { email: "new@example.com" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_ALREADY_CARRIED)
    expect(mailed).toEqual([])
  })

  it("announces a sign-out once a code proved a new address, so the other devices' sockets close", async () => {
    const { app, emitted } = buildApp()
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(emitted.map((event) => event.data.userId)).toEqual([buildAuthData().user.id])
  })

  it("announces no sign-out for a wrong code", async () => {
    const { app, emitted } = buildApp(undefined, { succeed: false })
    await send(app, verify, sameOriginHeaders)

    expect(emitted).toEqual([])
  })
})
