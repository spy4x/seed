/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { forwardedHead, parseHead, upstreamFor } from "./e2e-local-proxy.ts"

const head = (...lines: string[]): string => [...lines, "", ""].join("\r\n")

Deno.test("forwardedHead replaces a forged X-Real-IP and X-Forwarded-For with the address it sees", () => {
  const forwarded = forwardedHead(
    head(
      "GET /api/auth/me HTTP/1.1",
      "Host: app.localhost",
      "x-real-ip: 203.0.113.42",
      "X-Forwarded-For: 203.0.113.42, 198.51.100.7",
      "Cookie: session=abc",
    ),
    "127.0.0.1",
  )
  expect(forwarded?.split("\r\n")).toEqual([
    "GET /api/auth/me HTTP/1.1",
    "Host: app.localhost",
    "Cookie: session=abc",
    "X-Real-IP: 127.0.0.1",
    "X-Forwarded-For: 127.0.0.1",
    "Connection: close",
    "",
    "",
  ])
})

Deno.test("forwardedHead closes the connection after a plain request, so a second one cannot skip the rewrite", () => {
  const forwarded = forwardedHead(head("GET / HTTP/1.1", "Connection: keep-alive"), "127.0.0.1")
  expect(forwarded?.split("\r\n").filter((line) => /^connection/i.test(line))).toEqual([
    "Connection: close",
  ])
})

Deno.test("forwardedHead lets a WebSocket handshake upgrade, sets the address and closes the connection when the upgrade is refused", () => {
  const forwarded = forwardedHead(
    head(
      "GET /api/ws/profile HTTP/1.1",
      "Connection: Upgrade",
      "Upgrade: websocket",
      "X-Real-IP: 203.0.113.42",
    ),
    "127.0.0.1",
  )
  expect(forwarded?.split("\r\n")).toEqual([
    "GET /api/ws/profile HTTP/1.1",
    "Upgrade: websocket",
    "X-Real-IP: 127.0.0.1",
    "X-Forwarded-For: 127.0.0.1",
    "Connection: Upgrade, close",
    "",
    "",
  ])
})

Deno.test("parseHead reads the path and whether the request is a WebSocket handshake", () => {
  expect(parseHead(head("POST /api/notes?x=1 HTTP/1.1", "Host: app.localhost"))).toEqual({
    path: "/api/notes?x=1",
    isWebSocket: false,
  })
  expect(parseHead(head("GET /api/ws HTTP/1.1", "upgrade: WebSocket")).isWebSocket).toBe(true)
})

Deno.test("forwardedHead refuses a head that hides a header behind a bare line feed or carriage return", () => {
  for (const hidden of ["Foo: bar\nX-Real-IP: 203.0.113.42", "Foo: bar\rX-Real-IP: 203.0.113.42"]) {
    expect(forwardedHead(head("GET /api/auth/me HTTP/1.1", hidden), "127.0.0.1")).toBeNull()
  }
})

Deno.test("upstreamFor sends /api to the API, the bucket to the file store and the rest to the SPA", () => {
  const upstreams = { api: 1, spa: 2, files: { port: 3, bucket: "e2e-files" } }
  expect(upstreamFor("/api/health", upstreams)).toBe(1)
  expect(upstreamFor("/e2e-files/uploads/tmp/a?X-Amz-Signature=x", upstreams)).toBe(3)
  expect(upstreamFor("/e2e-files?list-type=2", upstreams)).toBe(3)
  expect(upstreamFor("/e2e-filesystem", upstreams)).toBe(2)
  expect(upstreamFor("/profile/account", upstreams)).toBe(2)
  expect(upstreamFor("/e2e-files/a", { api: 1, spa: 2 })).toBe(2)
})
