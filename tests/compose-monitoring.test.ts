/// <reference lib="deno.ns" />
/**
 * Holds the monitoring services in `infra/compose` to what docs/stack.md's "Monitoring" section
 * promises: the stack is VictoriaMetrics and VictoriaLogs, never Prometheus, Loki or promtail
 * again; the databases and Grafana run only in the `monitoring` profile, while vmagent and Vector
 * always run and take their destination from the environment (spy4x/template#159).
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE_DIR = new URL("../infra/compose/", import.meta.url)
const COMPOSE_FILES = [
  `compose.shared.yml`,
  `compose.dev.yml`,
  `compose.prod.yml`,
  `compose.proxy.yml`,
]
const CONFIGS_PREFIX = `../../infra/configs/`

interface ComposeService {
  image?: string
  profiles?: string[]
  command?: string[]
  entrypoint?: string[]
  environment?: string[]
  ports?: unknown[]
  cap_drop?: string[]
  read_only?: boolean
  security_opt?: string[]
  volumes?: (string | { source?: string })[]
}

async function services(file = `compose.shared.yml`): Promise<Record<string, ComposeService>> {
  const path = fromFileUrl(new URL(file, COMPOSE_DIR))
  const compose = parse(await Deno.readTextFile(path)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${file} has no services`)
  return compose.services
}

/** The image's last path segment without its tag: `grafana/loki:3.7.8` gives `loki`. */
function imageName(image = ``): string {
  return image.split(`/`).at(-1)!.split(/[:@]/)[0]
}

const REPLACED = [`prometheus`, `loki`, `promtail`]

Deno.test("no Compose file runs Prometheus, Loki or promtail", async () => {
  let checked = 0
  for (const file of COMPOSE_FILES) {
    for (const [name, service] of Object.entries(await services(file))) {
      expect(REPLACED, `${file} has a service named ${name}`).not.toContain(name)
      expect(REPLACED, `${file}: ${name} runs ${service.image}`).not.toContain(
        imageName(service.image),
      )
      checked++
    }
  }
  expect(checked).toBeGreaterThan(10)
})

Deno.test("the databases, Grafana and the alerting run only in the monitoring profile", async () => {
  const all = await services()
  for (const name of [`victoriametrics`, `victorialogs`, `grafana`, `vmalert`, `alertmanager`]) {
    expect(all[name]?.profiles, name).toEqual([`monitoring`])
  }
})

Deno.test("vmagent, Vector and the Postgres exporter run in both modes", async () => {
  const all = await services()
  for (const name of [`vmagent`, `vector`, `postgres-prometheus-exporter`]) {
    expect(all[name], `${name} exists`).toBeDefined()
    expect(all[name].profiles, `${name} is in no profile`).toBeUndefined()
  }
})

Deno.test("vmagent pushes to VM_REMOTE_WRITE_URL, or to the bundled VictoriaMetrics", async () => {
  const { vmagent } = await services()
  expect(vmagent.command).toContain(
    "-remoteWrite.url=${VM_REMOTE_WRITE_URL:-http://victoriametrics:8428/api/v1/write}",
  )
  expect(vmagent.command).toContain(
    "-remoteWrite.basicAuth.username=${VM_REMOTE_WRITE_USERNAME:-}",
  )
  // The password travels in the container's environment; the flag only names the variable.
  expect(vmagent.command).toContain("-remoteWrite.basicAuth.password=%{VM_REMOTE_WRITE_PASSWORD}")
  expect(vmagent.environment).toContain("VM_REMOTE_WRITE_PASSWORD=${VM_REMOTE_WRITE_PASSWORD:-}")
})

Deno.test("Vector ships to VLOGS_URL, or to the bundled VictoriaLogs", async () => {
  const { vector } = await services()
  expect(vector.environment).toContain("VLOGS_URL=${VLOGS_URL:-http://victorialogs:9428}")
  expect(vector.environment).toContain("VLOGS_USERNAME=${VLOGS_USERNAME:-}")
  expect(vector.environment).toContain("VLOGS_PASSWORD=${VLOGS_PASSWORD:-}")
})

