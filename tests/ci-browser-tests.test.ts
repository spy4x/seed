/// <reference lib="deno.ns" />
/**
 * Holds which browser tests CI runs. CI is two workflows that run at the same time:
 * `.woodpecker/ci.yml` (`check`, `secrets`, the stack's steps and the images) and
 * `.woodpecker/ci-browser.yml` (`browser`, `lighthouse`, `e2e-smoke`, `e2e-full`). A merge is
 * allowed on their pull-request checks alone, so ci-browser must run the smoke set (`SMOKE_SPECS` of `infra/scripts/e2e-local-plan.ts`), and the set
 * must keep the sign-in and the notes specs: without either, a pull request that breaks that
 * screen shows green again. The one exception is a pull request that changes only Markdown
 * outside the product (`markdown_only` and `internal_markdown` in the workflow): it skips the
 * steps that start the stack, and runs `browser` only when it changes a published guide; ci-browser
 * still runs its `ready` step, so its required status arrives. A push to `main` runs only
 * `check`, `secrets` and the images, and creates no ci-browser workflow. The whole suite runs in the nightly cron
 * run on `main`, where a red run is seen but blocks nobody and no push cancels it.
 * `docs/browser-tests.md` and `docs/woodpecker-ci-setup.md` name the specs of the set. Lighthouse
 * measures in a stage of its own, with no other step of its workflow beside it. A pull request
 * runs it only when it changes a file the website is built from (#821); the nightly run and a tag
 * always run it, and the e2e steps run whether it ran or not. A pull request runs the smoke set
 * beside `browser`, on a Valkey service of its own, and Lighthouse after both. A pull request measures only the
 * quick pages (#876). A pull request builds the four images only when it changes what decides
 * whether an image builds: the four Dockerfiles, `.dockerignore`, `deno.jsonc`, `deno.lock` and
 * the workflow. A source change that breaks a bundle is caught by the push to `main`, which, like
 * a tag, always builds them (https://github.com/spy4x/ringmaster/issues/296). A pull request
 * titled `[WIP]` runs only `check` and `secrets` (`.woodpecker/wip.yml`, copies of ci.yml's), and
 * removing `[WIP]` from the title (`pull_request_metadata`) runs the same steps as a pull request
 * (#1058), in both workflows. A release waits for both (`.woodpecker/release.yml`).
 */

import { expect } from "@std/expect"
import { fromFileUrl, globToRegExp } from "@std/path"
import { parse } from "@std/yaml"
import { SMOKE_FLAG, SMOKE_SPECS } from "../infra/scripts/e2e-local-plan.ts"

const ROOT = new URL("../", import.meta.url)
const read = (path: string) => Deno.readTextFile(fromFileUrl(new URL(path, ROOT)))

const CI = ".woodpecker/ci.yml"
const BROWSER = ".woodpecker/ci-browser.yml"
// Both stop after a few failed tests: with sign-in broken every test fails slowly, and a red
// check must not take the step's whole limit.
const SUITE = "deno task e2e:local --max-failures=10"
const SMOKE = `deno task e2e:local ${SMOKE_FLAG} --max-failures=3`

/** A `path` condition: the list form holds include patterns only. */
type PathCondition = string | string[] | {
  include?: string | string[]
  exclude?: string | string[]
}

/** One condition of a Woodpecker `when`. */
interface Condition {
  event?: string | string[]
  branch?: string | string[]
  path?: PathCondition
  evaluate?: string
}

/** A `depends_on` entry: a step's name, or an object that may mark the dependency optional. */
type Dependency = string | { name: string; optional?: boolean }

/** The parts of a Woodpecker step, or of the workflow itself, that these tests read. */
export interface Step {
  when?: Condition | Condition[]
  commands?: string[]
  failure?: string
  depends_on?: Dependency | Dependency[]
  environment?: Record<string, string>
}

