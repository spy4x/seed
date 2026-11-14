import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { reportCaughtError, startErrorReporting } from "./error-reporting.ts"

function recorder() {
  const urls: string[] = []
  const bodies: string[] = []
  const fetcher = ((url: string, init: RequestInit) => {
    urls.push(url)
    bodies.push(String(init.body))
    return Promise.resolve(new Response("{}"))
  }) as unknown as typeof fetch
  return { urls, bodies, fetcher }
}

function fail(target: EventTarget, type: string, detail: Record<string, unknown>) {
  target.dispatchEvent(Object.assign(new Event(type), detail))
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("the SPA's error reporting", () => {
  it("makes no request without a DSN, whatever the page throws", async () => {
    const { urls, fetcher } = recorder()
    const target = new EventTarget()

    for (const dsn of [undefined, ""]) {
      startErrorReporting({ ERROR_REPORT_DSN: dsn }, target, () => "https://a.example/", fetcher)
    }
    fail(target, "error", { error: new Error("boom") })
    fail(target, "unhandledrejection", { reason: new Error("later") })
    reportCaughtError(new Error("render"))
    await tick()

    expect(urls).toEqual([])
  })

  it("reports an uncaught error, a rejection and a render error to the DSN's tracker", async () => {
    const { urls, bodies, fetcher } = recorder()
    const target = new EventTarget()
    startErrorReporting(
      { ERROR_REPORT_DSN: "https://key@errors.example.com/3", ENV: "prod" },
      target,
      () => "https://app.example.com/invite/SECRETINVITE?next=/x",
      fetcher,
    )

    fail(target, "error", { error: new Error("boom") })
    fail(target, "unhandledrejection", { reason: new Error("later") })
    reportCaughtError(new Error("render"))
    await tick()

    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain("https://errors.example.com/api/3/envelope/")
    for (const body of bodies) {
      expect(body).toContain("https://app.example.com/invite/<REDACTED>")
      expect(body).not.toContain("SECRETINVITE")
      expect(body).not.toContain("next=")
    }
  })

  it("names the build's release in each report, so the tracker finds its source maps", async () => {
    const { bodies, fetcher } = recorder()
    const target = new EventTarget()
    const dsn = "https://key@errors.example.com/3"
    startErrorReporting({ ERROR_REPORT_DSN: dsn, RELEASE: "0123abc" }, target, () => "", fetcher)
    reportCaughtError(new Error("render"))
    await tick()

    expect(JSON.parse(bodies[0].split("\n")[2]).release).toBe("0123abc")
  })

  it("sends no release when the build has none", async () => {
    const { bodies, fetcher } = recorder()
    const target = new EventTarget()
    const dsn = "https://key@errors.example.com/3"
    for (const release of [undefined, ""]) {
      startErrorReporting({ ERROR_REPORT_DSN: dsn, RELEASE: release }, target, () => "", fetcher)
      reportCaughtError(new Error("render"))
      await tick()
    }

    expect(bodies).toHaveLength(2)
    for (const body of bodies) expect(JSON.parse(body.split("\n")[2])).not.toHaveProperty("release")
  })
})
