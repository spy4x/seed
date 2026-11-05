import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SignInCodeOutcome } from "../services/sign-in-codes.ts"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { sameOriginWithoutCookieHeaders } from "../_testing/mutation-requests.ts"
import {
  SIGN_IN_CODE_MAILS_PER_ADDRESS,
  SIGN_IN_CODE_MAILS_PER_CLIENT,
} from "../middlewares/auth-rate-limits.ts"
import { MAILED_CODE_DEAD, MAILED_CODE_WRONG } from "./auth-answers.ts"
import {
  SIGN_IN_CODE_BAD_ADDRESS,
  SIGN_IN_CODE_REQUESTED,
  SIGN_IN_CODE_UNCONFIRMED,
} from "./auth-sign-in-codes.ts"
import { apiError } from "../_testing/api-error.ts"
import { anonymousRoutes, buildApp, send } from "../_testing/auth-routes.ts"

describe("auth routes sign in and sign up by e-mailed code (#391, #752)", () => {
  const request = anonymousRoutes.find((route) => route.path === "/auth/code")!
  const redeem = anonymousRoutes.find((route) => route.path === "/auth/code/verify")!
  const resend = anonymousRoutes.find((route) => route.path === "/auth/code/resend")!
  /** The headers of an anonymous request from `ip`. */
  const from = (ip: string) => ({ ...sameOriginWithoutCookieHeaders, "x-real-ip": ip })
  const askFor = (body: unknown, ip = "192.0.2.1") => ({ route: { ...request, body }, ip })

  it("answers the same for every address and asks for the code with the address normalised", async () => {
    const { app, codes } = buildApp(null)
    const answers = []
    for (const email of ["  Known@Example.com ", "nobody@example.com"]) {
      const { route, ip } = askFor({ email })
      const response = await send(app, route, from(ip))
      answers.push({ status: response.status, body: await response.json() })
    }

    expect(answers).toEqual([
      { status: 200, body: SIGN_IN_CODE_REQUESTED },
      { status: 200, body: SIGN_IN_CODE_REQUESTED },
    ])
    expect(codes.map((code) => code.email)).toEqual(["known@example.com", "nobody@example.com"])
  })

  it("keeps a page of the app as the code's next page and drops any other", async () => {
    const { app, codes } = buildApp(null)
    for (const next of ["/notes?tag=work", "//evil.example.com", "/api/auth/me"]) {
      const { route, ip } = askFor({ email: "alice@example.com", next })
      await send(app, route, from(ip))
    }

    expect(codes.map((code) => code.next)).toEqual(["/notes?tag=work", null, null])
  })

  it("refuses an address it cannot normalise, and queues nothing", async () => {
    const { app, codes } = buildApp(null)
    const { route, ip } = askFor({ email: "not an address" })
    const response = await send(app, route, from(ip))

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(SIGN_IN_CODE_BAD_ADDRESS)
    expect(codes).toEqual([])
  })

  it("leaves the address's owner a code after a stranger keeps asking for it", async () => {
    const { app, codes } = buildApp(null)
    const stranger = []
    for (let attempt = 0; attempt <= SIGN_IN_CODE_MAILS_PER_ADDRESS; attempt++) {
      const { route } = askFor({ email: "alice@example.com" })
      stranger.push((await send(app, route, from("192.0.2.1"))).status)
    }
    const owner = await send(
      app,
      askFor({ email: "alice@example.com" }).route,
      from("198.51.100.7"),
    )

    expect(stranger).toEqual([
      ...Array(SIGN_IN_CODE_MAILS_PER_CLIENT).fill(200),
      ...Array(SIGN_IN_CODE_MAILS_PER_ADDRESS + 1 - SIGN_IN_CODE_MAILS_PER_CLIENT).fill(429),
    ])
    expect(owner.status).toBe(200)
    expect(codes).toHaveLength(SIGN_IN_CODE_MAILS_PER_CLIENT + 1)
  })

  it("caps one address's codes from many networks together, and says how long to wait", async () => {
    const { app } = buildApp(null)
    const statuses = []
    for (let network = 1; statuses.length < SIGN_IN_CODE_MAILS_PER_ADDRESS; network++) {
      for (let mail = 0; mail < SIGN_IN_CODE_MAILS_PER_CLIENT; mail++) {
        const { route } = askFor({ email: "alice@example.com" })
        statuses.push((await send(app, route, from(`192.0.2.${network}`))).status)
      }
    }
    const refused = await send(
      app,
      askFor({ email: "alice@example.com" }).route,
      from("198.51.100.7"),
    )
    const otherAddress = await send(
      app,
      askFor({ email: "bob@example.com" }).route,
      from("198.51.100.7"),
    )

    expect(statuses.slice(0, SIGN_IN_CODE_MAILS_PER_ADDRESS)).not.toContain(429)
    expect(refused.status).toBe(429)
    expect(refused.headers.get("retry-after")).not.toBe(null)
    expect((await apiError(refused)).message).toMatch(
      /^Too many codes were asked for this address\. Try again in \d+ minutes?\.$/,
    )
    expect(otherAddress.status).toBe(200)
  })

  it("answers a wrong code with 400, and a dead request with one 410 refusal", async () => {
    const wrong = buildApp(null, { succeed: false })
    const dead = buildApp(null, {
      signIn: {
        completeSignInCode: () => Promise.resolve({ outcome: SignInCodeOutcome.Refused }),
      },
    })

    const wrongAnswer = await send(wrong.app, redeem, sameOriginWithoutCookieHeaders)
    const deadAnswer = await send(dead.app, redeem, sameOriginWithoutCookieHeaders)

    expect(wrongAnswer.status).toBe(400)
    expect((await apiError(wrongAnswer)).message).toBe(MAILED_CODE_WRONG)
    expect(deadAnswer.status).toBe(410)
    expect((await apiError(deadAnswer)).message).toBe(MAILED_CODE_DEAD)
  })

  it("spends the address's code budget on a new code too", async () => {
    const { app, calls } = buildApp(null)
    for (let mail = 0; mail < SIGN_IN_CODE_MAILS_PER_CLIENT; mail++) {
      await send(app, askFor({ email: "alice@example.com" }).route, from("192.0.2.1"))
    }

    const response = await send(app, resend, from("192.0.2.1"))

    expect(response.status).toBe(429)
    expect(calls).not.toContain("resendSignInCode")
  })

  it("answers a signed-in code with the address, the next page and whether a second factor is owed", async () => {
    const { app } = buildApp(null, { secondFactor: SecondFactorStatus.Pending })
    const response = await send(app, redeem, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      email: "alice@example.com",
      next: "/notes",
      created: false,
      secondFactorPending: true,
    })
  })

  it("says a new account was made, and sends a guest whose address is taken to the switch", async () => {
    const created = buildApp(null, {
      signIn: {
        completeSignInCode: async () => ({
          outcome: SignInCodeOutcome.Created,
          signedIn: buildAuthData(),
          email: "new@example.com",
          next: null,
        }),
      },
    })
    const taken = buildApp(null, {
      signIn: {
        completeSignInCode: () =>
          Promise.resolve({ outcome: SignInCodeOutcome.GuestTaken, next: null }),
      },
    })

    const made = await send(created.app, redeem, sameOriginWithoutCookieHeaders)
    const switched = await send(taken.app, redeem, sameOriginWithoutCookieHeaders)

    expect(await made.json()).toEqual({
      email: "new@example.com",
      next: null,
      created: true,
      secondFactorPending: false,
    })
    expect(await switched.json()).toEqual({ guestTaken: true })
  })

  it("tells the mailbox's holder that an unconfirmed account uses the address", async () => {
    const { app } = buildApp(null, {
      signIn: {
        completeSignInCode: () => Promise.resolve({ outcome: SignInCodeOutcome.Unconfirmed }),
      },
    })
    const response = await send(app, redeem, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(SIGN_IN_CODE_UNCONFIRMED)
  })
})