const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/**
 * Whether a `path` condition holds for the `changed` files, as Woodpecker 3's `Path.Match` decides:
 * no changed file (`on_empty` defaults to true) holds; it fails when every changed file matches an
 * exclude pattern, or when include patterns are given and no changed file matches one. `**`
 * crosses folders and `*` does not.
 */
function pathHolds(path: PathCondition | undefined, changed: string[]): boolean {
  if (changed.length === 0) return true
  const form = typeof path === `object` && !Array.isArray(path) ? path : { include: path }
  const matcher = (patterns: string[]) => {
    const globs = patterns.map((pattern) => globToRegExp(pattern, { globstar: true }))
    return (file: string) => globs.some((glob) => glob.test(file))
  }
  const exclude = list(form.exclude)
  if (exclude.length > 0 && changed.every(matcher(exclude))) return false
  const include = list(form.include)
  return include.length === 0 || changed.some(matcher(include))
}

/**
 * Whether `step` runs for `event` on `branch` when the commit or pull request changes the files
 * `changed`. A step without `when` runs for every event, and a condition without `branch` holds on
 * every branch. Branch patterns are compared as plain names: this pipeline uses no glob. As in
 * Woodpecker, `path` counts on a pull request (with its title edits) and a push only, never on a
 * tag or a cron run. `evaluate` is not read: its tests compare the expressions themselves.
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
    const pathCounts = [`pull_request`, `pull_request_metadata`, `push`].includes(event)
    return (events.length === 0 || events.includes(event)) &&
      (branches.length === 0 || branches.includes(branch)) &&
      (!pathCounts || pathHolds(condition.path, changed))
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

/** A workflow: its own `when` and `depends_on`, its steps and its services. */
type Workflow = Step & { steps?: Record<string, Step>; services?: Record<string, unknown> }

const workflow = async (path = CI) => parse(await read(path)) as Workflow
const browserWorkflow = () => workflow(BROWSER)

/**
 * The steps both CI workflows run for `event` on `main` when `changed` files changed, as one list.
 * A workflow whose own `when` does not hold for the event is not created and runs nothing.
 */
async function ranInCi(event: string, changed: string[] = []): Promise<string[]> {
  const ran: string[] = []
  for (const ci of [await workflow(), await browserWorkflow()]) {
    if (runsFor(ci, event, `main`, changed)) ran.push(...stages(ci, event, `main`, changed).flat())
  }
  return ran
}

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

Deno.test("an exclude condition fails only when every changed file matches it", () => {
  const step = { when: { path: { exclude: [`*.md`, `docs/**/*.md`] } } }
  expect(runsFor(step, `pull_request`, `x`, [`README.md`, `docs/a/b.md`])).toBe(false)
  expect(runsFor(step, `pull_request`, `x`, [`README.md`, `apps/api/x.ts`])).toBe(true)
  expect(runsFor(step, `pull_request`, `x`, [`apps/README.md`])).toBe(true)
  expect(runsFor(step, `pull_request`, `x`, [])).toBe(true)
  expect(runsFor(step, `tag`, `x`, [`README.md`])).toBe(true)
})

/** The stage of `name` in `list`, or -1 when it does not run. */
const stageOf = (list: string[][], name: string) => list.findIndex((names) => names.includes(name))

Deno.test("Lighthouse measures in a stage of its own on every event that runs it, with or without browser", async () => {
  // Lab performance falls when another step shares the CPU, and the budget then fails on noise.
  // A change to i18n/*.md skips `browser` and still runs Lighthouse, which must not then share
  // the first stage with `ready`.
  const ci = await browserWorkflow()
  const cases: [string, string[]][] = [
    [`pull_request`, [`apps/mpa/routes/index.tsx`]],
    [`pull_request`, [`i18n/TRANSLATING.md`]],
    [`cron`, []],
    [`tag`, []],
  ]
  for (const [event, changed] of cases) {
    const [step] = blockingSteps(ci, `deno task lighthouse`, event, `main`, changed)
    const stage = stages(ci, event, `main`, changed).find((names) => names.includes(step))
    expect({ event, changed, stage }).toEqual({ event, changed, stage: [`lighthouse`] })
  }
})

