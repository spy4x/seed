/**
 * The first-steps card driven in a browser DOM (happy-dom): which steps it shows as done, what its
 * buttons call, and where keyboard focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import type { OnboardingSteps } from "@domain/identity"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import {
  ONBOARDING_FAILURE,
  OnboardingCard,
  type OnboardingCardProps,
  tourSteps,
} from "./onboarding-card.tsx"
import { ENGLISH, englishLeft, PSEUDO } from "./i18n-testing.ts"

const TOUR_STEPS = tourSteps(ENGLISH)

const window = new Window({ url: "http://app.localhost/" })
const NAMES = [
  "document",
  "location",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "HTMLElement",
  "Element",
  "innerWidth",
  "innerHeight",
] as const
const own = Object.fromEntries(
  NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
)

beforeAll(() => {
  // Preact draws into `document`. A link is routed only when it points at the page's own origin
  // (`location`). The library's tour reads its target's style, lays itself out in an animation
  // frame and asks `instanceof HTMLElement` when it puts focus back; it places itself in the window
  // (`innerWidth`, `innerHeight`).
  Object.assign(
    globalThis,
    Object.fromEntries(NAMES.map((name) => {
      const value = (window as unknown as Record<string, unknown>)[name]
      return [
        name,
        typeof value === "function" && !/^[A-Z]/.test(name) ? value.bind(window) : value,
      ]
    })),
  )
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root?.remove()
  root = null
})

const NONE: OnboardingSteps = {
  emailVerified: false,
  noteCreated: false,
  memberInvited: false,
  notificationsOn: false,
  twoFactorOn: false,
}

/** What the card called, in order. */
interface Calls {
  log: string[]
  routed: string[]
}

/**
 * The card on a page, with the app's part played by the test: `props` is what the app passes, and
 * `update` renders the card again with what the app would pass next.
 */
async function mount(props: Partial<OnboardingCardProps> = {}, language?: Translator<string>) {
  const calls: Calls = { log: [], routed: [] }
  let current: OnboardingCardProps = {
    steps: NONE,
    groupId: "g-1",
    navigate: (path) => calls.routed.push(path),
    onDismiss: () => calls.log.push("dismiss"),
    tourOffered: true,
    tourOpen: false,
    tourIndex: 0,
    onTourStart: () => calls.log.push("tour start"),
    onTourIndexChange: (index) => calls.log.push(`tour step ${index}`),
    onTourEnd: () => calls.log.push("tour end"),
    ...props,
  }
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  const draw = () =>
    act(() =>
      render(
        language
          ? (
            <I18nContext.Provider value={language}>
              <OnboardingCard {...current} />
            </I18nContext.Provider>
          )
          : <OnboardingCard {...current} />,
        root!,
      )
    )
  await draw()
  return {
    calls,
    update: async (next: Partial<OnboardingCardProps>) => {
      current = { ...current, ...next }
      await draw()
    },
  }
}

const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]

/** The button or link whose visible text is exactly `name`, or a failure listing what is there. */
function control(name: string): HTMLElement {
  const controls = all("button, a")
  const found = controls.find((element) => element.textContent?.trim() === name)
  if (!found) {
    throw new Error(`no "${name}" among: ${controls.map((c) => c.textContent?.trim()).join(" | ")}`)
  }
  return found
}

/** A plain left click, as a person makes it. */
async function press(name: string): Promise<void> {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(() => {
    control(name).dispatchEvent(event as unknown as Event)
  })
}

/** The steps as a screen reader reads them: "Done: …" or "To do: …". */
const stepLines = () => all(`[data-e2e=onboarding] li`).map((item) => item.textContent ?? "")

