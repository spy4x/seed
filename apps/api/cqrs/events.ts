import { Event } from "@spy4x/platform/cqrs"
import { RequestInfo } from "@spy4x/platform/request-info"
import { User, UserPushTokenPublic } from "@domain/identity"
export class UserSignedOutEvent implements Event<{ userId: number; request: RequestInfo }> {
  constructor(public data: { userId: number; request: RequestInfo }) {}
}

export class UserProfileUpdatedEvent implements Event<{ user: User; request: RequestInfo }> {
  constructor(public data: { user: User; request: RequestInfo }) {}
}

/** A person chose another group for `/notes`. Their other open tabs read the selection again. */
export class GroupSelectedEvent implements Event<{ userId: number; groupId: string }> {
  constructor(public data: { userId: number; groupId: string }) {}
}

/** A person saved their display preferences. Their other open tabs read them again. */
export class PreferencesUpdatedEvent implements Event<{ userId: number }> {
  constructor(public data: { userId: number }) {}
}

/** A group has a new owner, who is told by web push. */
export class GroupOwnershipTransferredEvent
  implements Event<{ groupId: string; groupName: string; newOwnerId: number }> {
  constructor(public data: { groupId: string; groupName: string; newOwnerId: number }) {}
}

/** A person closed the checklist or ended the tour. Their other open tabs read it again. */
export class OnboardingMarkedEvent implements Event<{ userId: number }> {
  constructor(public data: { userId: number }) {}
}

export class PushDevicesUpdatedEvent
  implements Event<{ userId: number; devices: UserPushTokenPublic[]; request: RequestInfo }> {
  constructor(
    public data: { userId: number; devices: UserPushTokenPublic[]; request: RequestInfo },
  ) {}
}
