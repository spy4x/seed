import type { Actor, OnboardingMark, OnboardingStatus } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { expectNoPayload } from "@spy4x/realtime"
import { OnboardingMarkCommand } from "../../cqrs/commands.ts"
import { OnboardingGetQuery } from "../../cqrs/queries.ts"

/** What the onboarding operations need from the app. */
export interface OnboardingOperationDependencies {
  get(query: OnboardingGetQuery): Promise<OnboardingStatus>
  mark(command: OnboardingMarkCommand): Promise<OnboardingStatus>
}

/**
 * `onboarding.get`, `onboarding.dismiss` and `onboarding.tour-seen`. None takes a payload, and a
 * call that sends one is refused: the person is always the session's, and each command says one
 * fixed thing.
 */
export function createOnboardingOperations(
  dependencies: OnboardingOperationDependencies,
): Operations<Actor> {
  const mark = (answer: OnboardingMark): Operations<Actor>[string] => ({
    kind: "command",
    handle: async ({ actor, payload, idempotencyKey }) => {
      expectNoPayload(payload)
      return await dependencies.mark(
        new OnboardingMarkCommand({ actor, mark: answer, idempotencyKey }),
      )
    },
  })
  return {
    "onboarding.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        expectNoPayload(payload)
        return await dependencies.get(new OnboardingGetQuery({ actor }))
      },
    },
    "onboarding.dismiss": mark("dismissed"),
    "onboarding.tour-seen": mark("tourSeen"),
  }
}
