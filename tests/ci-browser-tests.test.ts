/// <reference lib="deno.ns" />
/**
 * Holds which browser tests CI runs. A merge is allowed on the pull-request check alone, so that
 * check must run the smoke set (`SMOKE_SPECS` of `infra/scripts/e2e-local-plan.ts`), and the set
 * must keep the sign-in and the notes specs: without either, a pull request that breaks that
 * screen shows green again. The whole suite runs after the merge, on `main`, where a red run is
 * seen but blocks nobody. `docs/browser-tests.md` and `docs/woodpecker-ci-setup.md` name the specs
 * of the set. Lighthouse measures in a stage of its own, with no other step of the pipeline beside
 * it. A pull request runs it only when it changes a file the website is built from (#821); a push
 * to `main` and a tag always run it, and the e2e steps run whether it ran or not.
 */

import { expect } from "@std/expect"
import { fromFileUrl, globToRegExp } from "@std/path"
import { parse } from "@std/yaml"
import { SMOKE_FLAG, SMOKE_SPECS } from "../infra/scripts/e2e-local-plan.ts"

const ROOT = new URL("../", import.meta.url)
const read = (path: string) => Deno.readTextFile(fromFileUrl(new URL(path, ROOT)))

const CI = ".woodpecker/ci.yml"
// Both stop after a few failed tests: with sign-in broken every test fails slowly, and a red
// check must not take the step's whole limit.
const SUITE = "deno task e2e:local --max-failures=10"
const SMOKE = `deno task e2e:local ${SMOKE_FLAG} --max-failures=3`

/** One condition of a Woodpecker `when`. `path` is the list form: include patterns only. */
interface Condition {
  event?: string | string[]
  branch?: string | string[]
  path?: string | string[]
}

/** A `depends_on` entry: a step's name, or an object that may mark the dependency optional. */
type Dependency = string | { name: string; optional?: boolean }

/** The parts of a Woodpecker step, or of the workflow itself, that these tests read. */
export interface Step {
  when?: Condition | Condition[]
  commands?: string[]
  failure?: string
  depends_on?: Dependency | Dependency[]
}

const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/**
 * Whether a `path` condition holds for the `changed` files, as Woodpecker 3's `Path.Match` decides:
 * no pattern, or no changed file (`on_empty` defaults to true), holds; otherwise one changed file
 * must match one pattern, `**` crossing folders and `*` not.
 */
function pathHolds(patterns: string[], changed: string[]): boolean {
  if (patterns.length === 0 || changed.length === 0) return true
  const globs = patterns.map((pattern) => globToRegExp(pattern, { globstar: true }))
  return changed.some((file) => globs.some((glob) => glob.test(file)))
}

/**
 * Whether `step` runs for `event` on `branch` when the commit or pull request changes the files
 * `changed`. A step without `when` runs for every event, and a condition without `branch` holds on
 * every branch. Branch patterns are compared as plain names: this pipeline uses no glob. As in
 * Woodpecker, `path` counts on a pull request and a push only, never on a tag.
 */
export function runsFor(
  step: Step,
  event: string,
  branch: string,
  changed: string[] = [],
): boolean {
  const conditions = list(step.when)
  if (conditions.length === 0) return true
  return conditions.some((condition) => {
    const events = list(condition.event)
    const branches = list(condition.branch)
    const pathCounts = event === `pull_request` || event === `push`
    return (events.length === 0 || events.includes(event)) &&
      (branches.length === 0 || branches.includes(branch)) &&
      (!pathCounts || pathHolds(list(condition.path), changed))
  })
}

/** Whether one of the step's commands is exactly `command`. A command in a comment is none. */
export function runs(step: Step, command: string): boolean {
  return list(step.commands).some((line) => line.trim() === command)
}

/** The names of the steps that run `command` for `event` on `branch` and fail the pipeline. */
export function blockingSteps(
  workflow: Step & { steps?: Record<string, Step> },
  command: string,
  event: string,
  branch: string,
  changed: string[] = [],
): string[] {
  if (!runsFor(workflow, event, branch, changed)) return []
  return Object.entries(workflow.steps ?? {})
    .filter(([, step]) =>
      runs(step, command) && runsFor(step, event, branch, changed) && step.failure !== "ignore"
    )
    .map(([name]) => name)
}

/**
 * The stages Woodpecker runs for `event` on `branch` when `changed` files changed, as lists of step
 * names. A step's stage is one past the latest stage of the steps it depends on, and a stage starts
 * only when the one before it has ended (the top of `.woodpecker/ci.yml`). As in Woodpecker 3, a
 * dependency on a step that does not run is dropped when it is optional, and fails the whole
 * pipeline otherwise: this throws then.
 */
