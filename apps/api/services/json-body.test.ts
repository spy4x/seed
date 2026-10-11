import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { MAX_JSON_BODY_BYTES, readApiJson, readFeatureJson } from "./json-body.ts"

/** A route that echoes the body it read, with Hono's default error handling. */
function buildApp() {
  return new Hono().post("/echo", async (c) => c.json({ body: await readApiJson(c) }))
}

/** A JSON string literal of exactly `bytes` bytes. */
function jsonOfSize(bytes: number): string {
  return JSON.stringify("a".repeat(bytes - 2))
}

describe("readApiJson", () => {
  it("accepts a body of exactly the cap", async () => {
    const body = jsonOfSize(MAX_JSON_BODY_BYTES)
    const response = await buildApp().request("http://local/echo", { method: "POST", body })

    expect(response.status).toBe(200)
    expect((await response.json()).body).toHaveLength(MAX_JSON_BODY_BYTES - 2)
  })

  it("answers a body one byte over the cap with 413", async () => {
    const body = jsonOfSize(MAX_JSON_BODY_BYTES + 1)
    const response = await buildApp().request("http://local/echo", { method: "POST", body })

    expect(response.status).toBe(413)
  })

  it("answers a body that is not JSON with 400", async () => {
    const response = await buildApp().request("http://local/echo", {
      method: "POST",
      body: `{"a":`,
    })

    expect(response.status).toBe(400)
  })
})

class TestError extends Error {}

/** A route that reads its body with `readFeatureJson` and answers a `TestError` with 422. */
function buildFeatureApp() {
  return new Hono()
    .onError((error, c) => c.text(error.message, error instanceof TestError ? 422 : 500))
    .post("/echo", async (c) => {
      return c.json({ body: await readFeatureJson(c, (message) => new TestError(message)) })
    })
}

describe("readFeatureJson", () => {
  const post = (body: string, contentType?: string) =>
    buildFeatureApp().request("http://local/echo", {
      method: "POST",
      body,
      headers: contentType ? { "content-type": contentType } : {},
    })

  it("returns the body of a request declared as JSON", async () => {
    const response = await post(`{"a":1}`, "application/json; charset=utf-8")

    expect(response.status).toBe(200)
    expect((await response.json()).body).toEqual({ a: 1 })
  })

  it("accepts a JSON type written in upper case", async () => {
    const response = await post(`{"a":1}`, "Application/JSON")

    expect(response.status).toBe(200)
  })

  it("refuses a body that is not declared as JSON in the feature's error", async () => {
    const response = await post(`{"a":1}`, "text/plain")

    expect(response.status).toBe(422)
    expect(await response.text()).toBe("Content type must be JSON")
  })

  it("refuses a type that only contains the JSON type's name", async () => {
    for (const contentType of ["text/plain; note=application/json", "application/jsonl"]) {
      const response = await post(`{"a":1}`, contentType)

      expect(response.status).toBe(422)
      expect(await response.text()).toBe("Content type must be JSON")
    }
  })

  it("refuses a request with no content type in the feature's error", async () => {
    const response = await post(`{"a":1}`)

    expect(response.status).toBe(422)
    expect(await response.text()).toBe("Content type must be JSON")
  })

  it("refuses a body that is not JSON in the feature's error", async () => {
    const response = await post(`{"a":`, "application/json")

    expect(response.status).toBe(422)
    expect(await response.text()).toBe("Request body must be JSON")
  })

  it("refuses a body over the cap in the feature's error", async () => {
    const response = await post(jsonOfSize(MAX_JSON_BODY_BYTES + 1), "application/json")

    expect(response.status).toBe(422)
    expect(await response.text()).toBe("Request body must be JSON")
  })

  it("refuses a body whose upload breaks part-way in the feature's error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"a":`))
        controller.error(new Error("connection reset"))
      },
    })
    const response = await buildFeatureApp().request("http://local/echo", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    })

    expect(response.status).toBe(422)
    expect(await response.text()).toBe("Request body must be JSON")
  })
})
