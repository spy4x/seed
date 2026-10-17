import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { decodeBase64Url, encodeBase64Url } from "@std/encoding"
import { generateVapidKeyPair } from "@spy4x/integrations/push"
import { browserKeys, fakePushService } from "../_testing/web-push.ts"
import type { PushTokenRecord, PushTokenStore } from "./push-token-store.ts"
import { createWebPushService, type PushSenderOptions } from "./web-push-service.ts"

const NOW = new Date("2026-09-30T10:00:00.000Z")

function memoryStore(rows: PushTokenRecord[] = []): PushTokenStore & { rows: PushTokenRecord[] } {
  const live = [...rows]
  return {
    rows: live,
    listByUser: (userId) => Promise.resolve(live.filter((row) => row.userId === userId)),
    upsert: (input) => {
      const row = { id: live.length + 1, ...input, createdAt: NOW, updatedAt: NOW }
      live.push(row)
      return Promise.resolve(row)
    },
    upsertForSession: ({ sessionId: _, ...input }) => {
      const row = { id: live.length + 1, ...input, createdAt: NOW, updatedAt: NOW }
      live.push(row)
      return Promise.resolve(row)
    },
    remove: ({ userId, deviceId }) => {
      const index = live.findIndex((row) => row.userId === userId && row.deviceId === deviceId)
      if (index >= 0) live.splice(index, 1)
      return Promise.resolve()
    },
    deleteByEndpoint: (userId, endpoint) => {
      const index = live.findIndex((row) => row.userId === userId && row.endpoint === endpoint)
      if (index >= 0) live.splice(index, 1)
      return Promise.resolve()
    },
  }
}

const KEYS = await browserKeys()
const VAPID = await generateVapidKeyPair()

function service(store: PushTokenStore, options: PushSenderOptions) {
  return createWebPushService(JSON.stringify(VAPID.keys), options, store)
}

