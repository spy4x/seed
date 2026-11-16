/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { planCompose } from "./compose-plan.ts"

const ENV_FILE = "./infra/envs/.env"
const FILES = [
  "compose",
  "-f",
  "./infra/compose/compose.shared.yml",
  "-f",
  "./infra/compose/compose.dev.yml",
  "--env-file",
  ENV_FILE,
]

Deno.test("deno task compose runs Docker when the env file names no engine, and Podman when it names it", () => {
  expect(planCompose({ ENV: "dev" }, ["ps"], ENV_FILE).engine).toBe("docker")
  expect(planCompose({ ENV: "dev", CONTAINER_PROVIDER: "" }, ["ps"], ENV_FILE).engine).toBe(
    "docker",
  )
  expect(planCompose({ ENV: "dev", CONTAINER_PROVIDER: "podman" }, ["ps"], ENV_FILE).engine).toBe(
    "podman",
  )
})

Deno.test("deno task compose refuses an engine it does not know", () => {
  expect(() => planCompose({ ENV: "dev", CONTAINER_PROVIDER: "nerdctl" }, ["ps"], ENV_FILE))
    .toThrow('CONTAINER_PROVIDER must be "docker" or "podman", not "nerdctl"')
})

Deno.test("deno task compose up creates the proxy network and builds the base image first", () => {
  const plan = planCompose({ ENV: "dev" }, ["up", "-d"], ENV_FILE)
  expect(plan.ensureProxyNetwork).toBe(true)
  expect(plan.buildBase).toEqual([...FILES, "build", "deno-base"])
  expect(plan.command).toEqual([...FILES, "up", "-d"])
})

Deno.test("deno task compose build builds the base image first and leaves the network alone", () => {
  const plan = planCompose({ ENV: "dev" }, ["build"], ENV_FILE)
  expect(plan.ensureProxyNetwork).toBe(false)
  expect(plan.buildBase).toEqual([...FILES, "build", "deno-base"])
})

Deno.test("any other compose command builds nothing and reads the files ENV names", () => {
  const plan = planCompose({ ENV: "prod" }, ["logs", "api"], ENV_FILE)
  expect(plan.ensureProxyNetwork).toBe(false)
  expect(plan.buildBase).toBeUndefined()
  expect(plan.command).toEqual([
    "compose",
    "-f",
    "./infra/compose/compose.shared.yml",
    "-f",
    "./infra/compose/compose.prod.yml",
    "--env-file",
    ENV_FILE,
    "logs",
    "api",
  ])
})

Deno.test("SPA=false scales the SPA to no container on every up, and leaves other commands alone", () => {
  const off = { ENV: "dev", SPA: "false" }
  expect(planCompose(off, ["up", "-d"], ENV_FILE).command).toEqual([
    ...FILES,
    "up",
    "--scale",
    "spa=0",
    "-d",
  ])
  expect(planCompose(off, ["up", "-d"], ENV_FILE).off).toEqual(["spa"])
  expect(planCompose(off, ["logs", "api"], ENV_FILE).command).toEqual([...FILES, "logs", "api"])
  expect(planCompose(off, ["exec", "worker", "deno"], ENV_FILE).command).toEqual([
    ...FILES,
    "exec",
    "worker",
    "deno",
  ])
})

Deno.test("SPA=false in production also keeps the source map upload at no container", () => {
  const plan = planCompose({ ENV: "prod", SPA: "false" }, ["up", "-d"], ENV_FILE)
  expect(plan.off).toEqual(["spa", "sourcemaps"])
  expect(plan.command).toContain("sourcemaps=0")
})

Deno.test("the SPA runs unless SPA is exactly false", () => {
  for (const value of [undefined, "", "true", "False", "0"]) {
    const env: Record<string, string> = value === undefined ? { ENV: "dev" } : { ENV: "dev", SPA: value }
    const plan = planCompose(env, ["up", "-d"], ENV_FILE)
    expect({ value, command: plan.command, off: plan.off })
      .toEqual({ value, command: [...FILES, "up", "-d"], off: [] })
  }
})

Deno.test("APP_RUNTIME=node or bun adds that runtime's Compose file after the ENV one", () => {
  for (const runtime of ["node", "bun"]) {
    const plan = planCompose({ ENV: "prod", APP_RUNTIME: runtime }, ["up", "-d"], ENV_FILE)
    expect(plan.command).toEqual([
      "compose",
      "-f",
      "./infra/compose/compose.shared.yml",
      "-f",
      "./infra/compose/compose.prod.yml",
      "-f",
      `./infra/compose/compose.runtime-${runtime}.yml`,
      "--env-file",
      ENV_FILE,
      "up",
      "-d",
    ])
    expect(plan.buildBase).toEqual([...plan.command.slice(0, 9), "build", "deno-base"])
  }
})

Deno.test("Deno stays the runtime when APP_RUNTIME is unset, empty or deno", () => {
  const envs: Record<string, string>[] = [
    { ENV: "dev" },
    { ENV: "dev", APP_RUNTIME: "" },
    { ENV: "dev", APP_RUNTIME: "deno" },
  ]
  for (const env of envs) {
    expect(planCompose(env, ["ps"], ENV_FILE).command).toEqual([...FILES, "ps"])
  }
})

Deno.test("deno task compose refuses a runtime it does not know", () => {
  expect(() => planCompose({ ENV: "dev", APP_RUNTIME: "Node" }, ["ps"], ENV_FILE)).toThrow(
    `APP_RUNTIME must be one of deno, node, bun, got "Node"`,
  )
})

Deno.test("MONITORING_NETWORK adds the shared-host monitoring file after the ENV and runtime ones", () => {
  const network = ["-f", "./infra/compose/compose.monitoring-network.yml"]
  const dev = planCompose({ ENV: "dev", MONITORING_NETWORK: "vm_metrics" }, ["ps"], ENV_FILE)
  expect(dev.command).toEqual([...FILES.slice(0, 5), ...network, ...FILES.slice(5), "ps"])
  const env = { ENV: "prod", APP_RUNTIME: "node", MONITORING_NETWORK: "vm_metrics" }
  expect(planCompose(env, ["ps"], ENV_FILE).command).toEqual([
    "compose",
    "-f",
    "./infra/compose/compose.shared.yml",
    "-f",
    "./infra/compose/compose.prod.yml",
    "-f",
    "./infra/compose/compose.runtime-node.yml",
    ...network,
    "--env-file",
    ENV_FILE,
    "ps",
  ])
})

Deno.test("an unset or empty MONITORING_NETWORK adds no monitoring file", () => {
  const envs: Record<string, string>[] = [{ ENV: "dev" }, { ENV: "dev", MONITORING_NETWORK: "" }]
  for (const env of envs) {
    expect(planCompose(env, ["ps"], ENV_FILE).command).toEqual([...FILES, "ps"])
  }
})
