import { Query } from "@spy4x/platform/cqrs"
import {
  type Actor,
  type OnboardingStatus,
  User,
  type UserPushTokenPublic,
  type VersionedPreferences,
} from "@domain/identity"
export interface UserProfileGetPayload {
  actor: Actor
}

export interface UserProfileGetResult {
  user: User
}

export class UserProfileGetQuery implements Query<UserProfileGetPayload, UserProfileGetResult> {
  __resultType?: UserProfileGetResult
  constructor(public data: UserProfileGetPayload) {}
}

export interface OnboardingGetPayload {
  actor: Actor
}

/** What the person has done of the first steps, and whether they closed the list or the tour. */
export class OnboardingGetQuery implements Query<OnboardingGetPayload, OnboardingStatus> {
  __resultType?: OnboardingStatus
  constructor(public data: OnboardingGetPayload) {}
}

export interface PreferencesGetPayload {
  actor: Actor
}

/** The actor's display preferences and their version; version `0` with the defaults when none. */
export class PreferencesGetQuery implements Query<PreferencesGetPayload, VersionedPreferences> {
  __resultType?: VersionedPreferences
  constructor(public data: PreferencesGetPayload) {}
}

export interface PushListPayload {
  actor: Actor
}

export interface PushListResult {
  devices: UserPushTokenPublic[]
}

export class PushListQuery implements Query<PushListPayload, PushListResult> {
  __resultType?: PushListResult
  constructor(public data: PushListPayload) {}
}
