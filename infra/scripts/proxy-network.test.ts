/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { ensureProxyNetwork, type RunContainerCli, runContainerCli } from "./proxy-network.ts"

function fakeCli(existing: Set<string>, createCode = 0) {
  const calls: string[] = []
  const run: RunContainerCli = (provider, args) => {
    calls.push(`${provider} ${args.join(` `)}`)
    const [, verb, name] = [args[0], args[1], args[2]]
    if (verb === `inspect`) return Promise.resolve(existing.has(name) ? 0 : 1)
    if (createCode === 0) existing.add(name)
    return Promise.resolve(createCode)
  }
  return { calls, run }
}

Deno.test("ensureProxyNetwork creates the network when it is missing", async () => {
  const cli = fakeCli(new Set())
  expect(await ensureProxyNetwork(`docker`, cli.run)).toBe(true)
  expect(cli.calls).toEqual([`docker network inspect proxy`, `docker network create proxy`])
})

Deno.test("ensureProxyNetwork leaves an existing network alone", async () => {
  const cli = fakeCli(new Set([`proxy`]))
  expect(await ensureProxyNetwork(`docker`, cli.run)).toBe(false)
  expect(cli.calls).toEqual([`docker network inspect proxy`])
})

Deno.test("ensureProxyNetwork fails loudly when the network cannot be created", async () => {
  const cli = fakeCli(new Set(), 1)
  await expect(ensureProxyNetwork(`podman`, cli.run)).rejects.toThrow(`podman exited with 1`)
})

Deno.test("ensureProxyNetwork uses the network name it is given", async () => {
  const cli = fakeCli(new Set())
  await ensureProxyNetwork(`docker`, cli.run, `mine`)
  expect(cli.calls).toEqual([`docker network inspect mine`, `docker network create mine`])
})

// The infra tests run without `--allow-run`, so the spawn is refused: the same "could not start"
// path as a CLI that is not installed.
Deno.test("runContainerCli says the CLI could not be run, not that it exited with a code", async () => {
  await expect(runContainerCli(`docker`, [`version`])).rejects.toThrow(`Could not run docker`)
})
