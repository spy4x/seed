/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  containerProvider,
  ensureProxyNetwork,
  PROXY_UP,
  type RunContainerCli,
  runContainerCli,
  startProxy,
} from "./proxy-network.ts"

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

Deno.test("an env file without CONTAINER_PROVIDER, or with it empty, runs Docker", () => {
  expect(containerProvider({})).toBe(`docker`)
  expect(containerProvider({ CONTAINER_PROVIDER: `` })).toBe(`docker`)
})

Deno.test("CONTAINER_PROVIDER picks Docker or Podman by name", () => {
  expect(containerProvider({ CONTAINER_PROVIDER: `docker` })).toBe(`docker`)
  expect(containerProvider({ CONTAINER_PROVIDER: `podman` })).toBe(`podman`)
})

Deno.test("a CONTAINER_PROVIDER that names neither engine is refused, not replaced by a default", () => {
  expect(() => containerProvider({ CONTAINER_PROVIDER: `Podman` })).toThrow(
    `CONTAINER_PROVIDER must be "docker" or "podman", not "Podman"`,
  )
})

/** `running` is what `inspect` prints: `true`, `false`, or `` for no such container. */
function fakeEngine(running: string, startCode = 0) {
  const calls: string[] = []
  const ask = (command: string[]) => {
    calls.push(command.join(` `))
    return Promise.resolve({ code: running === `` ? 1 : 0, stdout: `${running}\n` })
  }
  const start = (command: string[]) => {
    calls.push(command.join(` `))
    return Promise.resolve(startCode)
  }
  return { calls, ask, start }
}

const INSPECT = `container inspect -f {{.State.Running}} traefik`

Deno.test("startProxy leaves a running Traefik alone", async () => {
  const engine = fakeEngine(`true`)
  expect(await startProxy(`docker`, engine.ask, engine.start)).toBe(`running`)
  expect(engine.calls).toEqual([`docker ${INSPECT}`])
})

Deno.test("startProxy creates Traefik like proxy:start when there is none", async () => {
  const engine = fakeEngine(``)
  expect(await startProxy(`docker`, engine.ask, engine.start)).toBe(`started`)
  expect(engine.calls).toEqual([`docker ${INSPECT}`, PROXY_UP.join(` `)])
})

Deno.test("startProxy starts a stopped Traefik as it is, whichever project made it", async () => {
  for (const provider of [`docker`, `podman`] as const) {
    const engine = fakeEngine(`false`)
    expect(await startProxy(provider, engine.ask, engine.start)).toBe(`started`)
    expect(engine.calls).toEqual([`${provider} ${INSPECT}`, `${provider} start traefik`])
  }
})

Deno.test("startProxy creates nothing under Podman", async () => {
  const engine = fakeEngine(``)
  expect(await startProxy(`podman`, engine.ask, engine.start)).toBe(`manual`)
  expect(engine.calls).toEqual([`podman ${INSPECT}`])
})

Deno.test("startProxy fails, naming the command, when the start fails", async () => {
  const engine = fakeEngine(``, 1)
  await expect(startProxy(`docker`, engine.ask, engine.start)).rejects.toThrow(
    `${PROXY_UP.join(` `)} exited with 1`,
  )
})

Deno.test("PROXY_UP is the command proxy:start runs", async () => {
  const tasks = await Deno.readTextFile(`deno.jsonc`)
  expect(tasks).toContain(`deno task proxy:network && ${PROXY_UP.join(` `)}"`)
})
