import { RedisKvStore } from "@spy4x/server/kv"
import type { Type } from "arktype"
import { User } from "@domain/identity"
import { config } from "../services/config.ts"

import { buildMethods as buildMethodsBase } from "@spy4x/platform/cache"
import { ONE_MONTH_IN_SECONDS } from "@spy4x/platform/universal/time-constants"
import { createCacheService } from "./cache-service.ts"

// `RedisKvStore` requires a non-empty key prefix (the template's own kv store did not scope its
// keys at all). "api" is this app's own namespace: every key this cache writes now reads
// `api:<prefix>_<id>` instead of the old unprefixed `<prefix>_<id>` — this is a genuine change,
// not merely a rename. A rollback past that change: docs/handoff.md, trap 11.
/** The API's one Valkey connection, shared by the cache and the auth rate limits. */
export const kv = await RedisKvStore.connect(config.kv.hostname, config.kv.port, "api", {
  password: config.kv.password,
})
console.log(`✅ Connected to KV`) // kept from the old client's connect log
const cacheService = createCacheService(kv)

function buildMethods<T>(prefix: string, schema?: Type) {
  return buildMethodsBase<T>(cacheService, prefix, ONE_MONTH_IN_SECONDS, schema)
}

/** True when Valkey answers a command; false on any failure (the store bounds each command). */
export async function isCacheConnected(): Promise<boolean> {
  try {
    await kv.clientId()
    return true
  } catch {
    return false
  }
}

export class PublicAPICache {
  user = buildMethods<User>(`user`)
}

export const publicAPICache = new PublicAPICache()