export function stages(
  workflow: Step & { steps?: Record<string, Step> },
  event: string,
  branch: string,
  changed: string[] = [],
): string[][] {
  const steps = Object.entries(workflow.steps ?? {}).filter(([, step]) =>
    runsFor(step, event, branch, changed)
  )
  const names = new Set(steps.map(([name]) => name))
  const levels = new Map<string, number>()
  const level = (name: string): number => {
    const known = levels.get(name)
    if (known !== undefined) return known
    const deps = list(workflow.steps?.[name]?.depends_on).flatMap((dep) => {
      const { name: on, optional = false } = typeof dep === `string` ? { name: dep } : dep
      if (names.has(on)) return [on]
      if (optional) return []
      throw new Error(`${name} depends on ${on}, which does not run`)
    })
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(level))
    levels.set(name, value)
    return value
  }
  const result: string[][] = []
  for (const [name] of steps) (result[level(name)] ??= []).push(name)
  return result.filter(Boolean)
}

const workflow = async () => parse(await read(CI)) as Step & { steps?: Record<string, Step> }

Deno.test("a step runs for an event when it has no condition or one condition names the event and the branch", () => {
  expect(runsFor({}, "pull_request", "main")).toBe(true)
  expect(runsFor({ when: { event: "push", branch: "main" } }, "push", "main")).toBe(true)
  expect(runsFor({ when: { event: "push", branch: "main" } }, "push", "feature")).toBe(false)
  expect(runsFor({ when: { event: "push", branch: "main" } }, "pull_request", "main")).toBe(false)
  expect(runsFor({ when: [{ event: ["pull_request", "tag"] }] }, "tag", "main")).toBe(true)
  expect(runsFor({ when: [{ event: "tag" }, { event: "pull_request" }] }, "pull_request", "x"))
    .toBe(true)
  expect(runsFor({ when: [{ event: "tag" }] }, "pull_request", "main")).toBe(false)
})

Deno.test("a command counts only as a whole line, and a step that ignores its failure blocks nothing", () => {
  expect(runs({ commands: [`  ${SMOKE}  `] }, SMOKE)).toBe(true)
  expect(runs({ commands: [`# ${SMOKE}`] }, SMOKE)).toBe(false)
  expect(runs({ commands: [`${SUITE} ${SMOKE_FLAG}`] }, SUITE)).toBe(false)
  expect(runs({ commands: [`${SMOKE} || true`] }, SMOKE)).toBe(false)
  const steps = { smoke: { commands: [SMOKE], failure: "ignore" } }
  expect(blockingSteps({ steps }, SMOKE, "pull_request", "main")).toEqual([])
  const off = { when: { event: "push" }, steps: { smoke: { commands: [SMOKE] } } }
  expect(blockingSteps(off, SMOKE, "pull_request", "main")).toEqual([])
})

Deno.test("a step's stage comes after the latest stage of its dependencies, and a step that does not run has none", () => {
  const steps = {
    a: {},
    b: { depends_on: [`a`] },
    c: { depends_on: [`a`] },
    d: { depends_on: [`b`, `c`] },
    off: { when: { event: `push` }, depends_on: [`a`] },
  }
  expect(stages({ steps }, `pull_request`, `main`)).toEqual([[`a`], [`b`, `c`], [`d`]])
})

Deno.test("a dependency on a step that does not run is dropped when optional and fails the pipeline otherwise", () => {
  const off = { when: { event: `push` } }
  const optional = {
    steps: { a: {}, off, e: { depends_on: [`a`, { name: `off`, optional: true }] } },
  }
  expect(stages(optional, `pull_request`, `main`)).toEqual([[`a`], [`e`]])
  const required = { steps: { a: {}, off, e: { depends_on: [`a`, `off`] } } }
  expect(() => stages(required, `pull_request`, `main`)).toThrow(`e depends on off`)
})

Deno.test("a path condition needs one changed file to match on a pull request or a push, and counts on no tag", () => {
  const step = { when: { path: [`apps/mpa/**`, `docs/*.md`, `deno.lock`] } }
  expect(runsFor(step, `pull_request`, `x`, [`apps/mpa/routes/deep/index.tsx`])).toBe(true)
  expect(runsFor(step, `pull_request`, `x`, [`apps/api/x.ts`, `docs/billing.md`])).toBe(true)
  expect(runsFor(step, `push`, `main`, [`deno.lock`])).toBe(true)
  expect(runsFor(step, `pull_request`, `x`, [`apps/api/x.ts`])).toBe(false)
  expect(runsFor(step, `pull_request`, `x`, [`docs/screenshots/a.png`])).toBe(false)
  expect(runsFor(step, `push`, `main`, [`apps/mpa-other/x.ts`])).toBe(false)
  // No changed file listed: Woodpecker's `on_empty` defaults to running the step.
  expect(runsFor(step, `pull_request`, `x`, [])).toBe(true)
  expect(runsFor(step, `tag`, `x`, [`apps/api/x.ts`])).toBe(true)
})

