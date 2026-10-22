/// <reference lib="deno.ns" />
/**
 * Holds the Postgres version and its data directory. Development and production
 * (`infra/compose/compose.shared.yml`), CI (`.woodpecker/ci.yml`) and the local browser run
 * (`infra/scripts/e2e-local.sh`) must name the same Postgres 18 minor version, or a test passes on
 * one version and production runs another. The two documents that print the image must name it
 * too. The Postgres 18 image keeps its data under `/var/lib/postgresql`, in a host directory of
 * its own: mounted at the old path, or on the Postgres 16 directory, it would start empty or not
 * at all (docs/postgres-18-upgrade.md). Its memory settings must fit the memory limit the example
 * env file gives the container, and stay settable for a server with a larger limit.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"
import { NEW_DATA_DIR, OLD_DATA_DIR } from "../infra/scripts/postgres-data.ts"

const ROOT = new URL("../", import.meta.url)
const read = (path: string) => Deno.readTextFile(fromFileUrl(new URL(path, ROOT)))

const COMPOSE = "infra/compose/compose.shared.yml"
/** Every file that names the Postgres image, and how many times it must. */
const IMAGE_PLACES = [
  COMPOSE,
  "infra/postgres/Dockerfile",
  ".woodpecker/ci.yml",
  "infra/scripts/e2e-local.sh",
  "docs/handoff.md",
  "docs/woodpecker-ci-setup.md",
]

/** The tags of every `postgres:<tag>` image in `text`. Other images (`postgres-exporter`) are not matched. */
export function postgresTags(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])postgres:([\w.-]+)/g)].map((match) => match[1])
}

/** `18.6` and `18.6-alpine` give `18.6`; a tag that is not an exact 18 minor gives `undefined`. */
export function pinnedMinor(tag: string): string | undefined {
  return /^(18\.\d+)(-alpine)?$/.exec(tag)?.[1]
}

interface DbService {
  image?: string
  build?: { context?: string; args?: string[] }
  volumes?: string[]
  command?: string[]
}

async function dbService(): Promise<DbService> {
  const compose = parse(await read(COMPOSE)) as { services?: Record<string, DbService> }
  const db = compose.services?.db
  if (!db) throw new Error(`${COMPOSE} has no db service`)
  return db
}

Deno.test("only an exact Postgres 18 minor counts as pinned", () => {
  expect(pinnedMinor("18.6")).toBe("18.6")
  expect(pinnedMinor("18.6-alpine")).toBe("18.6")
  for (const loose of ["18", "18-alpine", "latest", "16", "16.4", "17.2", "19.0", "18.x"]) {
    expect({ tag: loose, minor: pinnedMinor(loose) }).toEqual({ tag: loose, minor: undefined })
  }
})

Deno.test("the Compose database is built on a Postgres 18 minor version", async () => {
  const args = (await dbService()).build?.args ?? []
  const image = /^POSTGRES_IMAGE=docker\.io\/library\/(postgres:.+)$/.exec(args[0] ?? "")?.[1] ?? ""
  expect({ image, minor: pinnedMinor(image.slice("postgres:".length)) }).not.toEqual({
    image,
    minor: undefined,
  })
})

