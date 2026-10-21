/// <reference lib="deno.ns" />
/**
 * Holds which browser tests CI runs. A merge is allowed on the pull-request check alone, so that
 * check must run the smoke set (`SMOKE_SPECS` of `infra/scripts/e2e-local-plan.ts`), and the set
 * must keep the sign-in and the notes specs: without either, a pull request that breaks that
 * screen shows green again. The whole suite runs after the merge, on `main`, where a red run is
 * seen but blocks nobody. `docs/development.md` and `docs/woodpecker-ci-setup.md` name the specs
 * of the set.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"
import { SMOKE_FLAG, SMOKE_SPECS } from "../infra/scripts/e2e-local-plan.ts"

const ROOT = new URL("../", import.meta.url)
const read = (path: string) => Deno.readTextFile(fromFileUrl(new URL(path, ROOT)))

const CI = ".woodpecker/ci.yml"
// Both stop after a few failed tests: with sign-in broken every test fails slowly, and a red
// check must not take the step's whole limit.
const SUITE = "deno task e2e:local --max-failures=10"
const SMOKE = `deno task e2e:local ${SMOKE_FLAG} --max-failures=3`

/** One condition of a Woodpecker `when`. */
interface Condition {
  event?: string | string[]
  branch?: string | string[]
}

/** The parts of a Woodpecker step, or of the workflow itself, that these tests read. */
export interface Step {
  when?: Condition | Condition[]
  commands?: string[]
  failure?: string
  depends_on?: string[]
}

const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/**
 * Whether `step` runs for `event` on `branch`. A step without `when` runs for every event, and a
 * condition without `branch` holds on every branch. Branch patterns are compared as plain names:
 * this pipeline uses no glob.
 */
export function runsFor(step: Step, event: string, branch: string): boolean {
  const conditions = list(step.when)
  if (conditions.length === 0) return true
  return conditions.some((condition) => {
    const events = list(condition.event)
    const branches = list(condition.branch)
    return (events.length === 0 || events.includes(event)) &&
      (branches.length === 0 || branches.includes(branch))
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
): string[] {
  if (!runsFor(workflow, event, branch)) return []
  return Object.entries(workflow.steps ?? {})
    .filter(([, step]) =>
      runs(step, command) && runsFor(step, event, branch) && step.failure !== "ignore"
    )
    .map(([name]) => name)
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

Deno.test("the development guide and the CI guide name every spec of the smoke set", async () => {
  for (const path of ["docs/development.md", "docs/woodpecker-ci-setup.md"]) {
    const text = await read(path)
    const missing = SMOKE_SPECS.filter((name) => !text.includes(name))
    expect({ path, missing }).toEqual({ path, missing: [] })
  }
})
