import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SignUpOutcome } from "../services/sign-up.ts"
import {
  API_URL,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
} from "../_testing/mutation-requests.ts"
import {
  createAuthRateLimits,
  SIGN_UP_CODE_MAILS_PER_ADDRESS,
  SIGN_UP_CODE_MAILS_PER_CLIENT,
} from "../middlewares/auth-rate-limits.ts"
import { EMAIL_CODE_REFUSED } from "./auth-answers.ts"
import { SIGN_UP_CODES_TOO_MANY, SIGN_UP_EXPIRED, SIGN_UP_REQUESTED } from "./auth-sign-up.ts"
import { apiError } from "../_testing/api-error.ts"
import {
  anonymousRoutes,
  buildApp,
  generousLimits,
  send,
  sessionRoutes,
  signUpBody,
  WAITING_UNTIL,
} from "../_testing/auth-routes.ts"

describe("auth routes sign up with an e-mail address", () => {
  const signUp = anonymousRoutes.find((route) => route.path === "/auth/password/sign-up")!
  const signInRoute = anonymousRoutes.find((route) => route.path === "/auth/password/check")!

  it("signs up with the address as normalizeEmail leaves it", async () => {
    const { app, logins } = buildApp(null)

    const response = await send(
      app,
      { ...signUp, body: { ...signUpBody, email: "  Ada@Example.COM " } },
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(200)
    expect(logins).toEqual(["ada@example.com"])
  })

  it("refuses a sign-up with a username instead of an address with 400, before sign-up runs", async () => {
    const { app, calls } = buildApp(null)

    const response = await send(
      app,
      { ...signUp, body: { ...signUpBody, email: "ada" } },
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it("hands sign-in the login as typed, so an older account's username still reaches it", async () => {
    const { app, logins } = buildApp(null)

    const response = await send(
      app,
      { ...signInRoute, body: { login: "Ada", password: "correct-horse" } },
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(200)
    expect(logins).toEqual(["Ada"])
  })
})

describe("auth routes prove the address before a sign-up creates anything (#142)", () => {
  const route = (path: string) => anonymousRoutes.find((candidate) => candidate.path === path)!
  const signUp = route("/auth/password/sign-up")
  const verify = route("/auth/password/sign-up/verify")
  const resend = route("/auth/password/sign-up/resend")

  it("answers a free and a taken address alike, with the same body and no session", async () => {
    const { app, calls } = buildApp(null)
    const answers = []
    for (const email of ["free@example.com", "taken@example.com"]) {
      const response = await send(
        app,
        { ...signUp, body: { ...signUpBody, email } },
        sameOriginWithoutCookieHeaders,
      )
      answers.push({ status: response.status, body: await response.text() })
    }

    expect(answers[0]).toEqual({ status: 200, body: JSON.stringify(SIGN_UP_REQUESTED) })
    expect(answers[1]).toEqual(answers[0])
    expect(calls).toEqual(["requestSignUp", "requestSignUp"])
  })

  it("refuses past one client's code budget for an address with one answer for every address", async () => {
    const { app, calls } = buildApp(null)
    const refusals = []
    for (const email of ["free@example.com", "taken@example.com"]) {
      const body = { ...signUpBody, email }
      for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
        await send(app, { ...signUp, body }, sameOriginWithoutCookieHeaders)
      }
      const refused = await send(app, { ...signUp, body }, sameOriginWithoutCookieHeaders)
      refusals.push({
        status: refused.status,
        retryAfter: refused.headers.get("retry-after"),
        // Only the request's own id may differ between the two addresses.
        body: { ...await apiError(refused), requestId: undefined },
      })
    }

    expect(refusals[0].status).toBe(429)
    expect(refusals[0].body).toMatchObject({
      code: "rate_limited",
      message: SIGN_UP_CODES_TOO_MANY,
    })
    expect(refusals[1]).toEqual(refusals[0])
    expect(calls).toEqual(Array(2 * SIGN_UP_CODE_MAILS_PER_CLIENT).fill("requestSignUp"))
  })

  /** The headers of an anonymous request from `ip`. */
  const from = (ip: string) => ({ ...sameOriginWithoutCookieHeaders, "x-real-ip": ip })

  it("leaves the address's owner a code after a stranger keeps signing the address up (#494)", async () => {
    const { app, calls } = buildApp(null)
    const stranger = []
    for (let attempt = 0; attempt <= SIGN_UP_CODE_MAILS_PER_ADDRESS; attempt++) {
      stranger.push((await send(app, signUp, from("192.0.2.1"))).status)
    }
    const owner = await send(app, signUp, from("198.51.100.7"))

    expect(stranger).toEqual([
      ...Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill(200),
      ...Array(SIGN_UP_CODE_MAILS_PER_ADDRESS + 1 - SIGN_UP_CODE_MAILS_PER_CLIENT).fill(429),
    ])
    expect(owner.status).toBe(200)
    expect(calls).toEqual(Array(SIGN_UP_CODE_MAILS_PER_CLIENT + 1).fill("requestSignUp"))
  })

  it("counts every /64 of one IPv6 /48 as one client (#176)", async () => {
    const { app } = buildApp(null)
    const statuses = []
    for (let attempt = 0; attempt <= SIGN_UP_CODE_MAILS_PER_CLIENT; attempt++) {
      // A different /64 each time, all inside 2001:db8:1::/48, as one tunnel broker's /48 gives.
      statuses.push((await send(app, signUp, from(`2001:db8:1:${attempt + 1}::1`))).status)
    }
    const nextNetwork = await send(app, signUp, from(`2001:db8:2::1`))

    expect(statuses).toEqual([...Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill(200), 429])
    expect(nextNetwork.status).toBe(200)
  })

  it("leaves the address's owner a code after a stranger signs it up from every /64 of one /48 (#176)", async () => {
    const { app, calls } = buildApp(null)
    const stranger = []
    // More /64s than the address's whole total, so per /64 the stranger would spend all of it.
    for (let network = 1; network <= SIGN_UP_CODE_MAILS_PER_ADDRESS + 1; network++) {
      stranger.push((await send(app, signUp, from(`2001:db8:1:${network.toString(16)}::1`))).status)
    }
    const owner = await send(app, signUp, from(`2001:db8:feed::7`))

    expect(stranger.filter((status) => status === 200)).toHaveLength(SIGN_UP_CODE_MAILS_PER_CLIENT)
    expect(owner.status).toBe(200)
    expect(calls).toEqual(Array(SIGN_UP_CODE_MAILS_PER_CLIENT + 1).fill("requestSignUp"))
  })

  it("caps sign-up codes to one address from many networks together", async () => {
    const { app, calls } = buildApp(null)
    const statuses = []
    for (let network = 1; statuses.length <= SIGN_UP_CODE_MAILS_PER_ADDRESS; network++) {
      for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
        statuses.push((await send(app, signUp, from(`192.0.2.${network}`))).status)
      }
    }
    const fresh = await send(app, signUp, from("198.51.100.7"))
    const otherAddress = await send(
      app,
      { ...signUp, body: { ...signUpBody, email: "bob@example.com" } },
      from("198.51.100.7"),
    )

    expect(statuses.slice(0, SIGN_UP_CODE_MAILS_PER_ADDRESS)).toEqual(
      Array(SIGN_UP_CODE_MAILS_PER_ADDRESS).fill(200),
    )
    expect(statuses.slice(SIGN_UP_CODE_MAILS_PER_ADDRESS)).not.toContain(200)
    expect(fresh.status).toBe(429)
    expect(otherAddress.status).toBe(200)
    expect(calls).toHaveLength(SIGN_UP_CODE_MAILS_PER_ADDRESS + 1)
  })

  it("leaves a signed-in account's own code budget whole after strangers sign its address up", async () => {
    const rateLimits = createAuthRateLimits(generousLimits)
    const anonymous = buildApp(null, { rateLimits })
    for (let network = 1; network <= 4; network++) {
      for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
        await send(anonymous.app, signUp, from(`192.0.2.${network}`))
      }
    }
    const signedIn = buildApp(undefined, { rateLimits })
    const sendCode = sessionRoutes.find((candidate) => candidate.path === "/auth/email/send")!
    const response = await send(signedIn.app, sendCode, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(signedIn.mailed).toEqual(["alice@example.com"])
  })

  it("signs in the account a right code created", async () => {
    const { app } = buildApp(null)
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveProperty("id")
  })

  it("tells the holder of the mailbox how the account that uses the address signs in", async () => {
    const { app } = buildApp(null, {
      signIn: {
        completeSignUp: () =>
          Promise.resolve({
            outcome: SignUpOutcome.AccountExists,
            email: "alice@example.com",
            account: { userId: 7, password: false, providers: ["google"] },
          }),
      },
    })
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accountExists: { email: "alice@example.com", password: false, providers: ["google"] },
    })
  })

  it("answers a wrong code with the e-mail code message", async () => {
    const { app } = buildApp(null, { succeed: false })
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_CODE_REFUSED)
  })

  it("answers 410 when no sign-up waits for a code", async () => {
    const { app } = buildApp(null, {
      signIn: { completeSignUp: () => Promise.resolve({ outcome: SignUpOutcome.Expired }) },
    })
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(410)
    expect((await apiError(response)).message).toBe(SIGN_UP_EXPIRED)
  })

  it("sends no new code when no sign-up waits", async () => {
    const { app, calls } = buildApp(null, {
      signIn: { waitingSignUp: () => Promise.resolve(null) },
    })
    const response = await send(app, resend, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(410)
    expect(calls).toEqual([])
  })

  it("spends the client's sign-up code budget for the waiting address on a new code", async () => {
    const { app, calls } = buildApp(null)
    const statuses = []
    for (let mail = 0; mail <= SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
      statuses.push((await send(app, resend, sameOriginWithoutCookieHeaders)).status)
    }

    expect(statuses).toEqual([...Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill(200), 429])
    expect(calls).toEqual(Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill("resendSignUpCode"))
  })

  it("shares one client's sign-up code budget between a sign-up and its new codes", async () => {
    const { app } = buildApp(null)
    for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
      await send(app, signUp, sameOriginWithoutCookieHeaders)
    }
    const response = await send(app, resend, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(429)
  })

  it("reads back the waiting sign-up's address for the page that asks for the code", async () => {
    const { app } = buildApp(null)
    const response = await app.request(`${API_URL}/auth/password/sign-up`)

    expect(await response.json()).toEqual({
      pending: { email: "alice@example.com", expiresAt: WAITING_UNTIL.toISOString() },
    })
  })
})