Deno.test("a pull request runs the smoke set in the first stage beside browser, and Lighthouse only after both", async () => {
  // A pull request waits for the longer of browser and e2e-smoke, not for both one after another.
  const ci = await browserWorkflow()
  for (const changed of [[`apps/api/x.ts`], [`apps/mpa/routes/index.tsx`]]) {
    expect(blockingSteps(ci, SMOKE, `pull_request`, `main`, changed)).toEqual([`e2e-smoke`])
    const order = stages(ci, `pull_request`, `main`, changed)
    expect({ changed, first: order[0].toSorted() })
      .toEqual({ changed, first: [`browser`, `e2e-smoke`, `ready`] })
  }
  const changed = [`apps/mpa/routes/index.tsx`]
  const order = stages(ci, `pull_request`, `main`, changed)
  expect(stageOf(order, `lighthouse`)).toBeGreaterThan(stageOf(order, `e2e-smoke`))
  // Named, not only implied by the stage after `ready`, so the order holds if `ready` moves.
  expect(list(ci.steps?.lighthouse?.depends_on)).toContainEqual({
    name: `e2e-smoke`,
    optional: true,
  })
  expect(blockingSteps(ci, `deno task lighthouse`, `pull_request`, `main`, [`apps/api/x.ts`]))
    .toEqual([])
})

Deno.test("the smoke set's stack uses a Valkey service of its own, since browser runs beside it", async () => {
  // Each stack starts a worker, and a worker takes any job queued on its Valkey.
  const ci = await browserWorkflow()
  const smoke = ci.steps?.[`e2e-smoke`]?.environment?.KV_HOSTNAME
  expect(smoke).not.toBe(ci.steps?.browser?.environment?.KV_HOSTNAME)
  expect(Object.keys(ci.services ?? {})).toContain(smoke)
})

Deno.test("a pull request that changes the website, a published guide, the lockfile or ci-browser.yml runs Lighthouse", async () => {
  const ci = await browserWorkflow()
  const files = [`apps/mpa/routes/index.tsx`, `docs/billing.md`, `deno.lock`, BROWSER]
  for (const file of files) {
    const steps = blockingSteps(ci, `deno task lighthouse`, `pull_request`, `main`, [file])
    expect({ file, steps }).toEqual({ file, steps: [`lighthouse`] })
  }
})

Deno.test("the nightly run and a tag run Lighthouse whatever they change, and a push to main never", async () => {
  const ci = await browserWorkflow()
  for (const event of [`cron`, `tag`]) {
    const steps = blockingSteps(ci, `deno task lighthouse`, event, `main`, [`apps/api/x.ts`])
    expect({ event, steps }).toEqual({ event, steps: [`lighthouse`] })
  }
  const website = [`apps/mpa/routes/index.tsx`]
  expect(blockingSteps(ci, `deno task lighthouse`, `push`, `main`, website)).toEqual([])
})

Deno.test("a pull request and its title edit measure the quick pages, and the nightly run and a tag every page", async () => {
  // run.sh measures every page unless LIGHTHOUSE_PAGES=quick; only a pull request and its title
  // edit may set it.
  const commands = list((await browserWorkflow()).steps?.lighthouse?.commands).map((line) =>
    line.trim()
  )
  const at = commands.indexOf(`deno task lighthouse`)
  expect(commands.slice(at - 1, at)).toEqual([
    `case "$\${CI_PIPELINE_EVENT}" in pull_request | pull_request_metadata) export LIGHTHOUSE_PAGES=quick ;; esac`,
  ])
  expect(commands.filter((line) => line.includes(`LIGHTHOUSE_PAGES`))).toHaveLength(1)
})

const IMAGES = [`image-node`, `image-bun`, `image-mpa-node`, `image-mpa-bun`]

/** The image steps that run for `event` on `main` when `changed` files changed. */
const imagesFor = async (event: string, changed: string[]) => {
  const steps = (await workflow()).steps ?? {}
  return IMAGES.filter((name) => steps[name] && runsFor(steps[name], event, `main`, changed))
}

