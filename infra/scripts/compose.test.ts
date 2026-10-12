/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { type ComposeHost, runCompose } from "./compose.ts"
import type { PostgresDataFacts } from "./postgres-data.ts"

const ENV = { ENV: "prod", PROJECT: "app" }

/** A host that records what reaches the container engine. */
function host(
  facts: Partial<PostgresDataFacts>,
): ComposeHost & { ran: string[]; errors: string[] } {
  const ran: string[] = []
  const errors: string[] = []
  return {
    ran,
    errors,
    readEnv: () => Promise.resolve(ENV),
    facts: () =>
      Promise.resolve({
        oldDataExists: false,
        newDataExists: false,
        upgradeMarked: false,
        oldDataChangedSinceUpgrade: false,
        ...facts,
      }),
    ensureProxyNetwork: () => {
      ran.push("proxy network")
      return Promise.resolve(false)
    },
    run: (_engine, args) => {
      ran.push(args.slice(args.indexOf("./infra/envs/.env") + 1).join(" "))
      return Promise.resolve(0)
    },
    log: () => {},
    error: (message) => errors.push(message),
  }
}

Deno.test("deno task compose up beside unmoved Postgres 16 data exits 1 and runs nothing", async () => {
  const h = host({ oldDataExists: true })
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(1)
  expect(h.ran).toEqual([])
  expect(h.errors.join("\n")).toContain("deno task db:upgrade-18")
})

Deno.test("deno task compose up on a machine with no Postgres 16 data builds the base image, then runs", async () => {
  const h = host({})
  expect(await runCompose(["up", "-d", "--build"], h)).toBe(0)
  expect(h.ran).toEqual(["proxy network", "build deno-base", "up -d --build"])
  expect(h.errors).toEqual([])
})
