/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { healthcheck } from "./healthcheck.ts"

/** The exit code the check chose, thrown so the test runner never exits. */
class Exited extends Error {
  constructor(readonly code: number) {
    super(`exited with ${code}`)
  }
}

/** Runs the check against a fake loopback service that answers `status`; records what it reached. */
async function check(args: string[], status: number) {
  const reached: string[] = []
  const env = new Map([["HEALTHCHECK_PORT", "8000"]])
  let code: number | undefined
  try {
    await healthcheck(args, { get: (name) => env.get(name) }, {
      connector: {
        connect: ({ hostname, port }) => {
          reached.push(`connect ${hostname}:${port}`)
          return Promise.resolve({ close: () => {} })
        },
      },
      fetcher: {
        fetch: (url) => {
          reached.push(`GET ${url}`)
          return Promise.resolve(new Response(null, { status }))
        },
      },
      exit: (exitCode) => {
        throw new Exited(exitCode)
      },
    })
  } catch (error) {
    if (!(error instanceof Exited)) throw error
    code = error.code
  }
  return { reached, code }
}

Deno.test("the healthcheck asks for the path it is given, on the port from the environment", async () => {
  expect(await check(["/api/health"], 200)).toEqual({
    reached: ["GET http://127.0.0.1:8000/api/health"],
    code: 0,
  })
})

Deno.test("the healthcheck reports a service unhealthy when its path does not answer 200", async () => {
  // An API that lost its database still accepts connections; only the path tells.
  expect(await check(["/api/health"], 503)).toEqual({
    reached: ["GET http://127.0.0.1:8000/api/health"],
    code: 1,
  })
})

Deno.test("the healthcheck only connects when it is given no path", async () => {
  expect(await check([], 503)).toEqual({ reached: ["connect 127.0.0.1:8000"], code: 0 })
})
