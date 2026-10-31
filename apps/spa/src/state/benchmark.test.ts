import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { BENCHMARK_STEPS, type BenchmarkStepId } from "@ui/benchmark-screen.tsx"
import {
  failReason,
  type Measured,
  type Measures,
  type RecordStore,
  runBenchmark,
  type RunOptions,
  StepFailure,
  stoppedRun,
  tierOf,
} from "./benchmark.ts"

/** A record store in memory, which also keeps every write. */
function memoryStore(initial: string | null = null): RecordStore & { writes: string[] } {
  let value = initial
  const writes: string[] = []
  return {
    writes,
    read: () => value,
    write(next) {
      value = next
      writes.push(next)
    },
    remove() {
      value = null
    },
  }
}

/** Every measure answering `{ value: 1 }`, with `overrides` in place of some. */
function measures(
  overrides: Partial<Record<BenchmarkStepId, () => Promise<Measured>>> = {},
): Measures {
  return Object.fromEntries(
    BENCHMARK_STEPS.map((id) => [id, overrides[id] ?? (() => Promise.resolve({ value: 1 }))]),
  ) as unknown as Measures
}

const group = {
  id: `0190f3c4-0000-7000-8000-000000000001`,
  name: `Load test S: 1,000 notes`,
  notes: 1000,
}

function options(overrides: Partial<RunOptions> = {}): RunOptions {
  let clock = 0
  return {
    runId: `0190f3c4-0000-7000-8000-0000000000aa`,
    group,
    device: { browser: `TestBrowser/1`, cores: 8, memory: 16, connection: `4g` },
    measures: measures(),
    signal: new AbortController().signal,
    online: () => true,
    onChange: () => {},
    store: memoryStore(),
    now: () => (clock += 10),
    startedAt: new Date(`2026-10-31T10:00:00Z`),
    ...overrides,
  }
}

describe("runBenchmark", () => {
  it("runs every measure in order and leaves no record behind once done", async () => {
    const order: string[] = []
    const store = memoryStore()
    const run = await runBenchmark(options({
      store,
      measures: measures(Object.fromEntries(
        BENCHMARK_STEPS.map((id) => [id, () => (order.push(id), Promise.resolve({ value: 1 }))]),
      )),
    }))
    expect(order).toEqual([...BENCHMARK_STEPS])
    expect(run.state).toBe(`done`)
    expect(run.steps.every((step) => step.state === `done`)).toBe(true)
    expect(store.read()).toBe(null)
  })

  it("has the record name each step on this device before that step runs", async () => {
    const store = memoryStore()
    const named: (string | null)[] = []
    await runBenchmark(options({
      store,
      measures: measures(Object.fromEntries(BENCHMARK_STEPS.map((id) => [id, () => {
        named.push(JSON.parse(store.read() ?? `{"step":null}`).step)
        return Promise.resolve({ value: 1 })
      }]))),
    }))
    expect(named).toEqual([...BENCHMARK_STEPS])
  })

  it("marks the running step stopped on Stop and leaves the rest not measured", async () => {
    const controller = new AbortController()
    const run = await runBenchmark(options({
      signal: controller.signal,
      measures: measures({
        scroll: () => {
          controller.abort()
          return Promise.reject(new Error(`aborted`))
        },
      }),
    }))
    expect(run.state).toBe(`stopped`)
    const states = Object.fromEntries(run.steps.map((step) => [step.id, step.state]))
    expect(states.firstNotes).toBe(`done`)
    expect(states.scroll).toBe(`stopped`)
    expect(states.search).toBe(`pending`)
    expect(JSON.parse(run.json).stoppedAt).toBe(`scroll`)
  })

  it("keeps measuring after a later step fails, and names that step and its reason", async () => {
    const run = await runBenchmark(options({
      measures: measures({ scroll: () => Promise.reject(new StepFailure(`hidden`, `tab hidden`)) }),
    }))
    expect(run.state).toBe(`failed`)
    expect(run.failure).toEqual({ step: `scroll`, reason: `hidden` })
    expect(run.steps.find((step) => step.id === `search`)?.state).toBe(`done`)
  })

  it("ends at a failed download, since the steps after it have nothing to measure", async () => {
    const run = await runBenchmark(options({
      online: () => false,
      measures: measures({ download: () => Promise.reject(new TypeError(`Failed to fetch`)) }),
    }))
    expect(run.failure).toEqual({ step: `download`, reason: `offline` })
    expect(run.steps.slice(1).every((step) => step.state === `pending`)).toBe(true)
  })

  it("draws a measure the browser does not report as unavailable", async () => {
    const run = await runBenchmark(options({
      measures: measures({ memory: () => Promise.resolve(`unavailable`) }),
    }))
    expect(run.steps.find((step) => step.id === `memory`)?.state).toBe(`unavailable`)
    expect(run.state).toBe(`done`)
  })
})

describe("failReason", () => {
  it("names offline first, then storage for a full disk, then the browser", () => {
    expect(failReason(new DOMException(`full`, `QuotaExceededError`), true)).toBe(`storage`)
    expect(failReason(new Error(`odd`), true)).toBe(`browser`)
    expect(failReason(new Error(`odd`), false)).toBe(`offline`)
  })
})

describe("the results line", () => {
  it("carries the group's name and size, the measures and the device, and nothing about the person", async () => {
    const run = await runBenchmark(options())
    const line = JSON.parse(run.json)
    expect(Object.keys(line).sort()).toEqual(
      [`device`, `durationMs`, `errors`, `group`, `measures`, `runId`, `startedAt`, `v`],
    )
    expect(line.group).toEqual({ name: group.name, notes: 1000, tier: `S` })
    expect(Object.keys(line.device).sort()).toEqual([
      `connection`,
      `cores`,
      `memoryGb`,
      `userAgent`,
    ])
    expect(run.json).not.toContain(group.id)
    expect(line.measures.download).toEqual({ state: `done`, ms: 1, withinBudget: true })
    expect(line.measures.scroll).toEqual({ state: `done`, droppedPercent: 1, withinBudget: true })
  })
})

describe("stoppedRun", () => {
  it("shows where a run that a closed tab left behind stopped", async () => {
    const store = memoryStore()
    let reached: () => void = () => {}
    const onSave = new Promise<void>((resolve) => reached = resolve)
    // The save never answers, so the run stays on it, as in a tab that died there.
    void runBenchmark(options({
      store,
      measures: measures({ save: () => (reached(), new Promise(() => {})) }),
    }))
    await onSave
    const left = stoppedRun(store)
    expect(left?.step).toBe(`save`)
    expect(left?.group).toBe(group.name)
    expect(JSON.parse(left!.json).stoppedAt).toBe(`save`)
  })

  it("removes a record it cannot read", () => {
    const store = memoryStore(`{not json`)
    expect(stoppedRun(store)).toBe(null)
    expect(store.read()).toBe(null)
  })
})

describe("tierOf", () => {
  it("reads the tier from the generator's group name, and nothing from any other name", () => {
    expect(tierOf(`Load test XL: 1,000,000 notes`)).toBe(`XL`)
    expect(tierOf(`Family`)).toBe(null)
  })
})
