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
  networks?: string[]
  depends_on?: string[] | Record<string, unknown>
  labels?: string[]
}

interface ComposeNetwork {
  internal?: boolean
  external?: boolean
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
    `socket-proxy`,
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

const DOCKER_SOCKET = `/var/run/docker.sock`

/** What a volume entry mounts from the host: the left side of `source:target[:options]`. */
function mountSource(volume: string | { source?: string }): string {
  return typeof volume === `string` ? volume.split(`:`)[0] : volume.source ?? ``
}

/** Whether mounting `source` puts the Docker socket in the container: the socket or a folder above it. */
function holdsDockerSocket(source: string): boolean {
  const folder = source.endsWith(`/`) ? source : `${source}/`
  return source === DOCKER_SOCKET || DOCKER_SOCKET.startsWith(folder) ||
    `/run/docker.sock`.startsWith(folder)
}

Deno.test("no service but the socket proxy mounts the Docker socket", async () => {
  const holders: string[] = []
  for (const file of COMPOSE_FILES) {
    for (const [name, service] of Object.entries(await services(file))) {
      if ((service.volumes ?? []).map(mountSource).some(holdsDockerSocket)) {
        holders.push(`${file}: ${name}`)
      }
    }
  }
  expect(holders.sort()).toEqual([
    // Traefik reads the containers' labels from it; it is not behind a proxy (docs/stack.md).
    `compose.proxy.yml: traefik`,
    // The two host exporters mount the host's `/`, and cAdvisor `/var/run` too. They exist only
    // in the `host-monitoring` profile, which the next lines hold them to.
    `compose.shared.yml: cadvisor`,
    `compose.shared.yml: nodeexporter`,
    `compose.shared.yml: socket-proxy`,
  ])
  const all = await services()
  for (const name of [`cadvisor`, `nodeexporter`]) {
    expect(all[name].profiles, name).toEqual([`host-monitoring`])
  }
  expect(all[`socket-proxy`].volumes).toEqual([`${DOCKER_SOCKET}:${DOCKER_SOCKET}:ro`])
})

Deno.test("the socket proxy runs in both modes, from a pinned image", async () => {
  const proxy = (await services())[`socket-proxy`]
  expect(proxy.profiles).toBeUndefined()
  expect(proxy.image).toMatch(/^wollomatic\/socket-proxy:\d+\.\d+\.\d+$/)
})

/** The proxy's allow-list flags as `[method, pattern]`; Compose writes a dollar sign as `$$`. */
function allowList(command: string[] = []): [string, string][] {
  return command.flatMap((flag): [string, string][] => {
    const match = flag.match(/^-allow([A-Z]+)=(.*)$/)
    return match ? [[match[1], match[2].replaceAll(`$$`, `$`)]] : []
  })
}

Deno.test("the socket proxy passes on GET only, and only the paths Vector's Docker source reads", async () => {
  const proxy = (await services())[`socket-proxy`]
  const allowed = allowList(proxy.command)
  expect(allowed.map(([method]) => method)).toEqual([`GET`])
  // The proxy matches the whole path (it wraps the pattern in `^` and `$` itself); the pattern
  // says so too, so the check below reads it as the proxy does.
  const pattern = allowed[0][1]
  expect(pattern.startsWith(`^`) && pattern.endsWith(`$`), pattern).toBe(true)
  const get = new RegExp(pattern)
  const id = `e5db820ac11461ed2736807d3edec5829b7118eb682e04b416d2e73170cb8e4d`

  for (
    const path of [
      `/_ping`,
      `/version`,
      `/events`,
      `/containers/json`,
      `/containers/${id}/json`,
      `/containers/${id}/logs`,
      `/v1.44/containers/json`,
      `/v1.44/containers/${id}/logs`,
      `/v1.44/events`,
    ]
  ) expect({ path, allowed: get.test(path) }).toEqual({ path, allowed: true })

  for (
    const path of [
      `/containers/${id}/archive`,
      `/v1.44/containers/${id}/archive`,
      `/containers/${id}/export`,
      `/containers/${id}/top`,
      `/containers/${id}/changes`,
      `/containers/${id}/attach/ws`,
      `/containers/${id}/json/../archive`,
      `/containers/${id}/logs/../export`,
      // An id is one path segment: nothing may climb out of `/containers` and still end in `json`.
      `/containers/${id}/../../images/${id}/json`,
      `/containers/${id}/exec/json`,
      `//containers/${id}/archive`,
      `/exec/${id}/json`,
      `/images/json`,
      `/images/${id}/get`,
      `/volumes`,
      `/networks`,
      `/secrets`,
      `/configs`,
      `/info`,
      `/system/df`,
      `/v1.44/info`,
      `/v2/containers/json`,
      `/`,
    ]
  ) expect({ path, allowed: get.test(path) }).toEqual({ path, allowed: false })
})

Deno.test("the socket proxy is on a network of its own that only Vector joins, and answers Vector's address only", async () => {
  const path = fromFileUrl(new URL(`compose.shared.yml`, COMPOSE_DIR))
  const { networks } = parse(await Deno.readTextFile(path)) as {
    networks: Record<string, ComposeNetwork>
  }
  expect(networks[`docker-socket`]).toEqual({ internal: true })

  const members: string[] = []
  for (const file of COMPOSE_FILES) {
    for (const [name, service] of Object.entries(await services(file))) {
      if (service.networks?.includes(`docker-socket`)) members.push(`${file}: ${name}`)
      if (name !== `socket-proxy`) continue
      // Not on the project's network, not on the reverse proxy's, no route, no port.
      expect(service.networks, file).toEqual([`docker-socket`])
      expect(service.labels, file).toBeUndefined()
      expect(service.ports, file).toBeUndefined()
    }
  }
  expect(members.sort()).toEqual([`compose.shared.yml: socket-proxy`, `compose.shared.yml: vector`])

  // The host can reach any address on a Docker network, `internal` or not, so the proxy itself
  // refuses every caller but the one the name `vector` resolves to: exactly one such flag.
  const proxy = (await services())[`socket-proxy`]
  expect(proxy.command?.filter((flag) => flag.startsWith(`-allowfrom`))).toEqual([
    `-allowfrom=vector`,
  ])
})

Deno.test("Vector reads the Docker API through the socket proxy and starts after it", async () => {
  const config = parse(await Deno.readTextFile(VECTOR_CONFIG)) as {
    sources: { containers: { type: string; docker_host?: string } }
  }
  expect(config.sources.containers.type).toBe(`docker_logs`)
  // The proxy's port is its default, 2375: its command sets no other.
  expect(config.sources.containers.docker_host).toBe(`tcp://socket-proxy:2375`)
  const all = await services()
  expect(all[`socket-proxy`].command?.filter((flag) => flag.startsWith(`-proxyport`))).toEqual([])
  expect(all[`socket-proxy`].command).toContain(`-listenip=0.0.0.0`)
  expect(all.vector.depends_on).toEqual([`socket-proxy`])
  // Still on the project's network, where VictoriaLogs and vmagent are.
  expect(all.vector.networks).toEqual([`default`, `docker-socket`])
})

Deno.test("Vector and the socket proxy have no capability and a read-only file system", async () => {
  const all = await services()
  for (const name of [`vector`, `socket-proxy`]) {
    expect(all[name].cap_drop, name).toEqual([`ALL`])
    expect(all[name].read_only, name).toBe(true)
    expect(all[name].security_opt, name).toContain(`no-new-privileges:true`)
  }
  // Only the socket's holder needs SELinux labelling off.
  expect(all.vector.security_opt).toEqual([`no-new-privileges:true`])
})
