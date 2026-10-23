import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  describeNotification,
  NOTIFICATION_PAGE_DEFAULT,
  NOTIFICATION_PAGE_MAX,
  NotificationError,
  NotificationKind,
  parseNotificationId,
  parseNotificationLimit,
} from "./+lib.ts"

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof NotificationError) return error.code
    throw error
  }
}

describe("describeNotification", () => {
  it("names the group and the role of an invitation", () => {
    expect(describeNotification({
      kind: NotificationKind.InvitationReceived,
      payload: { groupName: "Family", role: "editor" },
    })).toBe("You were invited to join “Family” as an editor.")
  })

  it("says a for a role that starts with a consonant", () => {
    expect(describeNotification({
      kind: NotificationKind.InvitationReceived,
      payload: { groupName: "Work", role: "viewer" },
    })).toBe("You were invited to join “Work” as a viewer.")
  })

  it("tells the new role after a change", () => {
    expect(describeNotification({
      kind: NotificationKind.RoleChanged,
      payload: { groupName: "Family", from: "viewer", to: "admin" },
    })).toBe("Your role in “Family” is now an admin.")
  })

  it("tells a removal and an ownership transfer", () => {
    expect(describeNotification({
      kind: NotificationKind.RemovedFromGroup,
      payload: { groupName: "Family" },
    })).toBe("You were removed from “Family”.")
    expect(describeNotification({
      kind: NotificationKind.OwnershipReceived,
      payload: { groupName: "Family" },
    })).toBe("You now own “Family”.")
  })

  it("tells the person their data is ready and until which day", () => {
    expect(describeNotification({
      kind: NotificationKind.DataExportReady,
      payload: { expiresAt: "2026-10-30T10:00:00.000Z" },
    })).toBe("Your data is ready. Download it from your profile until 30 Oct 2026.")
    expect(describeNotification({ kind: NotificationKind.DataExportReady, payload: {} })).toBe(
      "Your data is ready. Download it from your profile.",
    )
  })

  it("reads a kind it does not know as a neutral line", () => {
    expect(describeNotification({ kind: "from.the.future", payload: {} })).toBe(
      "You have a new notification.",
    )
  })

  it("falls back to a word when the payload misses a fact", () => {
    expect(describeNotification({ kind: NotificationKind.RemovedFromGroup, payload: {} })).toBe(
      "You were removed from “a group”.",
    )
  })
})

describe("notification request parsing", () => {
  it("accepts a positive integer id", () => {
    expect(parseNotificationId("42")).toBe("42")
  })

  it("accepts the largest bigint id and refuses one above it", () => {
    expect(parseNotificationId("9223372036854775807")).toBe("9223372036854775807")
    for (const big of ["9223372036854775808", "9999999999999999999"]) {
      expect(codeOf(() => parseNotificationId(big))).toBe("INVALID_REQUEST")
    }
  })

  it("refuses an id that is not a plain positive integer", () => {
    for (const bad of ["", "0", "-1", "1.5", "abc", "1 OR 1=1", "01", 5, null, undefined]) {
      expect(codeOf(() => parseNotificationId(bad))).toBe("INVALID_REQUEST")
    }
  })

  it("defaults the page size and refuses sizes outside 1 to the maximum", () => {
    expect(parseNotificationLimit(undefined)).toBe(NOTIFICATION_PAGE_DEFAULT)
    expect(parseNotificationLimit(String(NOTIFICATION_PAGE_MAX))).toBe(NOTIFICATION_PAGE_MAX)
    for (const bad of ["0", String(NOTIFICATION_PAGE_MAX + 1), "-3", "x", "1e2"]) {
      expect(codeOf(() => parseNotificationLimit(bad))).toBe("INVALID_REQUEST")
    }
  })
})
