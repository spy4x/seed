import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { OnboardingMark, OnboardingStatus } from "@domain/identity"
import type { OnboardingMarkCommand } from "../../cqrs/commands.ts"
import { OnboardingMarkedEvent } from "../../cqrs/events.ts"
import type { OnboardingGetQuery } from "../../cqrs/queries.ts"

/**
 * What the onboarding handlers need from the app: `db.onboarding` of `AppDbBase`. The files under
 * `cqrs/` pass the real one; the tests pass a fake.
 */
export interface OnboardingHandlerDependencies {
  onboarding: {
    read(userId: number): Promise<OnboardingStatus | null>
    mark(userId: number, mark: OnboardingMark): Promise<void>
  }
}

/** Answers what the actor has done of the first steps, and what they closed. */
export function createOnboardingGetHandler(
  { onboarding }: OnboardingHandlerDependencies,
): QueryHandler<OnboardingGetQuery> {
  return async ({ data: { actor } }) => {
    const status = await onboarding.read(actor.userId)
    if (!status) throw new Error("User not found")
    return status
  }
}

/**
 * Records that the actor closed the checklist or ended the tour, and answers the state after it.
 * The event goes out after the write, so the person's other tabs read what was kept.
 */
export function createOnboardingMarkHandler(
  { onboarding, emit }: OnboardingHandlerDependencies & {
    emit(event: OnboardingMarkedEvent): void
  },
): CommandHandler<OnboardingMarkCommand> {
  return async ({ data: { actor, mark } }) => {
    await onboarding.mark(actor.userId, mark)
    const status = await onboarding.read(actor.userId)
    if (!status) throw new Error("User not found")
    emit(new OnboardingMarkedEvent({ userId: actor.userId }))
    return status
  }
}
