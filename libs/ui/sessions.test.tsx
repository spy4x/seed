/**
 * The signed-in devices section and the password dialog's "Sign out of all other devices" box,
 * driven in a browser DOM (happy-dom): what is marked, what asks first and what the app receives.
 */
import { formatTime } from "@spy4x/platform/universal/time"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { type SignedInDevice, UserMFAStatus } from "@domain/identity"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { SignedInDevices, type SignedInDevicesProps } from "./signed-in-devices.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  CSS: globalThis.CSS,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
    CSS: window.CSS,
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** Clicks the button labelled `label` inside the dialog `dialog` names by its `data-e2e`. */
async function clickInDialog(dialog: string, label: string): Promise<void> {
  const button = [...document.querySelectorAll(`[data-e2e=${dialog}] button`)]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`the ${dialog} dialog has no ${label} button`)
  await act(() => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
  })
}

function isOpen(dialog: string): boolean {
  return document.querySelector<HTMLDialogElement>(`dialog[data-e2e=${dialog}]`)?.open === true
}

const current: SignedInDevice = {
  id: 7,
  deviceName: "Firefox on Linux",
  ipHint: "203.0.113.*",
  createdAt: "2026-10-01T08:00:00.000Z",
  lastUsedAt: "2026-10-04T08:00:00.000Z",
  current: true,
}
const phone: SignedInDevice = {
  ...current,
  id: 9,
  deviceName: "Safari on iPhone",
  ipHint: "198.51.100.*",
  current: false,
}

/** The section with both devices, recording what the app was asked to end. */
function devicesProps(
  ended: (number | "others")[],
  props: Partial<SignedInDevicesProps> = {},
): SignedInDevicesProps {
  return {
    sessions: [current, phone],
    pending: false,
    error: null,
    onEnd: (id) => void ended.push(id),
    onEndOthers: () => void ended.push("others"),
    ...props,
  }
}

describe("SignedInDevices", () => {
  it("marks this device and offers no sign-out on it", async () => {
    await mount(<SignedInDevices {...devicesProps([])} />)

    const row = find("[data-e2e=session-current]")
    expect(row.textContent).toContain("Firefox on Linux")
    expect(row.textContent).toContain("This device")
    expect(row.querySelectorAll("button").length).toBe(0)
    expect(find("[data-e2e=session-9]").textContent).not.toContain("This device")
  })

  it("shows each address with its last part hidden", async () => {
    await mount(<SignedInDevices {...devicesProps([])} />)

    const ips = [...document.querySelectorAll("[data-e2e=session-ip]")].map((ip) => ip.textContent)
    expect(ips).toEqual(["203.0.113.*", "198.51.100.*"])
  })

  it("puts the address on a line of its own, with no separator that could start a line", async () => {
    await mount(<SignedInDevices {...devicesProps([])} />)

    const details = find("[data-e2e=session-9] [data-e2e=session-details]")
    expect(details.classList.contains("flex-col")).toBe(true)
    expect(details.textContent).not.toContain("·")
  })

  it("names the device in the sign-out button for a screen reader", async () => {
    await mount(<SignedInDevices {...devicesProps([])} />)

    expect(find("[data-e2e=session-end-9]").textContent).toBe("Sign out Safari on iPhone")
    expect(find("[data-e2e=session-end-9]").classList.contains("min-h-11")).toBe(true)
  })

  it("signs one device out only after the person confirms", async () => {
    const ended: (number | "others")[] = []
    await mount(<SignedInDevices {...devicesProps(ended)} />)

    await click("[data-e2e=session-end-9]")
    expect(isOpen("session-end-confirm")).toBe(true)
    await clickInDialog("session-end-confirm", "Cancel")
    expect(ended).toEqual([])

    await click("[data-e2e=session-end-9]")
    await clickInDialog("session-end-confirm", "Sign out")
    expect(ended).toEqual([9])
  })

  it("signs every other device out only after the person confirms", async () => {
    const ended: (number | "others")[] = []
    await mount(<SignedInDevices {...devicesProps(ended)} />)

    await click("[data-e2e=sessions-end-others]")
    expect(isOpen("sessions-end-others-confirm")).toBe(true)
    await clickInDialog("sessions-end-others-confirm", "Cancel")
    expect(ended).toEqual([])

    await click("[data-e2e=sessions-end-others]")
    await clickInDialog("sessions-end-others-confirm", "Sign out")
    expect(ended).toEqual(["others"])
  })

  it("offers no sign-out of other devices when this is the only one", async () => {
    await mount(<SignedInDevices {...devicesProps([], { sessions: [current] })} />)

    expect(document.querySelectorAll("[data-e2e=sessions-end-others]").length).toBe(0)
  })

  it("disables every sign-out while one is in flight", async () => {
    await mount(<SignedInDevices {...devicesProps([], { pending: true })} />)

    expect(find<HTMLButtonElement>("[data-e2e=session-end-9]").disabled).toBe(true)
    expect(find("[data-e2e=sessions-end-others]").getAttribute("aria-disabled")).toBe("true")
    await click("[data-e2e=sessions-end-others]")
    expect(isOpen("sessions-end-others-confirm")).toBe(false)
  })

  it("says the list is loading before it is known, and shows a failure", async () => {
    await mount(
      <SignedInDevices {...devicesProps([], { sessions: null, error: "Could not read" })} />,
    )

    expect(find("[data-e2e=sessions]").textContent).toContain("Loading your devices")
    expect(find("[data-e2e=sessions]").textContent).toContain("Could not read")
  })

  it("says when the list is a copy saved on this device, with the time it was saved", async () => {
    const savedAt = Date.UTC(2026, 9, 10, 8, 30)
    await mount(<SignedInDevices {...devicesProps([], { savedAt })} />)

    const notice = find("[data-e2e=sessions-saved-copy]")
    expect(notice.getAttribute("role")).toBe("status")
    expect(notice.textContent).toContain("Saved copy of your devices")
    // Worded in the machine's own zone, as the library does, so the test holds in every zone.
    const worded = formatTime(new Date(savedAt), { full: true })
    expect(notice.textContent).toContain(`saved on this device: ${worded}`)
    expect(notice.getAttribute("data-saved-at")).toBe("2026-10-10T08:30:00.000Z")
  })

  it("keeps an empty live region for the copy when the server answered", async () => {
    await mount(<SignedInDevices {...devicesProps([], { savedAt: null })} />)

    const notice = find("[data-e2e=sessions-saved-copy]")
    expect(notice.getAttribute("role")).toBe("status")
    expect(notice.textContent).toBe("")
    expect(notice.hasAttribute("data-saved-at")).toBe(false)
  })
})

