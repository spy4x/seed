/// <reference lib="deno.ns" />
/**
 * The ApiErrors alert has no metric of the API's own to read: Vector counts the API's answers from
 * its request log (infra/configs/vector.yml) and the rule asks for one status class
 * (infra/configs/alerts.yml). A change of the log line, of the pattern or of the rule's label would
 * end the alert with nothing said, so this file runs the pattern over the lines the API's own
 * logger writes and holds the rule to a class the pattern produces (spy4x/template#159).
 */

import { expect } from "@std/expect"
import { parse } from "@std/yaml"
import { Hono } from "hono"
import { applyBaseMiddleware } from "@spy4x/server/request-log/base-middleware"

const CONFIGS = new URL("../infra/configs/", import.meta.url)

interface VectorConfig {
  transforms: {
    api_requests: { source: string }
    api_request_metrics: { metrics: { name: string; tags: Record<string, string> }[] }
  }
}

interface AlertRules {
  groups: { rules: { alert: string; expr: string }[] }[]
}

/** The `-->` lines the API's base middleware writes for a 200, a 404 and a 500, in that order. */
async function requestLogLines(): Promise<string[]> {
  const lines: string[] = []
  const app = new Hono().basePath("/api")
  applyBaseMiddleware(app, { write: (...data) => lines.push(data.join(` `)) })
  app.get("/ok", (c) => c.text(`ok`))
  app.get("/broken", () => {
    throw new Error(`broken on purpose`)
  })
  for (const path of [`/api/ok`, `/api/missing`, `/api/broken`]) await app.request(path)
  return lines.filter((line) => line.includes(`-->`))
}

/** What Vector's `api_requests` transform makes of one log line; `null` where it drops the line. */
async function statusClassOf(line: string): Promise<string | null> {
  const vector = parse(await Deno.readTextFile(new URL("vector.yml", CONFIGS))) as VectorConfig
  const { source } = vector.transforms.api_requests
  // Vector's pattern is a Rust regular expression; this one uses only what JavaScript reads alike.
  const pattern = source.match(/parse_regex\(string!\(\.message\), r'([^']+)'\)/)?.[1]
  const suffix = source.match(/string!\(parsed\.class\) \+ "([^"]+)"/)?.[1]
  if (!pattern || !suffix) throw new Error(`vector.yml: the api_requests pattern was not found`)
  const digit = line.match(new RegExp(pattern))?.groups?.class
  return digit ? digit + suffix : null
}

Deno.test("Vector's pattern reads the status class from the API's own log lines", async () => {
  // The API logs in colour in production; with NO_COLOR set this test would only see plain lines.
  expect(Deno.noColor, `run the tests without NO_COLOR`).toBe(false)
  const lines = await requestLogLines()
  expect(lines.length).toBe(3)
  expect(lines[2]).toContain(`\x1b[31m500\x1b[0m`)

  const coloured = await Promise.all(lines.map(statusClassOf))
  expect(coloured).toEqual([`2xx`, `4xx`, `5xx`])
  // The same lines as a logger without colour writes them.
  // deno-lint-ignore no-control-regex
  const plain = lines.map((line) => line.replace(/\x1b\[\d+m/g, ``))
  expect(await Promise.all(plain.map(statusClassOf))).toEqual([`2xx`, `4xx`, `5xx`])
})

Deno.test("the ApiErrors rule asks for the metric and the status Vector makes of a 500", async () => {
  const [, , serverError] = await requestLogLines()
  const vector = parse(await Deno.readTextFile(new URL("vector.yml", CONFIGS))) as VectorConfig
  const [metric] = vector.transforms.api_request_metrics.metrics
  expect(metric.tags).toEqual({ status: `{{status}}` })

  const rules = parse(await Deno.readTextFile(new URL("alerts.yml", CONFIGS))) as AlertRules
  const rule = rules.groups.flatMap((group) => group.rules).find((r) => r.alert === `ApiErrors`)
  const asked = rule?.expr.match(/([a-z_]+)\{status="([^"]+)"\}/)
  expect(asked?.[1]).toBe(metric.name)
  expect(asked?.[2]).toBe(await statusClassOf(serverError))
})

Deno.test("Vector counts the lines of the container the API runs as", async () => {
  const vector = parse(await Deno.readTextFile(new URL("vector.yml", CONFIGS))) as VectorConfig
  const counted = vector.transforms.api_requests.source.match(
    /if \.container_name != "([^"]+)" \{ abort \}/,
  )?.[1]
  const compose = parse(
    await Deno.readTextFile(new URL("../compose/compose.shared.yml", CONFIGS)),
  ) as { services: { api: { container_name: string } } }
  expect(counted).toBe(compose.services.api.container_name)
})

