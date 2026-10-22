/**
 * The group overview, `OverviewScreen` with the notes' widgets: what each widget shows for its
 * data, and what a person does on the page in a browser DOM (happy-dom): hide a widget from its
 * menu, customise the layout, retry a widget, and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { useState } from "preact/hooks"
import { act } from "preact/test-utils"
import { FormatContext } from "@spy4x/preact-ui/format"
import type { LayoutEntry } from "@spy4x/preact-ui/layout-customiser"
import { ticks } from "@spy4x/preact-charts/scales"
import { createFormatters } from "@spy4x/time/format"
import { NOTE_WIDGET_IDS } from "@domain/notes"
import {
  OverviewScreen,
  type OverviewScreenProps,
  type OverviewWidget,
  type OverviewWidgetLoad,
} from "./overview-screen.tsx"
import { OVERVIEW_VIEWS, OVERVIEW_WIDGETS } from "./overview-widgets.ts"
import { AdminGroupOverview } from "./admin-group-overview.tsx"
import { countAxis } from "./note-widgets.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
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

const { total, added, series } = NOTE_WIDGET_IDS
const NOW = new Date("2026-10-21T10:00:00Z")
const LAST_30 = { preset: "last-30-days" as const, range: { from: "2026-09-22", to: "2026-10-21" } }
const DAYS = ["2026-10-19", "2026-10-20", "2026-10-21"]

/** Every widget ready with ordinary data. */
const READY: Record<string, OverviewWidgetLoad> = {
  [total]: { status: "ready", data: { current: 31, previous: 27 }, savedAt: null },
  [added]: { status: "ready", data: { current: 9, previous: 11 }, savedAt: null },
  [series]: {
    status: "ready",
    data: { days: DAYS, current: [27, 30, 31], previous: [20, 22, 27] },
    savedAt: null,
  },
}

interface Seen {
  hidden: string[]
  retried: string[]
  layouts: LayoutEntry[][]
  resets: number
  copies: number
}

/**
 * The screen with the state an app keeps: the layout and whether Customise is open. Hiding and
 * customising change the layout here, as the SPA's preferences do.
 */
function Harness(
  { loads, seen, props }: {
    loads: Record<string, OverviewWidgetLoad>
    seen: Seen
    props?: Partial<OverviewScreenProps>
  },
) {
  const [layout, setLayout] = useState<LayoutEntry[]>(
    OVERVIEW_WIDGETS.map((widget) => ({ id: widget.id, hidden: false })),
  )
  const [customising, setCustomising] = useState(false)
  const widgets: OverviewWidget[] = layout.flatMap((entry) => {
    const widget = OVERVIEW_WIDGETS.find((candidate) => candidate.id === entry.id)!
    return entry.hidden ? [] : [{ ...widget, load: loads[widget.id] }]
  })
  return (
    <FormatContext.Provider
      value={createFormatters({ locale: "en-GB", timeZone: "UTC", hourCycle: null })}
    >
      <OverviewScreen
        group={{ id: "g-1", name: "Acme Studio" }}
        loading={false}
        range={LAST_30}
        timeZone="UTC"
        now={NOW}
        onRangeChange={() => {}}
        widgets={widgets}
        views={OVERVIEW_VIEWS}
        onRetry={(id) => void seen.retried.push(id)}
        onHide={(id) => {
          seen.hidden.push(id)
          setLayout(layout.map((entry) => entry.id === id ? { ...entry, hidden: true } : entry))
        }}
        layout={layout.map((entry) => ({
          ...entry,
          title: OVERVIEW_WIDGETS.find((widget) => widget.id === entry.id)!.title,
        }))}
        customising={customising}
        onCustomise={() => setCustomising(true)}
        onCloseCustomise={() => setCustomising(false)}
        onLayoutChange={(next) => {
          seen.layouts.push(next)
          setLayout(next)
        }}
        onResetLayout={() => void seen.resets++}
        onCopyLink={() => void seen.copies++}
        {...props}
      />
    </FormatContext.Provider>
  )
}

async function mount(
  loads: Record<string, OverviewWidgetLoad> = READY,
  props?: Partial<OverviewScreenProps>,
): Promise<Seen> {
  const seen: Seen = { hidden: [], retried: [], layouts: [], resets: 0, copies: 0 }
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(<Harness loads={loads} seen={seen} props={props} />, root!))
  return seen
}

/** The `data-e2e` of the focused element: a short value for a test to compare and print. */
function focused(): string | null {
  return document.activeElement?.getAttribute("data-e2e") ?? null
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function text(selector: string): string {
  return (find(selector).textContent ?? "").replace(/\s+/g, " ").trim()
}

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }) as unknown as Event,
    )
  })
}

/** Clicks the button, link or menu item inside `within` whose text is `label`. */
async function clickText(label: string, within = "body"): Promise<void> {
  const target = [...find(within).querySelectorAll("button, a, [role=menuitem]")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!target) throw new Error(`nothing reads ${label} in ${within}`)
  await clickOn(target)
}

