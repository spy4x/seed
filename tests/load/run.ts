/// <reference lib="deno.ns" />
/**
 * Runs the k6 load scenarios of this folder against the local development stack, and samples
 * Postgres while each one runs: `deno task load` runs all three, `deno task load browse` one.
 * The large-group scenarios run only when named, with a tier: `deno task load group M` or
 * `deno task load group-reads M`, after `deno task load:group M` built that group.
 * docs/capacity.md says what they do and holds the numbers of a run.
 *
 * - The stack is the one `deno task dev` (or `deno task compose up -d kv api worker`) started from
 *   `infra/envs/.env`. The script refuses anything but `ENV=dev`: sign-up reads its code from the
 *   development-only mail route, and the accounts are deleted through the development-only
 *   cleanup route at the end.
 * - k6 runs in its official container, pinned by version and digest, on the stack's own Compose
 *   network, and talks to `http://api:8000`. No address is taken from the command line, so a run
 *   cannot reach the live demo or any other host.
 * - The rate limits of `.env.example` stop a run in its first seconds, since every load user comes
 *   from one address. Raise `RATE_LIMITER_LIMIT` and `RATE_LIMITER_STRICT_LIMIT` in the local env
 *   file for a run, as docs/capacity.md shows; the code's limits stay as they are.
 *
 * @module
 */
import { runCommand } from "@spy4x/platform/server"
import { readEnvFile } from "../../infra/scripts/env-file.ts"
import { containerProvider } from "../../infra/scripts/proxy-network.ts"
import { planTier, SEARCHES, type Tier, TIERS } from "./group-plan.ts"

/** The official k6 image, pinned by version and by the digest of its multi-platform index. */
const K6_IMAGE =
  `grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34`

/** The scenarios, in the order `deno task load` runs them; each is `<name>.js` here. */
const SCENARIOS = [`browse`, `write`, `sockets`] as const
/**
 * The scenarios of one large group, run only when named, with the tier whose group
 * `deno task load:group <tier>` built: `deno task load group M`.
 */
const GROUP_SCENARIOS = [`group`, `group-reads`] as const

/** The head of the table {@link formatRow} fills. */
const HEADER = [
  `| Scenario | Requests | p95 | Errors | Postgres CPU (mean / max) | API CPU (mean / max) | API memory (max) | Connections (max) | Samples |`,
  `| -------- | -------- | --- | ------ | ------------------------- | -------------------- | ---------------- | ----------------- | ------- |`,
].join(`\n`)

/** How often Postgres is sampled while a scenario runs. */
const SAMPLE_MS = 2_000

interface Sample {
  /** The database container's CPU, in percent of one core, as `docker stats` gives it. */
  dbCpu: number
  /** The API container's CPU, the same way. */
  apiCpu: number
  /** The API container's memory in MiB. */
  apiMemory: number
  connections: number
  /** Seconds since the measured phase began. */
  at: number
}

/** One `LOAD_SUMMARY` line; a step of `group-reads` also says which seconds of the run it was. */
interface Summary {
  scenario: string
  requests: number
  p95Ms: number | null
  errorRate: number | null
  startS?: number
  endS?: number
}

async function main(args: string[]): Promise<number> {
  const known: readonly string[] = [...SCENARIOS, ...GROUP_SCENARIOS]
  const tiers = args.filter((arg) => (TIERS as readonly string[]).includes(arg)) as Tier[]
  const scenarios = args.filter((arg) => !tiers.includes(arg as Tier))
  const unknown = scenarios.filter((arg) => !known.includes(arg))
  if (unknown.length > 0) {
    console.error(`Unknown scenario ${unknown.join(`, `)}; choose from ${known.join(`, `)}`)
    return 2
  }
  const forGroup = scenarios.some((arg) => (GROUP_SCENARIOS as readonly string[]).includes(arg))
  if (tiers.length > 1 || (tiers.length === 1) !== forGroup) {
    console.error(`Name one tier (${TIERS.join(`, `)}) with group or group-reads, and only then`)
    return 2
  }
  const groupEnv = tiers.length === 0 ? [] : [
    `-e`,
    `GROUP_ID=${planTier(tiers[0]).groupId}`,
    `-e`,
    `SEARCHES=${JSON.stringify(SEARCHES)}`,
  ]
  const env = await readEnvFile(`./infra/envs/.env`)
  if (env.ENV !== `dev`) {
    console.error(
      `deno task load runs against a development stack only; infra/envs/.env has ENV=${env.ENV}`,
    )
    return 1
  }
  const engine = containerProvider(env)
  const project = env.PROJECT
  const running = await runCommand([
    engine,
    `inspect`,
    `-f`,
    `{{.State.Running}}`,
    `${project}-api`,
  ])
  if (running.stdout.trim() !== `true`) {
    console.error(`${project}-api is not running: start the stack with deno task dev first`)
    return 1
  }
  const scripts = new URL(`.`, import.meta.url).pathname
  const rows: string[] = []
  let failed = false
  for (const scenario of scenarios.length > 0 ? scenarios : SCENARIOS) {
    console.log(`Running ${scenario}: a few minutes, sign-ups included`)
    const name = `${project}-load-${scenario}-${Date.now()}`
    const run = runCommand([
      engine,
      `run`,
      `--rm`,
      `--name`,
      name,
      `--pids-limit=500`,
      `--memory=8g`,
      `--network`,
      `${project}_default`,
      `-v`,
      `${scripts}:/scripts:ro,z`,
      `-e`,
      `BASE_URL=http://api:8000`,
      `-e`,
      `ORIGIN=http://${env.DOMAIN}`,
      ...groupEnv,
      K6_IMAGE,
      `run`,
      `--quiet`,
      `/scripts/${scenario}.js`,
    ])
    const samples = await sampleWhile(run, engine, name, env)
    const result = await run
    const lines = result.stdout.split(`\n`).filter((text) => text.startsWith(`LOAD_SUMMARY `))
    if (lines.length === 0) {
      console.error(
        `${scenario} printed no summary (exit ${result.code}):\n${result.stderr.slice(-3000)}`,
      )
      failed = true
      continue
    }
    if (result.code !== 0) {
      console.error(
        `${scenario}: k6 exited with ${result.code}, a threshold failed or a check broke`,
      )
      console.error(result.stderr.slice(-2000))
      failed = true
    }
    for (const line of lines) {
      const summary: Summary = JSON.parse(line.slice(`LOAD_SUMMARY `.length))
      const own = summary.startS === undefined
        ? samples
        : samples.filter((sample) => sample.at >= summary.startS! && sample.at < summary.endS!)
      rows.push(formatRow(summary, own))
      console.log(line)
    }
  }
  console.log(`\n${HEADER}`)
  for (const row of rows) console.log(row)
  return failed ? 1 : 0
}

