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

Deno.test("the SPA runs unless SPA is exactly false", () => {
  for (const value of [undefined, "", "true", "False", "0"]) {
    const env: Record<string, string> = value === undefined ? { ENV: "dev" } : { ENV: "dev", SPA: value }
    const plan = planCompose(env, ["up", "-d"], ENV_FILE)
    expect({ value, command: plan.command, off: plan.off })
      .toEqual({ value, command: [...FILES, "up", "-d"], off: [] })
  }
})
