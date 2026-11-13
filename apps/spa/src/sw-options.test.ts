/// <reference lib="deno.ns" />
/**
 * The app reads `/config.json` before it renders, so the service worker must store it with the app
 * shell and answer from that copy when the network fails: otherwise the app cannot start offline.
 * These tests run the shared worker (`installOfflineShell`) with this app's options against a fake
 * worker scope.
 */

import { expect } from "@std/expect"
import { installOfflineShell, type ShellScope } from "@spy4x/platform/browser/offline-shell"
import { shellOptions } from "./sw-options.ts"

type Handler = (event: Record<string, unknown>) => void

/** Installs the worker on a fake scope and returns what it registered and stored. */
function loadWorker(network: (path: string) => Response | Error, buildId = `abc123`) {
  const caches = new Map<string, Map<string, Response>>()
  const handlers = new Map<string, Handler>()
  const key = (input: string | Request) =>
    new URL(String(typeof input === `string` ? input : input.url), `https://app.example`).pathname
  const fakeFetch = (input: string | Request) => {
    const result = network(key(input))
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  }
  const open = (name: string) => {
    const stored = caches.get(name) ?? new Map<string, Response>()
    caches.set(name, stored)
    return Promise.resolve({
      put: (input: string | Request, response: Response) => {
        stored.set(key(input), response)
        return Promise.resolve()
      },
      add: async (input: string | Request) => {
        stored.set(key(input), await fakeFetch(input))
      },
      match: (input: string | Request) => Promise.resolve(stored.get(key(input))?.clone()),
    })
  }
  const scope: ShellScope = {
    location: { origin: `https://app.example` },
    navigator: { onLine: false },
    caches: {
      open,
      keys: () => Promise.resolve([...caches.keys()]),
      delete: (name) => Promise.resolve(caches.delete(name)),
    },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
    fetch: fakeFetch,
    addEventListener: (type, handler) => handlers.set(type, handler),
  }
  installOfflineShell(scope, shellOptions(buildId))
  return { caches, handlers }
}

Deno.test(`the worker stores /config.json with the page when it installs`, async () => {
  const { caches, handlers } = loadWorker((path) =>
    path === `/`
      ? new Response(`<script src="/assets/a.js"></script>`, {
        headers: { "content-type": `text/html` },
      })
      : new Response(`{"env":"prod"}`)
  )
  let waiting: Promise<unknown> = Promise.resolve()
  handlers.get(`install`)!({ waitUntil: (p: Promise<unknown>) => (waiting = p) })
  await waiting

  expect(await caches.get(`shell-abc123`)?.get(`/config.json`)?.text()).toBe(`{"env":"prod"}`)
})

Deno.test(`the worker answers /config.json from its copy when the network fails`, async () => {
  let online = true
  const { handlers } = loadWorker((path) =>
    online ? new Response(`{"env":"prod"}`) : new Error(`offline ${path}`)
  )
  const ask = async (path: string) => {
    let answer: Promise<Response> | undefined
    handlers.get(`fetch`)!({
      request: new Request(`https://app.example${path}`),
      respondWith: (p: Promise<Response>) => (answer = p),
      waitUntil: (p: Promise<unknown>) => p,
    })
    return answer
  }

  await (await ask(`/config.json`))!.text()
  await new Promise((resolve) => setTimeout(resolve, 0))
  online = false

  expect(await (await ask(`/config.json`))!.text()).toBe(`{"env":"prod"}`)
})

Deno.test(`the worker leaves /api and /ws requests to the network`, () => {
  const { handlers } = loadWorker(() => new Response(`x`))
  for (const path of [`/api/notes`, `/ws`, `/ws/socket`]) {
    let answered = false
    handlers.get(`fetch`)!({
      request: new Request(`https://app.example${path}`),
      respondWith: () => (answered = true),
      waitUntil: () => {},
    })
    expect(answered, path).toBe(false)
  }
})

/** Whether the worker answers a GET of `path` itself, rather than leaving it to the browser. */
function answers(buildId: string, path: string): boolean {
  const { handlers } = loadWorker(() => new Response(`x`), buildId)
  let answered = false
  handlers.get(`fetch`)!({
    request: new Request(`https://app.example${path}`),
    respondWith: () => (answered = true),
    waitUntil: () => {},
  })
  return answered
}

const DEV_MODULES = [
  `/@id/__x00__deno::TSX::https://jsr.io/@spy4x/preact-ui/14.4.0/combobox.tsx`,
  `/@fs/home/me/seed/libs/domain/notes/+lib.ts`,
  `/@vite/client`,
  `/src/main.tsx`,
  `/node_modules/.vite/deps/preact.js?v=1a2b3c4d`,
]

Deno.test(`the dev server's worker leaves the app's modules to the browser`, () => {
  for (const path of DEV_MODULES) expect(answers(`dev`, path), path).toBe(false)
  expect(answers(`dev`, `/config.json`)).toBe(true)
})

Deno.test(`a built worker still answers those paths, as it answers any file outside /api and /ws`, () => {
  for (const path of DEV_MODULES) expect(answers(`abc123`, path), path).toBe(true)
})

Deno.test(`a new build stores the shell under a new cache name and drops the old one`, async () => {
  const { caches, handlers } = loadWorker(() => new Response(`x`), `two`)
  caches.set(`shell-one`, new Map())
  let waiting: Promise<unknown> = Promise.resolve()
  handlers.get(`activate`)!({ waitUntil: (p: Promise<unknown>) => (waiting = p) })
  await waiting

  expect(shellOptions(`two`).cacheName).toBe(`shell-two`)
  expect([...caches.keys()]).not.toContain(`shell-one`)
})
