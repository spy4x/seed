import { Command } from "@spy4x/platform/cqrs"
import { RequestInfo } from "@spy4x/platform/request-info"
import {
  type Actor,
  type OnboardingMark,
  type OnboardingStatus,
  User,
  type UserPushTokenPublic,
} from "@domain/identity"
import type { PushSubscribeRequest } from "@spy4x/platform/model"
export interface UserProfileUpdatePayload {
  actor: Actor
  firstName: string
  lastName: string
  request: RequestInfo
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export interface UserProfileUpdateResult {
  user: User
}

export class UserProfileUpdateCommand
  implements Command<UserProfileUpdatePayload, UserProfileUpdateResult> {
  __resultType?: UserProfileUpdateResult
  constructor(public data: UserProfileUpdatePayload) {}
}

export interface OnboardingMarkPayload {
  actor: Actor
  /** Which of the two answers the person gave. */
  mark: OnboardingMark
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/** The person closed the first-steps checklist, or finished or skipped the tour. */
export class OnboardingMarkCommand implements Command<OnboardingMarkPayload, OnboardingStatus> {
  __resultType?: OnboardingStatus
  constructor(public data: OnboardingMarkPayload) {}
}

export interface PushRegisterPayload {
  actor: Actor
  deviceId: string
  subscription: PushSubscribeRequest["subscription"]
  request: RequestInfo
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export interface PushRegisterResult {
  userPushToken: UserPushTokenPublic
}

export class PushRegisterCommand implements Command<PushRegisterPayload, PushRegisterResult> {
  __resultType?: PushRegisterResult
  constructor(public data: PushRegisterPayload) {}
}

export interface PushRemovePayload {
  actor: Actor
  deviceId: string
  request: RequestInfo
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export interface PushRemoveResult {
  isSuccess: true
}

export class PushRemoveCommand implements Command<PushRemovePayload, PushRemoveResult> {
  __resultType?: PushRemoveResult
  constructor(public data: PushRemovePayload) {}
}
