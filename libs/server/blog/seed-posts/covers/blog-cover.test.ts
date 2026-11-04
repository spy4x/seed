import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { FileSystemPort, RunCommandResult } from "@spy4x/platform/server"
import { type CoverDeps, CoverError, coverPrompt, HOUSE_STYLE, makeCover } from "./blog-cover.ts"

/** Stand-ins for the API, the file system and magick, recording what the run asked of each. */
function deps(options: { key?: string; status?: number; magickFails?: boolean } = {}) {
  const calls = { fetch: [] as string[], run: [] as string[][], written: [] as string[] }
  const removed: string[] = []
  const answer = options.status && options.status >= 400
    ? { error: { message: `Billing limit reached` } }
    : { data: [{ b64_json: btoa(`png`) }] }
  const result: CoverDeps = {
    env: { get: (name) => name === `OPENAI_API_KEY` ? options.key : undefined },
    fetch: (input) => {
      calls.fetch.push(String(input))
      return Promise.resolve(Response.json(answer, { status: options.status ?? 200 }))
    },
    fs: {
      writeBytes: (path: string) => {
        calls.written.push(path)
        return Promise.resolve()
      },
      remove: (path: string) => {
        removed.push(path)
        return Promise.resolve()
      },
    } as unknown as FileSystemPort,
    run: (command) => {
      calls.run.push([...command])
      const success = !options.magickFails
      return Promise.resolve(
        { success, code: success ? 0 : 1, stdout: ``, stderr: `` } as RunCommandResult,
      )
    },
    dir: `/covers`,
  }
  return { deps: result, calls, removed }
}

describe(`blog cover script`, () => {
  it(`refuses to call the API without OPENAI_API_KEY`, async () => {
    const { deps: d, calls } = deps()
    await expect(makeCover(`hello`, `A seedling.`, d)).rejects.toThrow(`Set OPENAI_API_KEY`)
    expect(calls.fetch).toEqual([])
  })

  it(`puts the house style before the post's scene`, () => {
    expect(coverPrompt(`  A seedling.  `)).toBe(`${HOUSE_STYLE}\n\nScene: A seedling.`)
  })

  it(`writes a 1600x900, a 960x540 and a 640x360 cover without metadata, then removes the API's picture`, async () => {
    const { deps: d, calls, removed } = deps({ key: `test-key` })
    const written = await makeCover(`hello`, `A seedling.`, d)
    expect(written).toEqual([
      `/covers/hello.webp`,
      `/covers/hello-960.webp`,
      `/covers/hello-640.webp`,
    ])
    expect(calls.run.map((command) => [command.at(-1), command[command.indexOf(`-extent`) + 1]]))
      .toEqual([
        [`/covers/hello.webp`, `1600x900`],
        [`/covers/hello-960.webp`, `960x540`],
        [`/covers/hello-640.webp`, `640x360`],
      ])
    expect(calls.run.every((command) => command.includes(`-strip`))).toBe(true)
    expect(calls.written).toEqual([`/covers/.hello.source.png`])
    expect(removed).toEqual(calls.written)
  })

  it(`removes the API's picture when magick fails`, async () => {
    const { deps: d, calls, removed } = deps({ key: `test-key`, magickFails: true })
    await expect(makeCover(`hello`, `A seedling.`, d)).rejects.toThrow(CoverError)
    expect(calls.written).toEqual([`/covers/.hello.source.png`])
    expect(removed).toEqual(calls.written)
  })

  it(`reports the API's own error message`, async () => {
    const { deps: d } = deps({ key: `test-key`, status: 429 })
    await expect(makeCover(`hello`, `A seedling.`, d)).rejects
      .toThrow(`The Images API answered 429: Billing limit reached`)
  })
})
