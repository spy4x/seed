import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  GroupSelectedEvent,
  OnboardingMarkedEvent,
  PreferencesUpdatedEvent,
  PushDevicesUpdatedEvent,
  UserProfileUpdatedEvent,
} from "../events.ts"
import type { User } from "@domain/identity"
import {
  createGroupSelectedHintListener,
  createOnboardingHintListener,
  createPreferencesHintListener,
  createProfileHintListener,
  createPushDevicesHintListener,
} from "./user-change-hints.ts"

describe("user change hint listeners", () => {
  it("hints the user whose profile was updated", () => {
    const hinted: number[] = []

    createProfileHintListener((id) => hinted.push(id))(
      new UserProfileUpdatedEvent({ user: { id: 7 } as User, request: {} }),
    )

    expect(hinted).toEqual([7])
  })

  it("hints the user whose push devices changed", () => {
    const hinted: number[] = []

    createPushDevicesHintListener((id) => hinted.push(id))(
      new PushDevicesUpdatedEvent({ userId: 7, devices: [], request: {} }),
    )

    expect(hinted).toEqual([7])
  })

  it("hints the user who saved their preferences, so their other devices read them", () => {
    const hinted: number[] = []

    createPreferencesHintListener((id) => hinted.push(id))(
      new PreferencesUpdatedEvent({ userId: 7 }),
    )

    expect(hinted).toEqual([7])
  })

  it("hints the user who closed the checklist or the tour", () => {
    const hinted: number[] = []

    createOnboardingHintListener((id) => hinted.push(id))(new OnboardingMarkedEvent({ userId: 7 }))

    expect(hinted).toEqual([7])
  })

  it("hints the user who chose another group", () => {
    const hinted: number[] = []

    createGroupSelectedHintListener((id) => hinted.push(id))(
      new GroupSelectedEvent({ userId: 7, groupId: "g" }),
    )

    expect(hinted).toEqual([7])
  })
})
