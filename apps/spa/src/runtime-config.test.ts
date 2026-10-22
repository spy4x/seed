import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { loadRuntimeConfig } from "./runtime-config.ts"
import { startErrorReporting } from "./error-reporting.ts"

function serving(
  body: string,
  status = 200,
): { fetcher: typeof fetch; urls: string[]; inits: (RequestInit | undefined)[] } {
  const urls: string[] = []
  const inits: (RequestInit | undefined)[] = []
  const fetcher = ((url: string, init?: RequestInit) => {
    urls.push(url)
    inits.push(init)
    return Promise.resolve(new Response(body, { status }))
  }) as unknown as typeof fetch
  return { fetcher, urls, inits }
}

/** Runs `run` with `console.warn` captured, so a fallback's warning is checked, not printed. */
async function warned<T>(run: () => Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
  const original = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => void warnings.push(args)
  try {
    return { result: await run(), warnings }
  } finally {
    console.warn = original
  }
}

describe("the SPA's runtime configuration", () => {
  it("reads the environment label and the DSN from /config.json", async () => {
    const { fetcher, urls } = serving(
      `{"env":"stag","errorReportDsn":"https://k@tracker.example/1"}`,
    )

    const config = await loadRuntimeConfig(fetcher)

    expect(config).toEqual({ env: "stag", errorReportDsn: "https://k@tracker.example/1" })
    expect(urls).toEqual(["/config.json"])
  })

  it("asks the network, not the browser's HTTP cache", async () => {
    const { fetcher, inits } = serving(`{}`)

    await loadRuntimeConfig(fetcher)

    expect(inits[0]?.cache).toBe("no-store")
  })

  it("drops keys the schema does not name", async () => {
    const { fetcher } = serving(`{"env":"prod","secret":"x"}`)

    expect(await loadRuntimeConfig(fetcher)).toEqual({ env: "prod" })
  })

  it("falls back to the defaults for a file of the wrong shape, a bad status or bad JSON", async () => {
    for (const bad of [serving(`{"env":5}`), serving(`{}`, 404), serving(`<html>`)]) {
      const { result, warnings } = await warned(() => loadRuntimeConfig(bad.fetcher))
      expect(result).toEqual({})
      expect(warnings.length).toBe(1)
    }
  })

  it("turns the demo flag on for true only, and keeps the rest of the file for any value", async () => {
    for (
      const [value, demo] of [[`"true"`, true], [`true`, true], [`"1"`, false], [`"no"`, false]]
    ) {
      const config = await loadRuntimeConfig(serving(`{"env":"prod","demo":${value}}`).fetcher)
      expect(config).toEqual({ env: "prod", demo })
    }
  })

  it("turns guest accounts off for false only, so an unset switch keeps them on", async () => {
    for (
      const [value, guest] of [[`"false"`, false], [`false`, false], [`"FALSE"`, false], [
        `""`,
        true,
      ], [`"true"`, true]]
    ) {
      const config = await loadRuntimeConfig(serving(`{"guest":${value}}`).fetcher)
      expect(config).toEqual({ guest })
    }
  })

  it("reads the module switches, written as booleans or as the container's text", async () => {
    const asBooleans = await loadRuntimeConfig(serving(`{"realtime":false,"offline":true}`).fetcher)
    const asText = await loadRuntimeConfig(serving(`{"realtime":"false","offline":"true"}`).fetcher)

    expect(asBooleans).toEqual({ realtime: false, offline: true })
    expect(asText).toEqual({ realtime: false, offline: true })
  })

  it("switches a module off for 0 and on for 1, as the container writes them", async () => {
    const { result, warnings } = await warned(() =>
      loadRuntimeConfig(serving(`{"realtime":"1","offline":"0"}`).fetcher)
    )

    expect(result).toEqual({ realtime: true, offline: false })
    expect(warnings).toEqual([])
  })

  it("reads a switch written in capitals", async () => {
    const config = await loadRuntimeConfig(serving(`{"realtime":"FALSE","offline":"True"}`).fetcher)

    expect(config).toEqual({ realtime: false, offline: true })
  })

  it("keeps the error tracker's address when a switch is set to 0", async () => {
    const file = `{"env":"prod","errorReportDsn":"https://k@tracker.example/1","offline":"0"}`

    const config = await loadRuntimeConfig(serving(file).fetcher)

    expect(config.errorReportDsn).toBe("https://k@tracker.example/1")
    expect(config.env).toBe("prod")
    expect(config.offline).toBe(false)
  })

  it("refuses a switch it cannot read aloud, runs the module and keeps the rest of the file", async () => {
    const file = `{"errorReportDsn":"https://k@tracker.example/1","offline":"off","realtime":2}`

    const { result, warnings } = await warned(() => loadRuntimeConfig(serving(file).fetcher))

    expect(result).toEqual({
      errorReportDsn: "https://k@tracker.example/1",
      offline: true,
      realtime: true,
    })
    expect(warnings.map((warning) => String(warning[0])).sort().reverse()).toEqual([
      `Runtime config: "realtime" must be true, false, 1 or 0, so it is ignored and the module runs.`,
      `Runtime config: "offline" must be true, false, 1 or 0, so it is ignored and the module runs.`,
    ])
  })

  it("falls back to the defaults when the network fails", async () => {
    const fetcher = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch

    const { result, warnings } = await warned(() => loadRuntimeConfig(fetcher))
    expect(result).toEqual({})
    expect(warnings.length).toBe(1)
  })

  it("makes one build report to the tracker its config file names, and to none without one", async () => {
    const sent: string[] = []
    const tracker = ((url: string) => {
      sent.push(url)
      return Promise.resolve(new Response("{}"))
    }) as unknown as typeof fetch
    const files = [
      `{"errorReportDsn":"https://k@one.example/1"}`,
      `{"errorReportDsn":"https://k@two.example/2"}`,
      `{}`,
    ]

    for (const file of files) {
      const config = await loadRuntimeConfig(serving(file).fetcher)
      const target = new EventTarget()
      startErrorReporting(
        { ERROR_REPORT_DSN: config.errorReportDsn, ENV: config.env },
        target,
        () => "https://a.example/",
        tracker,
      )
      target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("boom") }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(sent.length).toBe(2)
    expect(sent[0]).toContain("one.example")
    expect(sent[1]).toContain("two.example")
  })
})
