/// <reference lib="deno.ns" />
import {
  type CacheErrorReporter,
  CacheService,
  failOpen,
  type ICacheService,
  type ICacheStorage,
  reviveIsoDatesEndingInAt,
} from "@spy4x/platform/cache"
import { log } from "./log.ts"

/**
 * Builds this app's `CacheService`, with the reviver that restores the template's old,
 * unconditional revival of every "*At"-suffixed cached string into a `Date`.
 *
 * Extracted so it can be exercised directly in a test without connecting to Valkey - see
 * `cache-service.test.ts`. Swapping `reviveIsoDatesEndingInAt` for a no-op reviver here would
 * keep every other check green while silently breaking session-expiry checks that compare a
 * cached `expiresAt` against `Date.now()`; the test guards exactly that.
 */
export function createCacheService(
  storage: ICacheStorage,
  onError: CacheErrorReporter = defaultReporter,
  retryMs?: number,
): ICacheService {
  return new CacheService(failOpen(storage, onError, retryMs), {
    reviver: reviveIsoDatesEndingInAt,
  })
}

const defaultReporter: CacheErrorReporter = (operation, error) =>
  log(`cache ${operation} failed, treating the cache as untrusted`, error)
