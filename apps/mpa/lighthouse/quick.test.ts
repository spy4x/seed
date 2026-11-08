import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { fromFileUrl } from "@std/path"
import { type LighthouseConfig, QUICK_PATHS, quickConfig } from "./quick.ts"

const full = async () =>
  JSON.parse(
    await Deno.readTextFile(fromFileUrl(new URL(`./lighthouserc.json`, import.meta.url))),
  ) as LighthouseConfig

describe(`the pull request's Lighthouse run`, () => {
  it(`measures each quick page once, with the full run's assertions and settings`, async () => {
    const config = await full()
    const quick = quickConfig(config)
    expect(quick.ci.collect.url.map((url) => new URL(url).pathname)).toEqual(QUICK_PATHS)
    expect(quick.ci.collect.numberOfRuns).toBe(1)
    expect(quick.ci.assert).toEqual(config.ci.assert)
    expect(quick.ci.collect.settings).toEqual(config.ci.collect.settings)
    expect(quick.ci.upload).toEqual(config.ci.upload)
  })

  it(`leaves the full run at three runs over more pages than the quick one`, async () => {
    const config = await full()
    expect(config.ci.collect.numberOfRuns).toBe(3)
    expect(config.ci.collect.url.length).toBeGreaterThan(QUICK_PATHS.length)
  })

  it(`refuses a quick page the full list does not measure`, async () => {
    const config = await full()
    config.ci.collect.url = config.ci.collect.url.filter((url) => new URL(url).pathname !== `/docs`)
    expect(() => quickConfig(config)).toThrow(`/docs is in QUICK_PATHS`)
  })
})