Deno.test("a pull request that changes only source builds no image, a push to main and a tag build all four, and the nightly run none", async () => {
  const files = [
    `docs/screenshots/a.png`,
    `README.md`,
    `tests/x.test.ts`,
    `.claude/x.md`,
    `apps/mpa/routes/index.tsx`,
    `libs/server/db/x.ts`,
    `i18n/de.json`,
    `docs/billing.md`,
    `media/demo/demo.webm`,
    `apps/api/+main.ts`,
    `infra/compose/x.yml`,
  ]
  for (const file of files) {
    expect({ file, images: await imagesFor(`pull_request`, [file]) }).toEqual({ file, images: [] })
  }
  for (const event of [`push`, `tag`]) {
    expect({ event, images: await imagesFor(event, [`apps/api/+main.ts`]) }).toEqual({
      event,
      images: IMAGES,
    })
  }
  expect(await imagesFor(`cron`, [])).toEqual([])
})

Deno.test("a pull request that changes a Dockerfile, .dockerignore, the manifest, the lockfile or the workflow builds all four images", async () => {
  const files = [
    `apps/api/dockerfile.node`,
    `apps/api/dockerfile.bun`,
    `apps/mpa/dockerfile.node`,
    `apps/mpa/dockerfile.bun`,
    `.dockerignore`,
    `deno.jsonc`,
    `deno.lock`,
    `.woodpecker/ci.yml`,
  ]
  for (const file of files) {
    expect({ file, images: await imagesFor(`pull_request`, [file]) }).toEqual({
      file,
      images: IMAGES,
    })
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
  expect(blockingSteps(await browserWorkflow(), SMOKE, "pull_request", "main")).toEqual([
    "e2e-smoke",
  ])
  expect(blockingSteps(await workflow(), SMOKE, "pull_request", "main")).toEqual([])
})

Deno.test("only the nightly run runs the whole suite, and it skips the smoke set", async () => {
  const ci = await browserWorkflow()
  expect(blockingSteps(ci, SUITE, "cron", "main")).toEqual(["e2e-full"])
  expect(blockingSteps(ci, SMOKE, "cron", "main")).toEqual([])
  // A push to main would be cancelled by the next merge before the suite ends.
  expect(blockingSteps(ci, SUITE, "push", "main")).toEqual([])
  expect(blockingSteps(ci, SUITE, "pull_request", "main")).toEqual([])
  // A release waits for ci-browser: the whole suite must not stand between a tag and its images,
  // and the smoke set must.
  expect(blockingSteps(ci, SUITE, "tag", "main")).toEqual([])
  expect(blockingSteps(ci, SMOKE, "tag", "main")).toEqual(["e2e-smoke"])
})

Deno.test("a push to main runs only check, secrets and the four images, whatever it changes", async () => {
  // Its pull request already ran the rest; the slow steps would be cancelled by the next merge.
  expect(runsFor(await workflow(), `push`, `main`)).toBe(true)
  for (const changed of [[], [`apps/api/x.ts`], [`apps/mpa/routes/index.tsx`, `deno.lock`]]) {
    const ran = (await ranInCi(`push`, changed)).sort()
    expect({ changed, ran }).toEqual({ changed, ran: [`check`, `secrets`, ...IMAGES].sort() })
  }
})

Deno.test("ci-browser runs on a pull request, its title edit, a tag and the nightly run, and never on a push", async () => {
  // A push to main runs no browser step, and deploy.yml.example waits for ci alone.
  const events = list((await browserWorkflow()).when).flatMap(({ event }) => list(event)).sort()
  expect(events).toEqual([`cron`, `pull_request`, `pull_request_metadata`, `tag`])
})

Deno.test("the nightly run on main runs every check and test step but no image and no smoke set", async () => {
  expect(runsFor(await workflow(), `cron`, `main`)).toBe(true)
  expect(runsFor(await browserWorkflow(), `cron`, `main`)).toBe(true)
  expect((await ranInCi(`cron`)).sort()).toEqual([
    `alert-rules`,
    `backup-restore`,
    `browser`,
    `check`,
    `e2e-full`,
    `integration`,
    `lighthouse`,
    `ready`,
    `runtimes`,
    `secrets`,
  ])
})

Deno.test("the browser-test guide and the CI guide name every spec of the smoke set", async () => {
  for (const path of ["docs/browser-tests.md", "docs/woodpecker-ci-setup.md"]) {
    const text = await read(path)
    const missing = SMOKE_SPECS.filter((name) => !text.includes(name))
    expect({ path, missing }).toEqual({ path, missing: [] })
  }
})

/** Markdown files that no app, image or test reads, apart from `check`. */
const MARKDOWN_ONLY = [
  `README.md`,
  `AGENTS.md`,
  `i18n/TRANSLATING.md`,
  `docs/decisions/a.md`,
  `libs/domain/README.md`,
  `.github/ISSUE_TEMPLATE/a.md`,
]
const STACK = [`integration`, `backup-restore`, `alert-rules`, `browser`, `runtimes`, `e2e-smoke`]

Deno.test("a pull request that changes only Markdown no app loads runs check and none of the stack's steps", async () => {
  for (const file of MARKDOWN_ONLY) {
    const ran = await ranInCi(`pull_request`, [file])
    expect({ file, ran: ran.filter((name) => STACK.includes(name)) }).toEqual({ file, ran: [] })
    expect({ file, check: ran.includes(`check`) }).toEqual({ file, check: true })
  }
  const ci = await browserWorkflow()
  expect(blockingSteps(ci, SMOKE, `pull_request`, `main`, MARKDOWN_ONLY)).toEqual([])
})

Deno.test("ci-browser runs its ready step on every event it runs on, whatever changed, so its status always arrives", async () => {
  // A workflow left with no step posts no status, and branch protection requires
  // ci/woodpecker/pr/ci-browser: a pull request that changes only Markdown could never merge.
  const ci = await browserWorkflow()
  expect(ci.steps?.ready?.when).toBeUndefined()
  for (const event of [`pull_request`, `pull_request_metadata`, `tag`, `cron`]) {
    for (const changed of [[], [`README.md`], MARKDOWN_ONLY, [`apps/api/x.ts`]]) {
      const ran = stages(ci, event, `main`, changed).flat()
      expect({ event, changed, ready: ran.includes(`ready`) }).toEqual({
        event,
        changed,
        ready: true,
      })
    }
  }
})

Deno.test("a pull request that changes Markdown and any other file, the nightly run and a tag run the stack", async () => {
  const cases: [string, string[]][] = [
    [`pull_request`, [`README.md`, `apps/api/x.ts`]],
    [`pull_request`, [`libs/server/blog/seed-posts/a.md`]],
    [`pull_request`, [`apps/mpa/lighthouse/posts/a.md`]],
    [`cron`, []],
    [`tag`, [`README.md`]],
  ]
  for (const [event, changed] of cases) {
    const ran = await ranInCi(event, changed)
    // The nightly run's e2e-full runs every spec of the smoke set.
    const stack = STACK.filter((name) => name !== `e2e-smoke` || event !== `cron`)
    expect({ event, changed, missing: stack.filter((name) => !ran.includes(name)) })
      .toEqual({ event, changed, missing: [] })
  }
})

Deno.test("a pull request that changes only a published guide runs the browser tests and Lighthouse", async () => {
  const changed = [`docs/capacity.md`]
  const order = stages(await browserWorkflow(), `pull_request`, `main`, changed)
  expect(stageOf(order, `lighthouse`)).toBeGreaterThan(stageOf(order, `browser`))
  const ran = await ranInCi(`pull_request`, changed)
  expect(ran.filter((name) => STACK.includes(name))).toEqual([`browser`])
})

const WIP = `.woodpecker/wip.yml`
const WIP_TITLE = `CI_COMMIT_MESSAGE startsWith "[WIP]"`

Deno.test("a title edit that drops [WIP] runs the same steps as a pull request in both workflows, whatever it changes", async () => {
  // A step without the `pull_request_metadata` twin would be skipped, and the short run would
  // still report the required `ci/woodpecker/pr/ci` or `ci/woodpecker/pr/ci-browser` check green.
  const cases = [
    [],
    [`apps/api/x.ts`],
    [`apps/mpa/routes/index.tsx`],
    [`docs/capacity.md`],
    [`README.md`],
    [`apps/api/dockerfile.node`],
    [`tests/x.test.ts`],
  ]
  for (const path of [CI, BROWSER]) {
    const ci = await workflow(path)
    for (const changed of cases) {
      const edit = stages(ci, `pull_request_metadata`, `main`, changed)
      expect({ path, changed, edit }).toEqual({
        path,
        changed,
        edit: stages(ci, `pull_request`, `main`, changed),
      })
    }
  }
})

Deno.test("ci.yml and ci-browser.yml run on a pull request or a title edit only without [WIP], and wip.yml only with it", async () => {
  const conditions = (workflow: Step) =>
    list(workflow.when).map(({ event, evaluate }) => ({ event, evaluate }))
  const pullRequest = (workflow: Step) =>
    conditions(workflow).filter(({ event }) => `${event}`.startsWith(`pull_request`))
  for (const path of [CI, BROWSER]) {
    expect({ path, conditions: pullRequest(await workflow(path)) }).toEqual({
      path,
      conditions: [
        { event: `pull_request`, evaluate: `not (${WIP_TITLE})` },
        {
          event: `pull_request_metadata`,
          evaluate: `CI_PIPELINE_EVENT_REASON contains "edited" && not (${WIP_TITLE})`,
        },
      ],
    })
  }
  expect(conditions(parse(await read(WIP)) as Step)).toEqual([
    { event: `pull_request`, evaluate: WIP_TITLE },
  ])
})

Deno.test("wip.yml skips a pull request that changes no file yet", async () => {
  const paths = list((parse(await read(WIP)) as Step).when).map(({ path }) => path)
  expect(paths).toEqual([{ include: [`**`], on_empty: false }])
})

Deno.test("wip.yml runs exactly ci.yml's check and secrets steps", async () => {
  // YAML anchors do not cross files, so wip.yml holds copies; a fix in ci.yml must reach both.
  const ci = (await workflow()).steps ?? {}
  const wip = (parse(await read(WIP)) as { steps?: Record<string, Step> }).steps ?? {}
  expect(Object.keys(wip)).toEqual([`check`, `secrets`])
  for (const name of [`check`, `secrets`]) {
    expect({ name, step: wip[name] }).toEqual({ name, step: ci[name] })
  }
})

Deno.test("ci-browser.yml's Markdown list and services are copies of ci.yml's", async () => {
  // YAML anchors do not cross files; a Markdown list that drifted would skip e2e-smoke on a
  // change ci.yml tests, and a Postgres that drifted would test another version. e2e-smoke's
  // `valkey-smoke` is a second copy of ci.yml's `valkey`.
  const services = async (path: string) => (await workflow(path)).services ?? {}
  const { "valkey-smoke": smoke, ...browser } = await services(BROWSER)
  const ci = await services(CI)
  expect(browser).toEqual(ci)
  expect(smoke).toEqual(ci.valkey)
  const markdown = async (path: string) =>
    (parse(await read(path)) as { variables?: unknown[] }).variables?.[0]
  expect(await markdown(BROWSER)).toEqual(await markdown(CI))
})

Deno.test("a release waits for both CI workflows, and a deploy on a push for ci alone", async () => {
  // A tag runs both; a push to main runs no ci-browser, which a deploy must not wait for.
  const dependsOn = async (path: string) => list((await workflow(path)).depends_on)
  expect(await dependsOn(`.woodpecker/release.yml`)).toEqual([`ci`, `ci-browser`])
  expect(await dependsOn(`.woodpecker/deploy.yml.example`)).toEqual([`ci`])
})