function token(userId: number, deviceId: string): PushTokenRecord {
  return {
    id: userId * 100 + Number(deviceId.slice(-1)),
    userId,
    deviceId,
    endpoint: `https://push.example/${userId}/${deviceId}`,
    ...KEYS,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const message = { title: "Hello", body: "World", url: null }

const endpoints = (requests: { endpoint: string }[]) => requests.map((r) => r.endpoint).sort()

describe("WebPushService.send", () => {
  it("reaches only the target user's devices", async () => {
    const store = memoryStore([token(1, "d1"), token(1, "d2"), token(2, "d1")])
    const push = fakePushService()
    await (await service(store, push.options)).send(1, message)
    expect(endpoints(push.requests)).toEqual([
      "https://push.example/1/d1",
      "https://push.example/1/d2",
    ])
  })

  it("sends nothing for a user without subscriptions", async () => {
    const push = fakePushService()
    await (await service(memoryStore([token(2, "d1")]), push.options)).send(1, message)
    expect(push.requests).toEqual([])
  })

  it("passes the delivery options to the push service", async () => {
    const push = fakePushService()
    await (await service(memoryStore([token(1, "d1")]), push.options)).send(
      1,
      message,
      { urgency: "high", ttl: 60, topic: "news" },
    )
    const { Urgency, TTL, Topic } = push.requests[0].headers
    expect({ Urgency, TTL, Topic }).toEqual({ Urgency: "high", TTL: "60", Topic: "news" })
  })

  it("rejects an invalid payload before sending", async () => {
    const push = fakePushService()
    const result = await (await service(memoryStore([token(1, "d1")]), push.options))
      .send(1, { title: 1 } as never)
    expect(result.error).toContain("invalid push payload")
    expect(push.requests).toEqual([])
  })

  for (const status of [404, 410]) {
    it(`deletes only the subscription the push service reports gone (${status})`, async () => {
      const store = memoryStore([token(1, "d1"), token(1, "d2"), token(2, "d1")])
      const push = fakePushService({ "https://push.example/1/d1": status })
      const result = await (await service(store, push.options)).send(1, message)
      expect(store.rows.map((row) => `${row.userId}/${row.deviceId}`)).toEqual(["1/d2", "2/d1"])
      expect(result.success).toBe(true)
    })
  }

  it("logs a deleted subscription without its endpoint", async () => {
    const store = memoryStore([token(1, "d1")])
    const push = fakePushService({ "https://push.example/1/d1": 410 })
    const logged: unknown[][] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logged.push(args)
    try {
      await (await service(store, push.options)).send(1, message)
    } finally {
      console.log = originalLog
    }
    expect(logged).toEqual([["Subscription is no longer valid, deleted", {
      userId: 1,
      deleted: 1,
    }]])
  })

  it("keeps a subscription after a temporary failure and still tries the other devices", async () => {
    const store = memoryStore([token(1, "d1"), token(1, "d2")])
    const push = fakePushService({ "https://push.example/1/d1": 503 })
    const originalError = console.error
    console.error = () => {}
    try {
      const result = await (await service(store, push.options)).send(1, message)
      expect(result.deliveries.map(({ endpoint, status }) => `${endpoint} ${status}`).sort())
        .toEqual(["https://push.example/1/d1 failed", "https://push.example/1/d2 sent"])
    } finally {
      console.error = originalError
    }
    expect(store.rows.length).toBe(2)
  })
})

describe("WebPushService subscriptions", () => {
  it("stores the subscription for the user and sends a welcome push to it only", async () => {
    const store = memoryStore([token(7, "d1")])
    const push = fakePushService()
    const result = await (await service(store, push.options)).subscribe(
      { endpoint: "https://push.example/new", keys: KEYS, expirationTime: null },
      "device-9",
      7,
      70,
    )
    expect(result).toEqual({
      id: 2,
      userId: 7,
      deviceId: "device-9",
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(store.rows[1].endpoint).toBe("https://push.example/new")
    expect(endpoints(push.requests)).toEqual(["https://push.example/new"])
  })

  it("lists and removes only the given user's devices", async () => {
    const store = memoryStore([token(1, "d1"), token(2, "d1")])
    const webPush = await service(store, fakePushService().options)
    await webPush.unsubscribe("d1", 1)
    expect(await webPush.deviceList(1)).toEqual([])
    expect((await webPush.deviceList(2)).map((device) => device.deviceId)).toEqual(["d1"])
  })
})

/**
 * The key file as `deno task vapid-key:create` wrote it before this change: `@negrel/webpush`
 * 0.5.0's `exportVapidKeys` of an extractable ECDSA P-256 pair, which is WebCrypto's JWK export
 * of each half. Generated here; never a real key.
 */
async function todaysKeyFile() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])
  const json = JSON.stringify({
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  })
  return { json, publicKey: pair.publicKey }
}

describe("createWebPushService with today's key file", () => {
  it("serves the file's public key to browsers", async () => {
    const file = await todaysKeyFile()
    const webPush = await createWebPushService(file.json, fakePushService().options, memoryStore())
    expect(webPush.getPublicKey())
      .toBe(encodeBase64Url(await crypto.subtle.exportKey("raw", file.publicKey)))
  })

  it("signs the welcome push and every later push with the file's key pair", async () => {
    const file = await todaysKeyFile()
    const push = fakePushService()
    const webPush = await createWebPushService(file.json, push.options, memoryStore())
    await webPush.subscribe(
      { endpoint: "https://push.example/new", keys: KEYS, expirationTime: null },
      "device-1",
      1,
      10,
    )
    await webPush.send(1, message)
    expect(push.requests.length).toBe(2)
    for (const { headers } of push.requests) {
      const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(headers.Authorization)
      if (!match) throw new Error(`unexpected Authorization: ${headers.Authorization}`)
      const [, header, payload, signature, key] = match
      expect(key).toBe(webPush.getPublicKey())
      const verified = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        file.publicKey,
        decodeBase64Url(signature),
        new TextEncoder().encode(`${header}.${payload}`),
      )
      expect(verified).toBe(true)
    }
  })
})
