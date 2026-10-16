/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  networksToRecreate,
  parseContainers,
  parseProject,
  portRefusal,
  portsToProbe,
  PRODUCT_SERVICES,
  servicesNotUp,
  startsWholeProject,
} from "./compose-checks.ts"

/** What `compose config --format json` prints for a project with two published ports. */
const CONFIG = JSON.stringify({
  name: "shop",
  services: {
    db: {
      ports: [{ mode: "ingress", host_ip: "127.0.0.1", target: 5432, published: "5432" }],
    },
    api: { depends_on: { db: { condition: "service_healthy" } } },
    grafana: {
      profiles: ["monitoring"],
      ports: [
        { host_ip: "127.0.0.1", target: 3000, published: "3000", protocol: "tcp" },
        { target: 4000, published: "4000", protocol: "udp" },
        { target: 5000, published: "5000-5010", protocol: "tcp" },
      ],
    },
  },
})
const RAW_CONFIG = JSON.stringify({
  services: {
    db: { ports: ["${DB_HOST_PORT:-127.0.0.1:${DB_PORT}}:5432"] },
    api: {},
    grafana: { ports: ["${GRAFANA_HOST_PORT:-127.0.0.1:3000}:3000", "4000:4000/udp"] },
  },
})

Deno.test("only a background start of the whole project is checked and staged", () => {
  expect(startsWholeProject(["up", "-d", "--build"])).toBe(true)
  expect(startsWholeProject(["up", "--detach", "--remove-orphans"])).toBe(true)
  // In the foreground the first step would never return.
  expect(startsWholeProject(["up", "--build"])).toBe(false)
  // A named service, or a flag whose meaning two steps would change, runs as one command.
  expect(startsWholeProject(["up", "-d", "grafana"])).toBe(false)
  expect(startsWholeProject(["up", "-d", "--force-recreate"])).toBe(false)
  expect(startsWholeProject(["ps", "-d"])).toBe(false)
})

Deno.test("the published TCP ports come from the Compose files, each with the variable that sets it", () => {
  expect(parseProject(CONFIG, RAW_CONFIG)).toEqual({
    services: ["db", "api", "grafana"],
    ports: [
      { service: "db", hostIp: "127.0.0.1", port: 5432, variable: "DB_HOST_PORT" },
      { service: "grafana", hostIp: "127.0.0.1", port: 3000, variable: "GRAFANA_HOST_PORT" },
    ],
  })
})

Deno.test("a port is still checked when its variable cannot be read, and binds every address when the file names none", () => {
  const config = JSON.stringify({ services: { web: { ports: [{ target: 80, published: "8080" }] } } })
  expect(parseProject(config, "not json")?.ports).toEqual([
    { service: "web", hostIp: "0.0.0.0", port: 8080 },
  ])
})

Deno.test("a project Compose did not describe is not read at all", () => {
  expect(parseProject(undefined)).toBeUndefined()
  expect(parseProject("usage: podman-compose config")).toBeUndefined()
  expect(parseProject("[]")).toBeUndefined()
  expect(parseProject("{}")).toBeUndefined()
})

const ROW = (service: string, state: string, port = 0, exitCode = 0) =>
  JSON.stringify({
    Service: service,
    State: state,
    ExitCode: exitCode,
    Publishers: [{ URL: "127.0.0.1", TargetPort: 1, PublishedPort: port, Protocol: "tcp" }],
  })

Deno.test("the project's containers are read from one JSON object per line or from one array", () => {
  const expected = [
    { service: "db", state: "running", exitCode: 0, ports: [5432] },
    { service: "migrate", state: "exited", exitCode: 0, ports: [] },
  ]
  const rows = [ROW("db", "running", 5432), ROW("migrate", "exited")]
  expect(parseContainers(rows.join("\n") + "\n")).toEqual(expected)
  expect(parseContainers(`[${rows.join(",")}]`)).toEqual(expected)
  expect(parseContainers("")).toEqual([])
  expect(parseContainers(undefined)).toBeUndefined()
  expect(parseContainers("NAME  IMAGE  STATUS")).toBeUndefined()
  expect(parseContainers(`{"Name":"shop-db"}`)).toBeUndefined()
})

Deno.test("a port held by this project's own running container is not probed; a port of its stopped container is", () => {
  const ports = parseProject(CONFIG, RAW_CONFIG)!.ports
  const containers = parseContainers(
    [ROW("db", "running", 5432), ROW("grafana", "exited", 3000)].join("\n"),
  )!
  expect(portsToProbe(ports, containers).map((port) => port.port)).toEqual([3000])
  expect(portsToProbe(ports, []).map((port) => port.port)).toEqual([5432, 3000])
})

Deno.test("the refusal names each taken port, the variable to change, and says nothing was touched", () => {
  const message = portRefusal([
    { service: "grafana", hostIp: "127.0.0.1", port: 3000, variable: "GRAFANA_HOST_PORT" },
    { service: "web", hostIp: "0.0.0.0", port: 8080 },
  ], "./infra/envs/.env")
  expect(message).toContain("127.0.0.1:3000 (service grafana): set GRAFANA_HOST_PORT")
  expect(message).toContain("0.0.0.0:8080 (service web): free it")
  expect(message).toContain("No container was created, stopped or started")
})

Deno.test("a network Compose would remove is found in a dry run; one it only creates is not", () => {
  // Compose 5.5.1, with the changed definition.
  const recreate = [
    " Container shop-api Stopping ",
    " Network shop_default Removing ",
    " Network shop_default Removed ",
    " Network shop_default Creating ",
    " Network shop_default Created ",
    " Container shop-api Recreate ",
  ].join("\n")
  expect(networksToRecreate(recreate)).toEqual(["shop_default"])
  // Older Compose versions prefix every line of a dry run (their documented format, not run here).
  expect(networksToRecreate("DRY-RUN MODE -  Network shop_default  Removed\n")).toEqual([
    "shop_default",
  ])
  // A fresh machine, and a machine where nothing changed.
  expect(networksToRecreate(" Network shop_default Creating \n Network shop_default Created \n"))
    .toEqual([])
  expect(networksToRecreate(" Container shop-api Running \n Container shop-db Removed \n"))
    .toEqual([])
})

Deno.test("a service is not up when it has no container or one that is not running; a one-shot that finished well is up", () => {
  const containers = parseContainers(
    [
      ROW("api", "running"),
      ROW("migrate", "exited"),
      ROW("grafana", "created"),
      ROW("kv", "exited", 0, 127),
    ].join("\n"),
  )!
  expect(servicesNotUp(["api", "migrate", "grafana", "kv", "vector"], containers)).toEqual([
    "grafana (created)",
    "kv (exited)",
    "vector (no container)",
  ])
})

Deno.test("every product service is a service of the shared Compose file", async () => {
  // A renamed service would silently become optional and start after the monitoring.
  const file = await Deno.readTextFile(
    new URL("../compose/compose.shared.yml", import.meta.url),
  )
  const services = [...file.matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1])
  expect(services.length).toBeGreaterThan(PRODUCT_SERVICES.length)
  for (const service of PRODUCT_SERVICES) expect(services).toContain(service)
})
