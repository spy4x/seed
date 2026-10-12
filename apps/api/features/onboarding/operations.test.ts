import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type OnboardingMark, type OnboardingStatus, UserMFAStatus } from "@domain/identity"
import { OnboardingMarkCommand } from "../../cqrs/commands.ts"
import type { OnboardingMarkedEvent } from "../../cqrs/events.ts"
import { OnboardingGetQuery } from "../../cqrs/queries.ts"
import { createOnboardingGetHandler, createOnboardingMarkHandler } from "./handlers.ts"
import { createOnboardingOperations } from "./operations.ts"

const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}
const signal = new AbortController().signal
const status: OnboardingStatus = {
  steps: {
    emailVerified: true,
    noteCreated: false,
    memberInvited: false,
    notificationsOn: false,
    twoFactorOn: false,
  },
  dismissed: false,
  tourSeen: false,
}

function harness() {
  const seen: { mark: OnboardingMarkCommand | null; get: OnboardingGetQuery | null } = {
    mark: null,
    get: null,
  }
  const requests = createOnboardingOperations({
    get(query) {
      seen.get = query
      return Promise.resolve(status)
    },
    mark(command) {
      seen.mark = command
      return Promise.resolve(status)
    },
  })
  return { requests, seen }
}

/** `db.onboarding` in memory: one person, user 7. */
function memory() {
  const marks: OnboardingMark[] = []
  const log: string[] = []
  return {
    marks,
    log,
    onboarding: {
      read: (userId: number) =>
        Promise.resolve(
          userId === 7
            ? {
              ...status,
              dismissed: marks.includes("dismissed"),
              tourSeen: marks.includes("tourSeen"),
            }
            : null,
        ),
      mark: (_userId: number, mark: OnboardingMark) => {
        marks.push(mark)
        log.push(`write ${mark}`)
        return Promise.resolve()
      },
    },
  }
}

describe("onboarding operations", () => {
  it("declares get as a query, and dismiss and tour-seen as commands", () => {
    const { requests } = harness()

    expect(requests["onboarding.get"].kind).toBe("query")
    expect(requests["onboarding.dismiss"].kind).toBe("command")
    expect(requests["onboarding.tour-seen"].kind).toBe("command")
  })

  it("reads the onboarding of the actor", async () => {
    const { requests, seen } = harness()

    const result = await requests["onboarding.get"].handle({
      actor,
      requestId: "req-1",
      signal,
      payload: undefined,
    })

    expect(result).toEqual(status)
    expect(seen.get?.data).toEqual({ actor })
  })

  it("dispatches dismiss as the dismissed answer of the actor, with the call's idempotency key", async () => {
    const { requests, seen } = harness()

    await requests["onboarding.dismiss"].handle({
      actor,
      requestId: "req-2",
      signal,
      idempotencyKey: "key-1",
      payload: undefined,
    })

    expect(seen.mark?.data).toEqual({ actor, mark: "dismissed", idempotencyKey: "key-1" })
  })

  it("dispatches tour-seen as the tour answer of the actor", async () => {
    const { requests, seen } = harness()

    await requests["onboarding.tour-seen"].handle({
      actor,
      requestId: "req-3",
      signal,
      idempotencyKey: "key-2",
      payload: undefined,
    })

    expect(seen.mark?.data.mark).toBe("tourSeen")
  })

  it("refuses a payload on every operation as bad_request and dispatches nothing", async () => {
    for (const name of ["onboarding.get", "onboarding.dismiss", "onboarding.tour-seen"]) {
      const { requests, seen } = harness()

      const failure = await Promise.resolve(requests[name].handle({
        actor,
        requestId: "req-4",
        signal,
        idempotencyKey: "key-3",
        payload: { userId: 8 },
      })).catch((error) => error)

      expect(failure).toBeInstanceOf(RealtimeRequestError)
      expect((failure as RealtimeRequestError).code).toBe("bad_request")
      expect(seen).toEqual({ mark: null, get: null })
    }
  })
})

describe("onboarding handlers", () => {
  it("answers the actor's steps and what they closed", async () => {
    const { onboarding } = memory()

    const result = await createOnboardingGetHandler({ onboarding })(
      new OnboardingGetQuery({ actor }),
    )

    expect(result).toEqual(status)
  })

  it("fails for a person who is gone", async () => {
    const { onboarding } = memory()

    const failure = await createOnboardingGetHandler({ onboarding })(
      new OnboardingGetQuery({ actor: { ...actor, userId: 8 } }),
    ).catch((error) => error)

    expect(failure).toBeInstanceOf(Error)
  })

  it("keeps the answer, returns the state after it and tells the person's other tabs afterwards", async () => {
    const { onboarding, log } = memory()
    const handler = createOnboardingMarkHandler({
      onboarding,
      emit: (event: OnboardingMarkedEvent) => log.push(`hint ${event.data.userId}`),
    })

    const result = await handler(new OnboardingMarkCommand({ actor, mark: "dismissed" }))

    expect(result).toEqual({ ...status, dismissed: true })
    expect(log).toEqual(["write dismissed", "hint 7"])
  })
})