describe("first-steps card", () => {
  it("lists the five steps, all to do for a new account, and offers the first one as its action", async () => {
    await mount()

    const lines = stepLines()
    expect(lines.length).toBe(5)
    expect(lines.every((line) => line.includes("To do: "))).toBe(true)
    expect(lines[0]).toContain("Verify your e-mail address")
    expect(lines[1]).toContain("Write your first note")
    expect(lines[2]).toContain("Invite someone to your group")
    expect(lines[3]).toContain("Turn on notifications")
    expect(lines[4]).toContain("Set up two-factor sign-in")
    expect(control("Verify e-mail").getAttribute("href")).toBe("/profile/account?verify")
  })

  it("draws its action as a secondary button, so the page header keeps the one filled button", async () => {
    await mount()

    expect(control("Verify e-mail").className).not.toMatch(/\bbg-accent-900\b/)
  })

  it("ticks a step when its fact arrives and moves the action to the next open step", async () => {
    const { update } = await mount({ steps: { ...NONE, emailVerified: true } })
    expect(stepLines()[0]).toContain("Done: ")
    expect(stepLines()[1]).toContain("To do: ")
    expect(control("Write a note").getAttribute("href")).toBe("/notes/new")

    await update({ steps: { ...NONE, emailVerified: true, noteCreated: true } })

    expect(stepLines()[1]).toContain("Done: ")
    expect(control("Invite someone").getAttribute("href")).toBe("/groups/g-1/members")
  })

  it("links each step to the page that does it", async () => {
    const hrefs: (string | null)[] = []
    const done = { ...NONE }
    const { update } = await mount()
    for (
      const [fact, label] of [
        ["emailVerified", "Verify e-mail"],
        ["noteCreated", "Write a note"],
        ["memberInvited", "Invite someone"],
        ["notificationsOn", "Turn on notifications"],
        ["twoFactorOn", "Set up two-factor"],
      ] as const
    ) {
      hrefs.push(control(label).getAttribute("href"))
      done[fact] = true
      await update({ steps: { ...done } })
    }

    expect(hrefs).toEqual([
      "/profile/account?verify",
      "/notes/new",
      "/groups/g-1/members",
      "/profile/notifications",
      "/profile/security",
    ])
  })

  it("sends the invitation step to the groups page for a person with no selected group", async () => {
    await mount({ groupId: null, steps: { ...NONE, emailVerified: true, noteCreated: true } })

    expect(control("Invite someone").getAttribute("href")).toBe("/groups")
  })

  it("opens a step's page through the app's router", async () => {
    const { calls } = await mount()

    await press("Verify e-mail")

    expect(calls.routed).toEqual(["/profile/account?verify"])
  })

  it("calls the app when Dismiss is pressed, and keeps the card until the app removes it", async () => {
    const { calls } = await mount()
    expect(all("button").some((button) => button.textContent?.trim() === "Finish")).toBe(false)

    await press("Dismiss")

    expect(calls.log).toEqual(["dismiss"])
    expect(stepLines().length).toBe(5)
  })

  it("offers Finish only once every step is done, and it closes the card like Dismiss", async () => {
    const { calls } = await mount({
      steps: {
        emailVerified: true,
        noteCreated: true,
        memberInvited: true,
        notificationsOn: true,
        twoFactorOn: true,
      },
    })
    expect(all("a").length).toBe(0)

    await press("Finish")

    expect(calls.log).toEqual(["dismiss"])
  })

  it("shows why the last answer was not saved", async () => {
    const { update } = await mount()
    expect(all("[data-e2e=onboarding-error]").length).toBe(0)

    await update({ error: "Could not save that. Try again." })

    expect(document.querySelector("[data-e2e=onboarding-error]")?.textContent).toContain(
      "Could not save that. Try again.",
    )
  })
})

