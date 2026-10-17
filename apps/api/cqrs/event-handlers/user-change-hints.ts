import type {
  GroupSelectedEvent,
  OnboardingMarkedEvent,
  PreferencesUpdatedEvent,
  PushDevicesUpdatedEvent,
  UserProfileUpdatedEvent,
} from "../events.ts"

/** Tells the person's other open tabs that their profile changed, so they read it again. */
export function createProfileHintListener(notifyUserChange: (userId: number) => unknown) {
  return (event: UserProfileUpdatedEvent) => {
    notifyUserChange(event.data.user.id)
  }
}

/** Tells the person's other open tabs that their push devices changed, so they read the list. */
export function createPushDevicesHintListener(notifyUserChange: (userId: number) => unknown) {
  return (event: PushDevicesUpdatedEvent) => {
    notifyUserChange(event.data.userId)
  }
}

/** Tells the person's other open tabs that they chose another group, so they read the selection. */
export function createGroupSelectedHintListener(notifyUserChange: (userId: number) => unknown) {
  return (event: GroupSelectedEvent) => {
    notifyUserChange(event.data.userId)
  }
}

/** Tells the person's other open tabs that they closed the checklist or the tour. */
export function createOnboardingHintListener(notifyUserChange: (userId: number) => unknown) {
  return (event: OnboardingMarkedEvent) => {
    notifyUserChange(event.data.userId)
  }
}

/** Tells the person's other open tabs that they saved their preferences, so they read them. */
export function createPreferencesHintListener(notifyUserChange: (userId: number) => unknown) {
  return (event: PreferencesUpdatedEvent) => {
    notifyUserChange(event.data.userId)
  }
}