/**
 * Samples the CPU of the database and API containers and the database's client connections every
 * {@link SAMPLE_MS} while `run` is going, but only between the scenario's `LOAD_PHASE measure` and
 * `LOAD_PHASE teardown` log lines, so the sign-ups and the cleanup are not counted.
 */
async function sampleWhile(
  run: Promise<unknown>,
  engine: string,
  container: string,
  env: Record<string, string>,
): Promise<Sample[]> {
  let done = false
  run.finally(() => done = true)
  const samples: Sample[] = []
  let measuredFrom: number | null = null
  const db = `${env.PROJECT}-db`
  const api = `${env.PROJECT}-api`
  const query = `SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend'`
  while (!done) {
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
    const logs = await runCommand([engine, `logs`, container])
    const text = logs.stdout + logs.stderr
    if (!text.includes(`LOAD_PHASE measure`) || text.includes(`LOAD_PHASE teardown`)) continue
    measuredFrom ??= Date.now()
    const at = (Date.now() - measuredFrom) / 1000
    const format = `{{.Name}} {{.CPUPerc}} {{.MemUsage}}`
    const [stats, connections] = await Promise.all([
      runCommand([engine, `stats`, `--no-stream`, `--format`, format, db, api]),
      runCommand([engine, `exec`, db, `psql`, `-U`, env.DB_USER, `-d`, env.DB_NAME, `-tAc`, query]),
    ])
    const usage = new Map(
      stats.stdout.trim().split(`\n`).map((row) => {
        const [name, percent, memory] = row.trim().split(` `)
        return [name, { cpu: Number.parseFloat(percent), memory: mebibytes(memory ?? ``) }]
      }),
    )
    const sample = {
      dbCpu: usage.get(db)?.cpu ?? NaN,
      apiCpu: usage.get(api)?.cpu ?? NaN,
      apiMemory: usage.get(api)?.memory ?? NaN,
      connections: Number.parseInt(connections.stdout),
      at,
    }
    if (Object.values(sample).every(Number.isFinite)) samples.push(sample)
  }
  return samples
}

/** A memory figure of `docker stats` (`123.4MiB`, `1.2GiB`, `900kB`) in MiB; `NaN` when unknown. */
function mebibytes(text: string): number {
  const match = /^([\d.]+)\s*([kKMG]i?B|B)$/.exec(text.trim())
  if (!match) return NaN
  const scale: Record<string, number> = {
    B: 1 / 1024 / 1024,
    kB: 1000 / 1024 / 1024,
    KiB: 1 / 1024,
    MB: 1000 * 1000 / 1024 / 1024,
    MiB: 1,
    GB: 1000 ** 3 / 1024 / 1024,
    GiB: 1024,
  }
  return Number.parseFloat(match[1]) * (scale[match[2]] ?? NaN)
}

/** One row of the {@link HEADER} table: a scenario's k6 numbers and its container samples. */
function formatRow(summary: Summary, samples: Sample[]): string {
  const meanMax = (values: number[]) =>
    values.length === 0
      ? `n/a`
      : `${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)} % / ${
        Math.max(...values).toFixed(1)
      } %`
  const p95 = summary.p95Ms === null ? `n/a` : `${summary.p95Ms.toFixed(1)} ms`
  const errors = summary.errorRate === null ? `n/a` : `${(summary.errorRate * 100).toFixed(2)} %`
  const connections = samples.length === 0
    ? `n/a`
    : String(Math.max(...samples.map((sample) => sample.connections)))
  return [
    ``,
    summary.scenario,
    summary.requests,
    p95,
    errors,
    meanMax(samples.map((sample) => sample.dbCpu)),
    meanMax(samples.map((sample) => sample.apiCpu)),
    samples.length === 0
      ? `n/a`
      : `${Math.max(...samples.map((sample) => sample.apiMemory)).toFixed(0)} MiB`,
    connections,
    samples.length,
    ``,
  ].join(` | `).trim()
}

if (import.meta.main) Deno.exit(await main(Deno.args))