const card = (id: string) => `[data-e2e="overview-widget-${id}"]`

describe("the group overview", () => {
  it("shows each number with what it counts and a neutral comparison with the period before", async () => {
    await mount()

    expect(text(card(total))).toContain("31")
    expect(text(card(total))).toContain("In the group now")
    expect(text(card(total))).toContain("+4 vs previous 30 days")
    expect(text(card(added))).toContain("Added in this range")
    expect(text(card(added))).toContain("−2 vs previous 30 days")
    expect(text("[data-e2e=overview-period]")).toBe(
      "22 Sept – 21 Oct, compared with the 30 days before",
    )
  })

  it("names the last day instead of now for a range that ended before today", async () => {
    await mount(READY, {
      range: { preset: "custom", range: { from: "2026-09-01", to: "2026-09-30" } },
    })

    expect(text(card(total))).toContain("On 30 Sept 2026")
    expect(text(card(total))).not.toContain("In the group now")
  })

  it("leaves the comparison out when the group is younger than the period before", async () => {
    await mount({
      ...READY,
      [total]: { status: "ready", data: { current: 31, previous: null }, savedAt: null },
    })

    expect(text(card(total))).not.toContain("vs previous")
  })

  it("says the chart's range in one sentence and keeps its numbers in a table", async () => {
    await mount()

    expect(text(card(series))).toContain("From 27 to 31")
    expect(document.querySelectorAll(`${card(series)} [data-chart-table] tbody tr`)).toHaveLength(3)
  })

  it("draws no tick of the chart's axis above the plot", async () => {
    await mount({
      ...READY,
      [series]: {
        status: "ready",
        data: { days: DAYS, current: [28, 40, 45], previous: [20, 22, 28] },
        savedAt: null,
      },
    })

    const labels = [...document.querySelectorAll<HTMLElement>(`${card(series)} span.tabular-nums`)]
    expect(labels.at(-1)?.textContent).toBe("50")
    expect(labels.map((label) => label.style.top).filter((top) => top.startsWith("-")))
      .toEqual([])
  })

  it("keeps every count axis's top a whole tick, at or above the largest count", () => {
    const wrong: number[] = []
    for (let top = 0; top <= 2000; top++) {
      const axis = countAxis(top)
      const drawn = ticks(0, axis.max, axis.steps)
      const fits = axis.max >= Math.max(1, top) && drawn.at(-1) === axis.max &&
        drawn.every((tick) => Number.isInteger(tick) && tick >= 0 && tick <= axis.max)
      if (!fits) wrong.push(top)
    }
    expect(wrong).toEqual([])
  })

  it("draws an empty chart as one line at a number's height", async () => {
    await mount({
      ...READY,
      [series]: {
        status: "ready",
        data: { days: DAYS, current: [0, 0, 0], previous: [0, 0, 0] },
        savedAt: null,
      },
    })

    expect(document.querySelectorAll(`${card(series)} .min-h-60`).length).toBe(0)
  })

  it("gives the range picker's trigger a 44 px touch target on a phone", async () => {
    await mount()

    expect(find("[data-e2e=overview-range]").parentElement!.className).toContain(
      "[&>button]:min-h-11",
    )
  })

  it("labels the chart's axis in whole notes when the group has only a few", async () => {
    await mount({
      ...READY,
      [series]: {
        status: "ready",
        data: { days: DAYS, current: [0, 0, 1], previous: null },
        savedAt: null,
      },
    })

    const labels = [...document.querySelectorAll(`${card(series)} span.tabular-nums`)]
      .map((label) => label.textContent)
    expect(labels).toEqual(["0", "1"])
  })

  it("shows one line for a range with no notes, and real zeros in the numbers", async () => {
    await mount({
      [total]: { status: "ready", data: { current: 0, previous: 0 }, savedAt: null },
      [added]: { status: "ready", data: { current: 0, previous: 0 }, savedAt: null },
      [series]: {
        status: "ready",
        data: { days: DAYS, current: [0, 0, 0], previous: [0, 0, 0] },
        savedAt: null,
      },
    })

    expect(text(card(series))).toContain("No notes in this range")
    expect(text(card(added))).toContain("Nothing added in this range")
    expect(text(card(total))).toContain("No change vs previous 30 days")
  })

  it("names the time of a saved copy shown offline", async () => {
    await mount({
      ...READY,
      [total]: {
        status: "ready",
        data: { current: 31, previous: 27 },
        savedAt: Date.parse("2026-10-21T14:02:00Z"),
      },
    })

    expect(text(card(total))).toContain("As of 14:02")
  })

  it("lets one widget fail on its own and reads it again with Try again, keeping focus on it", async () => {
    const seen = await mount({ ...READY, [added]: { status: "error" } })

    expect(text(card(added))).toContain("We could not load the notes added.")
    expect(text(card(total))).toContain("31")
    await clickText("Try again", card(added))

    expect(seen.retried).toEqual([added])
    expect(focused()).toBe(`overview-widget-${added}`)
  })

  it("hides a widget from its menu and moves focus to the card now in its place", async () => {
    const seen = await mount()

    await clickOn(find(`${card(total)} button[aria-label="Actions for Notes"]`))
    await clickText("Hide widget", card(total))

    expect(seen.hidden).toEqual([total])
    expect(document.querySelectorAll(card(total)).length).toBe(0)
    expect(focused()).toBe(`overview-widget-${added}`)
  })

  it("offers Customise overview when every widget is hidden, and focuses it after the last hide", async () => {
    await mount()
    for (const id of [total, added, series]) {
      await clickOn(find(`${card(id)} button[aria-haspopup]`))
      await clickText("Hide widget", card(id))
    }

    expect(text("[data-e2e=overview-all-hidden]")).toContain("All widgets are hidden")
    expect(focused()).toBe("overview-all-hidden-customise")
  })

  it("customises the layout from More actions, saving each switch as it is flipped", async () => {
    const seen = await mount()

    await clickOn(find("[data-e2e=overview-menu]"))
    await clickText("Customise overview")
    const dialog = find<HTMLDialogElement>("dialog[data-e2e=overview-customiser]")
    expect(dialog.open).toBe(true)
    await clickOn(find('[data-e2e=overview-customiser] [aria-label="Show Notes added"]'))

    expect(seen.layouts.at(-1)).toEqual([
      { id: total, hidden: false },
      { id: added, hidden: true },
      { id: series, hidden: false },
    ])
    expect(document.querySelectorAll(card(added)).length).toBe(0)

    await clickText("Done", "dialog[data-e2e=overview-customiser]")
    expect(dialog.open).toBe(false)
  })

  it("resets the layout and copies the link from More actions", async () => {
    const seen = await mount()

    await clickOn(find("[data-e2e=overview-menu]"))
    await clickText("Reset layout")
    await clickOn(find("[data-e2e=overview-menu]"))
    await clickText("Copy link to this view")

    expect(seen).toMatchObject({ resets: 1, copies: 1 })
  })

  it("greets an empty group with New note for a person who can add one, its label always shown", async () => {
    await mount(READY, { emptyGroup: { canCreate: true } })

    expect(text("[data-e2e=overview-empty-group]")).toContain("No notes in Acme Studio yet")
    const action = find("[data-e2e=overview-new-note]")
    expect(action.getAttribute("href")).toBe("/notes/new")
    expect(action.textContent).toBe("New note")
    expect(action.querySelectorAll(".sr-only, [class*='sr-only']").length).toBe(0)
  })

  it("offers a viewer of an empty group no New note", async () => {
    await mount(READY, { emptyGroup: { canCreate: false } })

    expect(document.querySelectorAll("[data-e2e=overview-new-note]").length).toBe(0)
  })

  it("tells a person outside the group that it does not exist", async () => {
    await mount(READY, { group: null })

    expect(document.body.textContent).toContain("This group does not exist.")
    expect(document.querySelectorAll("[data-widget-status]").length).toBe(0)
  })

  it("asks for a shorter range instead of loading one longer than a year", async () => {
    await mount(READY, {
      range: { preset: "custom", range: { from: "2025-01-01", to: "2026-10-21" } },
    })

    expect(text("[data-e2e=overview-period]")).toBe("Choose a range of a year or less.")
    expect(document.querySelectorAll("[data-widget-status]").length).toBe(0)
  })
})

describe("the admin group page's overview widgets", () => {
  it("shows every widget in the default layout, read-only, with what the section is", async () => {
    root = document.createElement("div")
    document.body.append(root)
    await act(() =>
      render(
        <FormatContext.Provider
          value={createFormatters({ locale: "en-GB", timeZone: "UTC", hourCycle: null })}
        >
          <AdminGroupOverview
            groupName="Acme Studio"
            range={LAST_30}
            timeZone="UTC"
            now={NOW}
            onRangeChange={() => {}}
            widgets={OVERVIEW_WIDGETS.map((widget) => ({ ...widget, load: READY[widget.id] }))}
            views={OVERVIEW_VIEWS}
            onRetry={() => {}}
          />
        </FormatContext.Provider>,
        root!,
      )
    )

    expect(text("[data-e2e=admin-group-overview] h2")).toBe("Overview widgets")
    expect(text("[data-e2e=admin-group-overview]")).toContain("Their layouts are not shown here.")
    expect(document.querySelectorAll("[data-widget-status=ready]")).toHaveLength(3)
    expect(document.querySelectorAll("[data-widget-status] button[aria-haspopup]").length).toBe(0)
  })
})