describe("first-steps tour", () => {
  it("is offered on the card and starts only when asked", async () => {
    const { calls } = await mount()
    control("Take the tour").focus()

    await press("Take the tour")

    // The card only asks: the tour takes focus when the app opens it, not before.
    expect(calls.log).toEqual(["tour start"])
    expect(document.activeElement?.textContent?.trim()).toBe("Take the tour")
  })

  it("is not offered to a person who finished or skipped it", async () => {
    await mount({ tourOffered: false })

    expect(all("[data-e2e=onboarding-tour-offer]").length).toBe(0)
    expect(stepLines().length).toBe(5)
  })

  it("ends on Skip the tour and moves focus to the card's heading when the offer leaves", async () => {
    const { calls, update } = await mount()
    control("Skip the tour").focus()

    await press("Skip the tour")
    await update({ tourOffered: false })

    expect(calls.log).toEqual(["tour end"])
    expect(document.activeElement?.tagName).toBe("H2")
    expect(document.activeElement?.textContent).toBe("Get started")
  })

  for (const way of ["Skip tour", "Close", "Escape", "Done"] as const) {
    it(`moves focus to the card's heading when the tour ends by ${way}, with the step's target hidden`, async () => {
      const last = way === "Done" ? TOUR_STEPS.length - 1 : 0
      const { calls, update } = await mount()
      control("Take the tour").focus()
      await update({ tourOpen: true, tourIndex: last })

      if (way === "Escape") {
        const key = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        await act(() => void document.activeElement?.dispatchEvent(key as unknown as Event))
      } else if (way === "Close") {
        const click = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
        await act(() => void all(`button[aria-label="Close"]`)[0].dispatchEvent(click as never))
      } else await press(way)
      expect(calls.log).toEqual(["tour end"])
      await update({ tourOpen: false, tourOffered: false })

      expect(document.activeElement?.tagName).toBe("H2")
      expect(document.activeElement?.textContent).toBe("Get started")
    })
  }

  it("moves focus to the card's heading, not to the step's target, when the tour ends on a wide window", async () => {
    const rail = window.document.createElement("nav")
    rail.setAttribute("data-e2e", "rail-shell-rail")
    rail.innerHTML = `<a href="/notes">Notes</a>`
    window.document.body.appendChild(rail)
    try {
      const { update } = await mount()
      control("Take the tour").focus()
      await update({ tourOpen: true })

      await press("Skip tour")
      await update({ tourOpen: false, tourOffered: false })

      expect(document.activeElement?.textContent).toBe("Get started")
    } finally {
      rail.remove()
    }
  })

  it("names the account step's Go to button by the place, without the person's address", async () => {
    const bottom = window.document.createElement("div")
    bottom.setAttribute("data-e2e", "rail-shell-bottom")
    bottom.innerHTML =
      `<button data-e2e="account-menu-button" aria-label="Account: ada@example.com">A</button>`
    window.document.body.appendChild(bottom)
    // happy-dom lays nothing out; the tour names only a target that has a box.
    const account = bottom.firstElementChild as unknown as HTMLElement
    account.getBoundingClientRect = () => ({ width: 48, height: 48 }) as DOMRect
    try {
      await mount({ tourOpen: true, tourIndex: TOUR_STEPS.length - 1 })
      expect(control("Go to Account").textContent).not.toContain("@")
    } finally {
      bottom.remove()
    }
  })

  it("keeps focus on the card's heading when the offer comes back because the end was not saved", async () => {
    const { update } = await mount({ tourOpen: true })
    await press("Skip tour")
    await update({ tourOpen: false, tourOffered: false })

    await update({ tourOffered: true, error: "Try again later" })

    expect(document.activeElement?.textContent).toBe("Get started")
  })

  it("leaves focus alone when the app closes the tour itself", async () => {
    const { update } = await mount({ tourOpen: true })
    control("Dismiss").focus()

    await update({ tourOpen: false })

    expect(document.activeElement?.textContent?.trim()).toBe("Dismiss")
  })

  it("walks the side navigation, Notifications and the account, in that order, on the hooks the browser tests use", async () => {
    await mount()

    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      "notes",
      "groups",
      "notifications",
      "profile",
    ])
    expect(TOUR_STEPS.map((step) => step.target)).toEqual([
      `[data-e2e="rail-shell-rail"] a[href="/notes"]`,
      `[data-e2e="rail-shell-rail"] a[href="/groups"]`,
      `[data-e2e="rail-shell-bottom"] a[href="/notifications"]`,
      `[data-e2e="rail-shell-bottom"] [data-e2e="account-menu-button"]`,
    ])
    expect(all("[data-e2e=onboarding-tour-start]").map((b) => b.textContent?.trim())).toEqual([
      "Take the tour",
    ])
    expect(all("[data-e2e=onboarding-tour-skip]").map((b) => b.textContent?.trim())).toEqual([
      "Skip the tour",
    ])
  })

  it("leaves focus alone when the offer leaves because another tab ended the tour", async () => {
    const { update } = await mount()
    control("Dismiss").focus()

    await update({ tourOffered: false })

    expect(document.activeElement?.textContent?.trim()).toBe("Dismiss")
  })

  it("shows the step the app is on, with its place in the tour, and moves focus to its heading", async () => {
    const { update } = await mount()
    await update({ tourOpen: true })
    expect(document.activeElement?.textContent).toBe(TOUR_STEPS[0].title)
    expect(document.body.textContent).toContain(`Step 1 of ${TOUR_STEPS.length}`)
    expect(document.body.textContent).toContain(TOUR_STEPS[0].body as string)

    await update({ tourIndex: 2 })

    expect(document.body.textContent).toContain(`Step 3 of ${TOUR_STEPS.length}`)
    expect(document.body.textContent).toContain(TOUR_STEPS[2].body as string)
    expect(document.activeElement?.textContent).toBe(TOUR_STEPS[2].title)
  })

  it("asks the app for the next and the previous step", async () => {
    const { calls } = await mount({ tourOpen: true, tourIndex: 1 })

    await press("Next")
    await press("Back")

    expect(calls.log).toEqual(["tour step 2", "tour step 0"])
  })

  it("ends on Skip tour, and on Done at the last step", async () => {
    const skipped = await mount({ tourOpen: true })
    await press("Skip tour")
    expect(skipped.calls.log).toEqual(["tour end"])
    await act(() => render(null, root!))
    root?.remove()

    const finished = await mount({ tourOpen: true, tourIndex: TOUR_STEPS.length - 1 })
    await press("Done")
    expect(finished.calls.log).toEqual(["tour end"])
  })
})

describe("first-steps card in another language", () => {
  it("shows no English outside the catalogs: an en-XA render of the card and the tour is all pseudo-language", async () => {
    await mount({ tourOpen: true, error: ONBOARDING_FAILURE }, PSEUDO)

    expect(englishLeft(document.body)).toEqual([])
    // The render reached the card, its error and the tour: each one's pseudo-text is on the page.
    const page = document.body.textContent ?? ""
    for (
      const key of ["OnboardingCard.title", "OnboardingCard.failed", "OnboardingCard.tourNotesText"]
    ) {
      expect(page).toContain(PSEUDO.t(key))
    }
  })

  it("asks a guest to keep the account in the person's language", async () => {
    await mount({ guest: true }, PSEUDO)

    expect(englishLeft(document.body)).toEqual([])
    const page = document.body.textContent ?? ""
    expect(page).toContain(PSEUDO.t("OnboardingCard.keep"))
    expect(page).toContain(PSEUDO.t("OnboardingCard.keepText"))
  })
})