/** The stage of `name` in `list`, or -1 when it does not run. */
const stageOf = (list: string[][], name: string) => list.findIndex((names) => names.includes(name))

Deno.test("Lighthouse measures in a stage of its own on every event that runs it", async () => {
  // Lab performance falls when another step shares the CPU, and the budget then fails on noise.
  const ci = await workflow()
  const website = [`apps/mpa/routes/index.tsx`]
  for (const event of [`pull_request`, `push`, `tag`]) {
    const [step] = blockingSteps(ci, `deno task lighthouse`, event, `main`, website)
    const stage = stages(ci, event, `main`, website).find((names) => names.includes(step))
    expect({ event, stage }).toEqual({ event, stage: [`lighthouse`] })
  }
})

Deno.test("a pull request that changes only the API runs no Lighthouse and still runs the smoke set after browser", async () => {
  const ci = await workflow()
  const changed = [`apps/api/x.ts`]
  expect(blockingSteps(ci, `deno task lighthouse`, `pull_request`, `main`, changed)).toEqual([])
  expect(blockingSteps(ci, SMOKE, `pull_request`, `main`, changed)).toEqual([`e2e-smoke`])
  const order = stages(ci, `pull_request`, `main`, changed)
  expect(stageOf(order, `e2e-smoke`)).toBeGreaterThan(stageOf(order, `browser`))
  // e2e-smoke shares its stage with no other step, as it did after Lighthouse.
  expect(order[stageOf(order, `e2e-smoke`)]).toEqual([`e2e-smoke`])
})

Deno.test("a pull request that changes the website, a published guide or the lockfile runs Lighthouse", async () => {
  const ci = await workflow()
  for (const file of [`apps/mpa/routes/index.tsx`, `docs/billing.md`, `deno.lock`]) {
    const steps = blockingSteps(ci, `deno task lighthouse`, `pull_request`, `main`, [file])
    expect({ file, steps }).toEqual({ file, steps: [`lighthouse`] })
  }
})

Deno.test("a push to main and a tag run Lighthouse whatever they change", async () => {
  const ci = await workflow()
  for (const event of [`push`, `tag`]) {
    const steps = blockingSteps(ci, `deno task lighthouse`, event, `main`, [`apps/api/x.ts`])
    expect({ event, steps }).toEqual({ event, steps: [`lighthouse`] })
  }
})

Deno.test("the smoke set holds the sign-in and the notes specs", () => {
  expect(SMOKE_SPECS).toContain("auth-profile-ws-push.e2e.ts")
  expect(SMOKE_SPECS).toContain("sign-in-next.e2e.ts")
  expect(SMOKE_SPECS).toContain("notes.e2e.ts")
})

Deno.test("every spec of the smoke set is a file in e2e/", async () => {
  // A name with no file would go to Playwright as a filter that matches nothing, and the run
  // would still pass on the other specs.
  for (const name of SMOKE_SPECS) {
    const info = await Deno.stat(fromFileUrl(new URL(`e2e/${name}`, ROOT))).catch(() => null)
    expect({ name, isFile: info?.isFile ?? false }).toEqual({ name, isFile: true })
  }
})

Deno.test("a pull request runs the smoke set in a step that fails the pipeline", async () => {
  expect(blockingSteps(await workflow(), SMOKE, "pull_request", "main")).toEqual(["e2e-smoke"])
})

Deno.test("a push to main runs the whole suite, and a pull request does not wait for it", async () => {
  const ci = await workflow()
  expect(blockingSteps(ci, SUITE, "push", "main")).toEqual(["e2e-full"])
  expect(blockingSteps(ci, SUITE, "pull_request", "main")).toEqual([])
  // A release waits for this workflow: the whole suite must not stand between a tag and its
  // images, and the smoke set must.
  expect(blockingSteps(ci, SUITE, "tag", "main")).toEqual([])
  expect(blockingSteps(ci, SMOKE, "tag", "main")).toEqual(["e2e-smoke"])
})

Deno.test("the browser-test guide and the CI guide name every spec of the smoke set", async () => {
  for (const path of ["docs/browser-tests.md", "docs/woodpecker-ci-setup.md"]) {
    const text = await read(path)
    const missing = SMOKE_SPECS.filter((name) => !text.includes(name))
    expect({ path, missing }).toEqual({ path, missing: [] })
  }
})