Deno.test("Vector turns the backup's own last line into the gauge BackupMissing reads", async () => {
  const vector = parse(await Deno.readTextFile(new URL("vector.yml", CONFIGS))) as {
    transforms: {
      backup_runs: { source: string }
      backup_metrics: { metrics: { type: string; field: string; name: string }[] }
    }
  }
  const { source } = vector.transforms.backup_runs
  const container = source.match(/if \.container_name != "([^"]+)" \{ abort \}/)?.[1]
  const pattern = source.match(/match\(string!\(\.message\), r'([^']+)'\)/)?.[1]
  if (!container || !pattern) throw new Error(`vector.yml: the backup_runs pattern was not found`)

  // The line backup.sh writes after a complete run, as its `log` function prints it.
  const script = await Deno.readTextFile(new URL("../backup/backup.sh", CONFIGS))
  const done = script.match(/^\s*log "(Backup done\.)"$/m)?.[1]
  expect(done).toBe(`Backup done.`)
  expect(`2026-10-17T03:00:00Z ${done}`).toMatch(new RegExp(pattern))
  // A failed run's line, and the "done" words inside another line, count for nothing.
  expect(`2026-10-17T03:00:00Z BACKUP FAILED. The next try is in 24 hours.`).not.toMatch(
    new RegExp(pattern),
  )
  expect(`2026-10-17T03:00:00Z Backup done. Then something else`).not.toMatch(new RegExp(pattern))

  const compose = parse(
    await Deno.readTextFile(new URL("../compose/compose.shared.yml", CONFIGS)),
  ) as { services: { backup: { container_name: string } } }
  expect(container).toBe(compose.services.backup.container_name)

  const [metric] = vector.transforms.backup_metrics.metrics
  expect(metric).toEqual({
    type: `gauge`,
    field: `finished`,
    name: `backup_last_success_timestamp_seconds`,
  })
  const rules = parse(await Deno.readTextFile(new URL("alerts.yml", CONFIGS))) as AlertRules
  const rule = rules.groups.flatMap((group) => group.rules).find((r) => r.alert === `BackupMissing`)
  expect(rule?.expr).toContain(`max_over_time(${metric.name}[14d])`)
})

Deno.test("BackupMissing looks back no further than the bundled VictoriaMetrics keeps data", async () => {
  // A longer window would promise an alert that the store has already dropped the data for.
  const compose = parse(
    await Deno.readTextFile(new URL("../compose/compose.shared.yml", CONFIGS)),
  ) as { services: { victoriametrics: { command: string[] } } }
  const retention = compose.services.victoriametrics.command
    .map((flag) => flag.match(/^-retentionPeriod=(\d+)d$/)?.[1])
    .find(Boolean)
  const rules = parse(await Deno.readTextFile(new URL("alerts.yml", CONFIGS))) as AlertRules
  const rule = rules.groups.flatMap((group) => group.rules).find((r) => r.alert === `BackupMissing`)
  const window = rule?.expr.match(/backup_last_success_timestamp_seconds\[(\d+)d\]/)?.[1]
  if (!retention || !window) throw new Error(`the retention or the rule's window was not found`)
  expect(Number(window)).toBeLessThanOrEqual(Number(retention))
})
