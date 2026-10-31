// Full reads of one large group in parallel, in steps of 1, 2, 4, 8, 16 and 32 people at once,
// 30 seconds a step, each person reading the whole group again as soon as the last read ends. It
// finds the step where the p95 of the requests passes one second. Build the group first with
// `deno task load:group <tier>`, then run `deno task load group-reads <tier>`.
import { Trend } from "k6/metrics"
import { compactSummary, deleteUsers, markPhase, runPrefix, signUpUsers } from "./lib.js"
import { fullRead, joinGroup } from "./group-lib.js"

const GROUP_ID = __ENV.GROUP_ID
if (!GROUP_ID) throw new Error(`GROUP_ID is required; run deno task load group-reads <tier>`)
const STEPS = [1, 2, 4, 8, 16, 32]
const STEP_SECONDS = 30

const readMs = new Trend(`group_full_read_ms`, true)

export const options = {
  setupTimeout: `5m`,
  teardownTimeout: `2m`,
  summaryTrendStats: [`avg`, `min`, `med`, `max`, `p(95)`, `count`],
  scenarios: Object.fromEntries(STEPS.map((vus, i) => [`reads_${vus}`, {
    executor: `constant-vus`,
    vus,
    duration: `${STEP_SECONDS}s`,
    startTime: `${i * STEP_SECONDS}s`,
    // A read still going when its step ends is cut, so one step never runs into the next.
    gracefulStop: `0s`,
  }])),
  // Each step's own numbers in the summary; none fails the run, since finding the limit is the aim.
  thresholds: Object.fromEntries(STEPS.flatMap((vus) => [
    [`http_req_duration{scenario:reads_${vus}}`, [`p(95)<100000`]],
    [`group_full_read_ms{scenario:reads_${vus}}`, [`p(95)<1000000`]],
    [`http_reqs{scenario:reads_${vus}}`, [`count>=0`]],
    [`http_req_failed{scenario:reads_${vus}}`, [`rate<=1`]],
  ])),
}

export function setup() {
  const users = signUpUsers(STEPS.at(-1), `reads-${runPrefix()}`)
  for (const user of users) joinGroup(user, GROUP_ID)
  markPhase(`measure`)
  return { users }
}

export default function ({ users }) {
  const user = users[(__VU - 1) % users.length]
  readMs.add(fullRead(user, GROUP_ID).ms)
}

export function teardown({ users }) {
  markPhase(`teardown`)
  deleteUsers(users)
}

/** One summary line per step, as `run.ts` reads them, then the step table. */
export function handleSummary(data) {
  const lines = STEPS.map((vus, i) => {
    const step = `reads_${vus}`
    const read = data.metrics[`group_full_read_ms{scenario:${step}}`]?.values
    const summary = compactSummary(data, step).stdout.trim()
    const parsed = JSON.parse(summary.slice(`LOAD_SUMMARY `.length))
    parsed.vus = vus
    parsed.startS = i * STEP_SECONDS
    parsed.endS = (i + 1) * STEP_SECONDS
    parsed.fullReads = read?.count ?? 0
    parsed.fullReadP95Ms = read?.[`p(95)`] ?? null
    parsed.fullReadMedianMs = read?.med ?? null
    return `LOAD_SUMMARY ${JSON.stringify(parsed)}`
  })
  return { stdout: `${lines.join(`\n`)}\n` }
}