describe("ProfileScreen password dialog", () => {
  const profile: ProfileScreenProps = {
    onRemovePush: () => {},
    user: { id: 1, firstName: "Ada", lastName: "Lovelace", mfa: UserMFAStatus.NOT_CONFIGURED },
    isMfaRequired: false,
    email: { email: "ada@example.com", proven: true, pending: null },
    values: {
      firstName: "Ada",
      lastName: "Lovelace",
      currentPassword: "",
      newPassword: "",
      passwordOtp: "",
      otp: "",
      totpPassword: "",
      twoFactorProof: "",
    },
    onValueChange: () => {},
    errors: { fields: {}, profile: null, password: null, totp: null, push: null },
    pending: { profile: false, password: false, totp: false, push: false },
    enrolment: null,
    pushDevices: [],
    section: "security",
  } as unknown as ProfileScreenProps

  it("offers signing out of the other devices, ticked by default, and reports a change", async () => {
    const choices: boolean[] = []
    await mount(
      <ProfileScreen
        {...profile}
        onChangePassword={() => {}}
        onSignOutOthersChange={(value) => void choices.push(value)}
      />,
    )
    await click("[data-e2e=password-open]")

    const box = find<HTMLInputElement>("input[data-e2e=password-sign-out-others]")
    expect(box.checked).toBe(true)
    expect(box.name).toBe("signOutOthers")
    await act(() => {
      box.click()
    })
    expect(choices).toEqual([false])
  })

  it("has no such box when the app does not handle it", async () => {
    await mount(<ProfileScreen {...profile} onChangePassword={() => {}} />)
    await click("[data-e2e=password-open]")

    expect(document.querySelectorAll("[data-e2e=password-sign-out-others]").length).toBe(0)
  })

  it("shows the signed-in devices section when the app passes it", async () => {
    await mount(<ProfileScreen {...profile} devices={devicesProps([])} />)

    expect(find("[data-e2e=sessions]").querySelector("h2")?.textContent).toBe("Signed-in devices")
  })
})
