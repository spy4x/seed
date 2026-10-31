/**
 * The benchmark screen, `BenchmarkScreen`, in a browser DOM (happy-dom): choose a group, run, stop,
 * and where focus goes as the run starts and ends; a refused copy selects the results line.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  BENCHMARK_STEPS,
  BenchmarkScreen,
  type BenchmarkScreenProps,
  type BenchmarkStep,
} from "./benchmark-screen.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with `new FormData(form)`, which only
  // the DOM's own FormData can do. A link is routed only when it points at the page's own origin
  // (`location`), and a dialog locks the page's scroll after reading its style (`getComputedStyle`).
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
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

/** Renders `node` into a fresh element in the page, effects run. */
async function mount(node: VNode): Promise<void> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
}

/** Renders `node` in place of what `mount` drew, the way an app re-renders with new props. */
async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

/** The one element `selector` finds in the page, or a failure naming it. */
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

/** How many elements `selector` finds in the page. */
function count(selector: string): number {
  return document.querySelectorAll(selector).length
}

/** Clicks `element` and returns whether its default action was cancelled. */
async function clickOn(element: Element): Promise<boolean> {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(() => {
    element.dispatchEvent(event as unknown as Event)
  })
  return event.defaultPrevented
}

/** Clicks the element `selector` finds. */
function click(selector: string): Promise<boolean> {
  return clickOn(find(selector))
}

/** Submits the form that holds the element `selector` finds, and lets its callback run. */
async function submit(selector: string): Promise<boolean> {
  const form = find(selector).closest("form")!
  form.querySelector<HTMLButtonElement>("button[type=submit]")?.focus()
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event.defaultPrevented
}

/** What has focus: its `data-e2e`, or its tag name when it has none. */
function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

const groups = [
  { id: "small", name: "Family", notes: 12 },
  { id: "large", name: "Load test M: 10,000 notes", notes: 10000 },
]
const pending: BenchmarkStep[] = BENCHMARK_STEPS.map((id) => ({ id, state: "pending" }))
const done: BenchmarkStep[] = BENCHMARK_STEPS.map((id) => ({ id, state: "done", value: 1 }))
const json = `{"v":1,"runId":"r"}`

function screen(props: Partial<BenchmarkScreenProps> = {}): VNode {
  return (
    <BenchmarkScreen
      groups={groups}
      selectedId={null}
      state="idle"
      steps={pending}
      device={{ browser: "TestBrowser/1", cores: 8, memory: 16, connection: "4g" }}
      generatorCommand="deno task load:group M"
      {...props}
    />
  )
}

