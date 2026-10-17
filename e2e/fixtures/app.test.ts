/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type { ConsoleMessage, Locator, Page, Request } from "@playwright/test"
import { gotoApp } from "./app.ts"

type Outcome =
  | "boots"
  | "stays blank"
  | "throws while starting"
  | "throws, then a network change"
  | "blank after network change"
  | "blank after a network change of another origin"
  | "waits on a request"

const APP = "http://app.localhost:8080"
type Handler = (arg: never) => void

/** A request for `url` that fails with `errorText`, or never fails when that is left out. */
const fakeRequest = (url: string, errorText?: string, navigation = false) =>
  ({
    url: () => url,
    isNavigationRequest: () => navigation,
    failure: () => (errorText ? { errorText } : null),
  }) as unknown as Request

/**
 * A page whose n-th load ends as `outcomes[n]`, and that records what the helper does to it. A load
 * starts with `page.goto` or with `click`, which stands for a click after which the app loads `url`
 * itself; `starts` lists which one began each load.
 */
function fakePage(outcomes: Outcome[]) {
  const handlers = new Map<string, Set<Handler>>()
  const emit = (event: string, arg: unknown) => {
    for (const handler of handlers.get(event) ?? []) (handler as (arg: unknown) => void)(arg)
  }
  const starts: string[] = []
  const load = (start: string, url: string) => {
    starts.push(start)
    const navigation = fakeRequest(`${APP}${url}`, undefined, true)
    emit("request", navigation)
    emit("requestfinished", navigation)
    const fail = (request: Request) => {
      emit("request", request)
      emit("requestfailed", request)
    }
    const outcome = outcomes[starts.length - 1]
    if (outcome === "blank after network change") {
      fail(fakeRequest(`${APP}/src/main.tsx`, "net::ERR_NETWORK_CHANGED"))
      emit("request", fakeRequest(`${APP}/src/app.css`))
      emit("console", {
        type: () => "error",
        text: () => "Failed to load resource: net::ERR_NETWORK_CHANGED",
      } as ConsoleMessage)
    } else if (outcome === "blank after a network change of another origin") {
      fail(fakeRequest("https://fonts.example/a.css", "net::ERR_NETWORK_CHANGED"))
    } else if (outcome === "stays blank") {
      fail(fakeRequest(`${APP}/src/app.tsx`, "net::ERR_CONNECTION_REFUSED"))
      emit("console", { type: () => "error", text: () => "boom in the module" } as ConsoleMessage)
    } else if (outcome === "throws while starting") {
      emit("pageerror", new Error("signal is not a function"))
    } else if (outcome === "throws, then a network change") {
      emit("pageerror", new Error("signal is not a function"))
      fail(fakeRequest(`${APP}/src/main.tsx`, "net::ERR_NETWORK_CHANGED"))
    } else if (outcome === "waits on a request") {
      emit("request", fakeRequest("https://fonts.example/a.css"))
    }
    return Promise.resolve()
  }
  const page = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, (handlers.get(event) ?? new Set()).add(handler))
    },
    off: (event: string, handler: Handler) => handlers.get(event)?.delete(handler),
    goto: (url: string) => load("goto", url),
  }
  const ready = {
    waitFor: () =>
      outcomes[starts.length - 1] === "boots"
        ? Promise.resolve()
        : Promise.reject(new Error("Timeout 10000ms exceeded")),
  }
  return {
    page: page as unknown as Page,
    ready: ready as unknown as Locator,
    click: (url: string) => load("click", url),
    starts: () => starts,
    loads: () => starts.length,
    listeners: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

Deno.test("gotoApp loads the page again when a network change broke the first load", async () => {
  const fake = fakePage(["blank after network change", "boots"])
  await gotoApp(fake.page, "/sign-in", fake.ready)
  expect(fake.loads()).toBe(2)
})

Deno.test("gotoApp throws without a second load when the page stays blank for another reason", async () => {
  const fake = fakePage(["stays blank", "boots"])
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(1)
})

Deno.test("gotoApp opens the url itself after a network change broke the load a click started", async () => {
  const fake = fakePage(["blank after network change", "boots"])
  await gotoApp(fake.page, "/", fake.ready, () => fake.click("/"))
  expect(fake.starts()).toEqual(["click", "goto"])
})

Deno.test("gotoApp throws after the second load when only the first was broken by a network change", async () => {
  const fake = fakePage(["blank after network change", "stays blank", "boots"])
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(2)
})

Deno.test("gotoApp reports only the requests and the console of its last load", async () => {
  const fake = fakePage(["blank after network change", "stays blank"])
  const error = await gotoApp(fake.page, "/sign-in", fake.ready).catch((e: Error) => e)
  expect((error as Error).message).toContain("Attempt 2 of /sign-in.")
  expect((error as Error).message).toContain("Failed requests (1):")
  expect((error as Error).message).toContain("Pending requests (0):")
  expect((error as Error).message).toContain("Console (1):")
  expect((error as Error).message).not.toContain("net::ERR_NETWORK_CHANGED")
})

Deno.test("gotoApp does not load again for a network change of a request to another origin", async () => {
  const fake = fakePage(["blank after a network change of another origin", "boots"])
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(1)
})

Deno.test("gotoApp gives up after three loads that a network change broke", async () => {
  const fake = fakePage(Array(5).fill("blank after network change"))
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(3)
})

Deno.test("gotoApp names the failed requests and the console in the error it throws", async () => {
  const fake = fakePage(["stays blank"])
  const error = await gotoApp(fake.page, "/sign-in", fake.ready).catch((e: Error) => e)
  expect((error as Error).message).toContain(`${APP}/src/app.tsx net::ERR_CONNECTION_REFUSED`)
  expect((error as Error).message).toContain("error: boom in the module")
})

Deno.test("gotoApp names the uncaught errors of the page in the error it throws", async () => {
  const fake = fakePage(["throws while starting"])
  const error = await gotoApp(fake.page, "/sign-in", fake.ready).catch((e: Error) => e)
  expect((error as Error).message).toContain(
    "Uncaught page errors (1):\nError: signal is not a function",
  )
})

Deno.test("gotoApp reports only the uncaught errors of its last load", async () => {
  const fake = fakePage(["throws, then a network change", "stays blank"])
  const error = await gotoApp(fake.page, "/sign-in", fake.ready).catch((e: Error) => e)
  expect((error as Error).message).toContain("Attempt 2 of /sign-in.")
  expect((error as Error).message).toContain("Uncaught page errors (0):")
})

Deno.test("gotoApp names the requests still pending in the error it throws", async () => {
  const fake = fakePage(["waits on a request"])
  const error = await gotoApp(fake.page, "/sign-in", fake.ready).catch((e: Error) => e)
  expect((error as Error).message).toContain(
    "Pending requests (1):\nhttps://fonts.example/a.css for ",
  )
})

Deno.test("gotoApp stops listening when it returns", async () => {
  const fake = fakePage(["boots"])
  await gotoApp(fake.page, "/sign-in", fake.ready)
  expect(fake.listeners()).toBe(0)
})
