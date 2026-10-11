/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { failOpen, type ICacheStorage } from "@spy4x/platform/cache"
import { createCacheService } from "./cache-service.ts"

class MemoryCacheStorage implements ICacheStorage {
  private values = new Map<string, string>()

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  del(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  reset(): Promise<void> {
    this.values.clear()
    return Promise.resolve()
  }
}

Deno.test("cache service revives a cached expiresAt as a Date", async () => {
  const cache = createCacheService(new MemoryCacheStorage())
  const expiresAt = new Date(Date.now() + 60_000)

  await cache.set("session", { id: 1, expiresAt }, 60)
  const cached = await cache.get<{ id: number; expiresAt: Date }>("session")

  expect(cached?.expiresAt).toBeInstanceOf(Date)
  expect(cached?.expiresAt.getTime()).toBe(expiresAt.getTime())
})

/** A storage that keeps its data across an outage, like Valkey restarted from a snapshot. */
class FlakyCacheStorage extends MemoryCacheStorage {
  down = false
  /** Only `set` fails, like a write that times out while reads still work. */
  failSet = false
  calls = 0

  override get(key: string): Promise<string | null> {
    return this.guard(() => super.get(key))
  }
  override set(key: string, value: string): Promise<void> {
    if (this.failSet) return Promise.reject(new Error("valkey write timed out"))
    return this.guard(() => super.set(key, value))
  }
  override del(key: string): Promise<void> {
    return this.guard(() => super.del(key))
  }
  override reset(): Promise<void> {
    return this.guard(() => super.reset())
  }

  private guard<T>(run: () => Promise<T>): Promise<T> {
    this.calls++
    return this.down ? Promise.reject(new Error("valkey down")) : run()
  }
}

function untrustedFixture() {
  const storage = new FlakyCacheStorage()
  const reports: string[] = []
  let time = 0
  const cache = failOpen(storage, (operation) => reports.push(operation), 5_000, () => time)
  return { storage, reports, cache, advance: (ms: number) => (time += ms) }
}

Deno.test("a failing cache read is a miss and the value is computed and returned", async () => {
  const storage = new FlakyCacheStorage()
  storage.down = true
  const cache = createCacheService(storage, () => {})
  let computed = 0

  const value = await cache.wrap("user_1", () => Promise.resolve({ id: computed++ }), 60)

  expect(value).toEqual({ id: 0 })
  expect(computed).toBe(1)
  expect(await cache.get("user_1")).toBeNull()
})

Deno.test("a failing cache read or write is reported, not thrown", async () => {
  const { storage, reports, cache } = untrustedFixture()
  await cache.get("warm-up") // a first successful operation clears the cache and trusts it
  storage.down = true

  expect(await cache.get("user_1")).toBeNull()
  await cache.set("user_1", "{}", 60)

  expect(reports).toEqual(["get"])
})

Deno.test("a failing cache delete is reported, not thrown", async () => {
  const { storage, reports, cache } = untrustedFixture()
  await cache.get("warm-up") // a first successful operation clears the cache and trusts it
  storage.down = true

  await cache.del("user_1")

  expect(reports).toEqual(["del"])
})

Deno.test("a row cached before an outage is not served after it when its delete was skipped", async () => {
  const { storage, cache, advance } = untrustedFixture()
  await cache.set("user_1", `{"mfa":false}`, 60)
  storage.down = true
  await cache.del("user_1")
  storage.down = false

  expect(await cache.get("user_1")).toBeNull()
  advance(5_000)
  expect(await cache.get("user_1")).toBeNull()
})

Deno.test("a failed cache write marks the cache untrusted so the old row is not served", async () => {
  const { storage, reports, cache, advance } = untrustedFixture()
  await cache.set("user_1", `{"mfa":false}`, 60)
  expect(await cache.get("user_1")).toBe(`{"mfa":false}`)

  storage.failSet = true
  await cache.set("user_1", `{"mfa":true}`, 60)
  storage.failSet = false

  expect(reports).toEqual(["set"])
  // Reads work again, and storage still holds the old row, but the cache must not hand it out.
  expect(await cache.get("user_1")).toBeNull()
  advance(4_999)
  expect(await cache.get("user_1")).toBeNull()
})

Deno.test("an untrusted cache does not touch storage before the retry is due", async () => {
  const { storage, cache, advance } = untrustedFixture()
  storage.down = true
  await cache.get("user_1")
  const callsAfterFailure = storage.calls
  storage.down = false

  advance(4_999)
  await cache.get("user_1")
  await cache.set("user_1", "{}", 60)

  expect(storage.calls).toBe(callsAfterFailure)
})

Deno.test("a cache trusts storage again only after a reset succeeds and then stores values", async () => {
  const { storage, reports, cache, advance } = untrustedFixture()
  await cache.set("user_1", `{"old":true}`, 60)
  storage.down = true
  await cache.get("user_1")

  advance(5_000)
  await cache.get("user_1")
  expect(reports).toEqual(["get", "reset"])

  storage.down = false
  advance(5_000)
  await cache.set("user_1", `{"new":true}`, 60)

  expect(await cache.get("user_1")).toBe(`{"new":true}`)
  expect(reports).toEqual(["get", "reset"])
})

Deno.test("a new cache service clears what an earlier process left before trusting it", async () => {
  const storage = new MemoryCacheStorage()
  await storage.set("user_1", JSON.stringify({ id: 1, mfa: 1 }))
  const cache = createCacheService(storage, () => {})

  expect(await cache.get("user_1")).toBeNull()
})
