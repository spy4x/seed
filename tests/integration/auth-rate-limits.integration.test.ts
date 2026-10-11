/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono, type MiddlewareHandler } from "hono"
import { createRedisRateLimitStore, RedisKvStore } from "@spy4x/server/kv"
import type { APIContext } from "../../apps/api/_types.ts"
import {
  type AuthRateLimits,
  createAuthRateLimits,
} from "../../apps/api/middlewares/auth-rate-limits.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The auth rate limits over a real Valkey, through the same `createRedisRateLimitStore` the API
 * uses. A "restart" closes the connection and builds new limits over a new one, as a redeployed API
 * does.
 *
 * Needs `KV_HOSTNAME`, `KV_PORT` and `KV_PASSWORD` (recipe in docs/handoff.md). It fails when they
 * are missing rather than skipping.
 */

const REQUIRED_KV_ENV = ["KV_HOSTNAME", "KV_PORT", "KV_PASSWORD"] as const
const missing = REQUIRED_KV_ENV.filter((name) => !Deno.env.get(name))
if (missing.length) {
  throw new Error(`integration test needs ${missing.join(", ")} (recipe in docs/handoff.md)`)
}

const limits = { windowMs: 60_000, strictLimit: 3, limit: 2, otpWindowMs: 900_000, otpLimit: 5 }

/** Connects under a prefix of its own, so parallel runs and the API's own keys never meet. */
function connect(prefix: string): Promise<RedisKvStore> {
  return RedisKvStore.connect(
    Deno.env.get("KV_HOSTNAME")!,
    Number(Deno.env.get("KV_PORT")),
    prefix,
    {
      password: Deno.env.get("KV_PASSWORD")!,
    },
  )
}

/** An API process: its own Valkey connection and its own auth limits over it. */
async function startApi(prefix: string): Promise<{ limits: AuthRateLimits; kv: RedisKvStore }> {
  const kv = await connect(prefix)
  return {
    kv,
    limits: createAuthRateLimits({
      ...limits,
      store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
      onStoreError: (error) => {
        throw error
      },
    }),
  }
}

/** One route behind `limit` whose handler answers `status`, for a signed-in user 7. */
function appBehind(limit: MiddlewareHandler<APIContext>, status: 200 | 401) {
  return new Hono<APIContext>()
    .use((c, next) => {
      c.set("auth", { user: { id: 7 } } as APIContext["Variables"]["auth"])
      return next()
    })
    .post("/guess", limit, (c) => c.json({}, status))
}

async function statuses(app: ReturnType<typeof appBehind>, count: number): Promise<number[]> {
  const result: number[] = []
  for (let i = 0; i < count; i++) {
    const response = await app.request("http://api.test/guess", {
      method: "POST",
      headers: { "x-real-ip": "192.0.2.7" },
    })
    result.push(response.status)
  }
  return result
}

interface Case {
  name: string
  budget: number
  pick: (limits: AuthRateLimits) => MiddlewareHandler<APIContext>
}
const cases: Case[] = [
  { name: "strict sign-in budget per IP", budget: limits.strictLimit, pick: (l) => l.strictByIp },
  { name: "one-time-code budget per user", budget: limits.otpLimit, pick: (l) => l.otpByUser },
]

for (const { name, budget, pick } of cases) {
  Deno.test(`a ${name} spent before an API restart is still spent after it`, async () => {
    const prefix = `it-auth-rate-limits-${uuidV7()}`
    const before = await startApi(prefix)
    let after: Awaited<ReturnType<typeof startApi>> | undefined
    try {
      const spent = await statuses(appBehind(pick(before.limits), 401), budget)
      before.kv.close()

      after = await startApi(prefix)
      const afterRestart = await statuses(appBehind(pick(after.limits), 401), 1)

      expect(spent).toEqual(Array(budget).fill(401))
      expect(afterRestart).toEqual([429])
    } finally {
      before.kv.close()
      const cleanup = after ?? (await startApi(prefix))
      await cleanup.kv.reset()
      cleanup.kv.close()
    }
  })
}