Deno.test("the API and the worker are told nothing about monitoring", async () => {
  const all = await services()
  for (const name of [`api`, `worker`]) {
    const told = (all[name].environment ?? []).filter((entry) => /^(VM_|VLOGS_|ALERT_)/.test(entry))
    expect(told, name).toEqual([])
  }
})

Deno.test("every config file a service mounts from infra/configs is in the repository", async () => {
  // infra/configs/vapid.json is made on each machine (`deno task vapid-key:create`), never tracked.
  const mounted = Object.values(await services())
    .flatMap((service) => service.volumes ?? [])
    .map((volume) => typeof volume === `string` ? volume.split(`:`)[0] : volume.source ?? ``)
    .filter((source) => source.startsWith(CONFIGS_PREFIX) && !source.endsWith(`/vapid.json`))
  expect(mounted.length).toBeGreaterThanOrEqual(4)
  for (const source of mounted) {
    const stat = await Deno.stat(fromFileUrl(new URL(source, COMPOSE_DIR)))
    expect(stat.isFile, source).toBe(true)
  }
})

const VECTOR_CONFIG = new URL("../infra/configs/vector.yml", import.meta.url)

Deno.test("Vector takes containers by the exact Compose project label, not by a name prefix", async () => {
  const config = parse(await Deno.readTextFile(VECTOR_CONFIG)) as {
    sources: { containers: { include_labels?: string[]; include_containers?: string[] } }
  }
  const { containers } = config.sources
  // Compose lower-cases the project name on the label, so the filter takes Compose's own
  // variable; PROJECT as typed would match nothing when it holds a capital letter.
  expect(containers.include_labels).toEqual([
    "com.docker.compose.project=${COMPOSE_PROJECT_NAME}",
  ])
  const { vector } = await services()
  expect(vector.environment).toContain("COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}")
  // A name is matched as a prefix, so `app-` would also take the project `app-staging`.
  expect(containers.include_containers).toBeUndefined()
})

Deno.test("a Vector password with a quote reaches the config only inside base64", async () => {
  const { vector } = await services()
  // Compose turns `$$` into `$` before the container's shell reads the script.
  const [shell, flags, script, name] = vector.entrypoint!
  const { success, stdout, stderr } = await new Deno.Command(shell, {
    args: [flags, script.replaceAll(`$$`, `$`), name, `printenv`, `VLOGS_AUTH`],
    env: { VLOGS_USERNAME: `shipper`, VLOGS_PASSWORD: `ab'cd #x` },
  }).output()
  expect(new TextDecoder().decode(stderr)).toBe(``)
  expect(success).toBe(true)
  expect(atob(new TextDecoder().decode(stdout).trim())).toBe(`shipper:ab'cd #x`)

  const text = await Deno.readTextFile(VECTOR_CONFIG)
  expect(text).not.toContain("${VLOGS_PASSWORD")
  expect(text).not.toContain("${VLOGS_USERNAME")
  const config = parse(text) as {
    sinks: { victorialogs: { auth?: unknown; request?: { headers?: Record<string, string> } } }
  }
  expect(config.sinks.victorialogs.auth).toBeUndefined()
  expect(config.sinks.victorialogs.request?.headers?.Authorization).toBe("Basic ${VLOGS_AUTH}")
})

// Grafana is the one monitoring service a person opens: tests/compose-exposure.test.ts holds its
// port to this machine.
Deno.test("no monitoring service except Grafana publishes a port on the host", async () => {
  const monitoring = [
    `vmagent`,
    `vector`,
    `postgres-prometheus-exporter`,
    `victoriametrics`,
    `victorialogs`,
    `vmalert`,
    `alertmanager`,
    `nodeexporter`,
    `cadvisor`,
  ]
  let checked = 0
  for (const file of COMPOSE_FILES) {
    for (const [name, service] of Object.entries(await services(file))) {
      if (!monitoring.includes(name)) continue
      expect(service.ports, `${file}: ${name}`).toBeUndefined()
      checked++
    }
  }
  expect(checked).toBeGreaterThanOrEqual(monitoring.length)
})

Deno.test("Vector, which holds the Docker socket, has no capability and a read-only file system", async () => {
  const { vector } = await services()
  expect(vector.cap_drop).toEqual([`ALL`])
  expect(vector.read_only).toBe(true)
  expect(vector.security_opt).toContain(`no-new-privileges:true`)
})