describe("BenchmarkScreen", () => {
  it("lists the largest group first, chooses one and runs it through its callbacks", async () => {
    const chosen: string[] = []
    let runs = 0
    await mount(screen({ onSelect: (id) => chosen.push(id), onRun: () => runs++ }))
    const options = [...document.querySelectorAll("[data-e2e=benchmark-group] option")]
      .map((option) => option.getAttribute("value")).filter(Boolean)
    expect(options).toEqual(["large", "small"])
    const select = find<HTMLSelectElement>("[data-e2e=benchmark-group]")
    select.value = "large"
    await act(() => {
      select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    })
    expect(chosen).toEqual(["large"])
    await rerender(screen({ selectedId: "large", onRun: () => runs++ }))
    await submit("[data-e2e=benchmark-run]")
    expect(runs).toBe(1)
  })

  it("moves focus to Stop once the run starts, and to the summary once it ends", async () => {
    let stops = 0
    await mount(screen({ selectedId: "large" }))
    const running = pending.map((step, index) =>
      index === 0 ? { ...step, state: "running" as const } : step
    )
    await rerender(
      screen({ selectedId: "large", state: "running", steps: running, onStop: () => stops++ }),
    )
    expect(focused()).toBe("benchmark-stop")
    expect(count("[data-e2e=benchmark-run]")).toBe(0)
    await click("[data-e2e=benchmark-stop]")
    expect(stops).toBe(1)
    await rerender(
      screen({ selectedId: "large", state: "done", steps: done, json, durationMs: 4200 }),
    )
    expect(focused()).toBe("benchmark-summary")
    expect(find("[data-e2e=benchmark-summary]").textContent).toContain("6 of 6")
  })

  it("selects the results line when the browser refuses to copy it", async () => {
    await mount(screen({ state: "done", steps: done, json, copy: () => false }))
    await click("[data-e2e=benchmark-copy]")
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    const line = find<HTMLTextAreaElement>("[data-e2e=benchmark-json]")
    expect([line.selectionStart, line.selectionEnd]).toEqual([0, json.length])
  })

  it("says the device is offline when Run again finds no connection", async () => {
    await mount(screen({ state: "done", steps: done, json }))
    expect(count("[data-e2e=benchmark-offline]")).toBe(0)
    await rerender(screen({ state: "done", steps: done, json, formError: "offline" }))
    expect(find("[data-e2e=benchmark-offline]").textContent).toContain("You need a connection")
  })

  it("moves focus to the offline warning on every Run the app refuses for it", async () => {
    let formError: BenchmarkScreenProps["formError"] = null
    const idle = () =>
      screen({ selectedId: "large", formError, onRun: () => formError = "offline" })
    await mount(idle())
    await submit("[data-e2e=benchmark-run]")
    await rerender(idle())
    expect(focused()).toBe("benchmark-offline")
    await submit("[data-e2e=benchmark-run]")
    await rerender(idle())
    expect(focused()).toBe("benchmark-offline")
  })

  it("moves focus to the offline warning when Run again finds no connection", async () => {
    let formError: BenchmarkScreenProps["formError"] = null
    const ended = () =>
      screen({ state: "done", steps: done, json, formError, onRun: () => formError = "offline" })
    await mount(ended())
    await click("[data-e2e=benchmark-run-again]")
    await rerender(ended())
    expect(focused()).toBe("benchmark-offline")
  })

  it("moves focus to the group field when Run is pressed with no group chosen", async () => {
    let formError: BenchmarkScreenProps["formError"] = null
    const idle = () => screen({ formError, onRun: () => formError = "noGroup" })
    await mount(idle())
    await submit("[data-e2e=benchmark-run]")
    await rerender(idle())
    expect(focused()).toBe("benchmark-group")
    expect(find("[data-e2e=benchmark-group]").getAttribute("aria-invalid")).toBe("true")
  })

  it("moves focus to Run once the warning about a closed tab's run is dismissed", async () => {
    const stoppedRun = {
      step: "save" as const,
      group: "Load test S",
      startedAt: "2026-10-31T10:00:00Z",
      json,
    }
    await mount(screen({ stoppedRun }))
    find<HTMLButtonElement>("[data-e2e=benchmark-dismiss-stopped]").focus()
    await click("[data-e2e=benchmark-dismiss-stopped]")
    await rerender(screen())
    expect(focused()).toBe("benchmark-run")
  })

  it("puts focus on the warning about a run a closed tab left behind", async () => {
    await mount(screen({
      stoppedRun: { step: "save", group: "Load test S", startedAt: "2026-10-31T10:00:00Z", json },
    }))
    expect(focused()).toBe("benchmark-last-stopped")
    expect(find("[data-e2e=benchmark-last-stopped]").textContent).toContain("Save to this device")
  })

  it("offers the generator's command only while no group is large enough to measure", async () => {
    await mount(screen({ groups: [groups[0]] }))
    expect(find("[data-e2e=benchmark-no-large-group]").textContent).toContain(
      "deno task load:group M",
    )
    await rerender(screen())
    expect(count("[data-e2e=benchmark-no-large-group]")).toBe(0)
  })

  it("waits for every group's count before saying no group is large", async () => {
    await mount(screen({ groups: [groups[0], { ...groups[1], notes: null }] }))
    expect(count("[data-e2e=benchmark-no-large-group]")).toBe(0)
  })
})