// Browsers still report old zone names (`Asia/Saigon`, `Asia/Calcutta`), and the stock Debian
// image refuses them in `AT TIME ZONE`, so every per-day count fails for those people.
Deno.test("the Compose database image adds the old zone names browsers report", async () => {
  expect((await dbService()).build?.context).toBe("../postgres")
  const dockerfile = await read("infra/postgres/Dockerfile")
  // Copied from the Alpine image without overwriting Debian's own files: no build needs a mirror.
  expect(dockerfile).toMatch(/^FROM docker\.io\/library\/postgres:[\w.]+-alpine AS zones$/m)
  expect(dockerfile).toMatch(/^COPY --from=zones \/usr\/share\/zoneinfo (\S+)$/m)
  expect(dockerfile).toMatch(/\bcp -an\b[^\n]* \/usr\/share\/zoneinfo\//)
  expect(dockerfile).not.toMatch(/apt-get/)
})

Deno.test("Compose, CI, the local browser run and the docs name the same Postgres 18 minor", async () => {
  const minors: Record<string, (string | undefined)[]> = {}
  for (const place of IMAGE_PLACES) {
    const tags = postgresTags(await read(place))
    // A place that stops naming the image must leave this list, not pass unseen.
    expect({ place, images: tags.length > 0 }).toEqual({ place, images: true })
    minors[place] = tags.map(pinnedMinor)
  }
  const expected = pinnedMinor(postgresTags(await read(COMPOSE))[0])
  expect(expected).toBeDefined()
  for (const place of IMAGE_PLACES) {
    expect({ place, minors: minors[place] }).toEqual({
      place,
      minors: minors[place].map(() => expected),
    })
  }
})

Deno.test("Postgres 18 keeps its data under /var/lib/postgresql, in a directory of its own", async () => {
  const mounts = ((await dbService()).volumes ?? []).map((volume) => volume.split(":"))
  // Compose resolves the host path from infra/compose, the scripts from the root.
  const host = (dir: string) => dir.replace(/^\.\//, "../../")
  expect(mounts).toEqual([[host(NEW_DATA_DIR), "/var/lib/postgresql", "Z"]])
  expect(NEW_DATA_DIR).not.toBe(OLD_DATA_DIR)
})

/** `512MB` and `2048m` give megabytes; anything else gives `undefined`. */
export function megabytes(size: string): number | undefined {
  const match = /^(\d+)(MB|m)$/.exec(size)
  return match ? Number(match[1]) : undefined
}

/** The env variable and the default of one `name=${VARIABLE:-default}` server setting. */
function setting(command: string[], name: string): { variable?: string; fallback?: string } {
  const value = command.find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? ""
  const match = /^\$\{(DB_[A-Z_]+):-([^}]+)\}$/.exec(value)
  return { variable: match?.[1], fallback: match?.[2] }
}

Deno.test("Postgres' memory settings come from the env file and their defaults fit the example memory limit", async () => {
  const command = (await dbService()).command ?? []
  const names = {
    shared_buffers: "DB_SHARED_BUFFERS",
    work_mem: "DB_WORK_MEM",
    maintenance_work_mem: "DB_MAINTENANCE_WORK_MEM",
    effective_cache_size: "DB_EFFECTIVE_CACHE_SIZE",
    autovacuum_work_mem: "DB_AUTOVACUUM_WORK_MEM",
  }
  const defaults: Record<string, number> = {}
  for (const [name, variable] of Object.entries(names)) {
    const found = setting(command, name)
    // A fixed number here would take memory from a server whose env file raises the limit.
    expect({ name, variable: found.variable }).toEqual({ name, variable })
    const size = megabytes(found.fallback ?? "")
    expect({ name, megabytes: size }).not.toEqual({ name, megabytes: undefined })
    defaults[name] = size!
  }
  const example = await read("infra/envs/.env.example")
  const limit = megabytes(/^DB_MEM_LIMIT=(.+)$/m.exec(example)?.[1] ?? "")
  expect(limit).toBeDefined()
  const connections = Number(
    command.find((part) => part.startsWith("max_connections="))?.split("=")[1],
  )
  expect(connections).toBeGreaterThan(0)
  // The most Postgres takes at once: its shared buffers, one sort per connection, one
  // maintenance run and the three autovacuum workers it starts by default.
  const most = defaults.shared_buffers + connections * defaults.work_mem +
    defaults.maintenance_work_mem + 3 * defaults.autovacuum_work_mem
  expect({ most, fits: most <= limit! }).toEqual({ most, fits: true })
  // The planner's hint counts the page cache too, but never more than the container may hold.
  expect(defaults.effective_cache_size).toBeLessThanOrEqual(limit!)
  // The example file names every variable, so the person who raises the limit sees them.
  for (const variable of Object.values(names)) {
    expect({ variable, named: example.includes(`${variable}=`) }).toEqual({ variable, named: true })
  }
})
