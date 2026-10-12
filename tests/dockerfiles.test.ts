/// <reference lib="deno.ns" />
/**
 * Holds every Dockerfile of the repository to two rules.
 *
 * Every `FROM` names the registry its image comes from (`docker.io/denoland/deno:…`). A short name
 * such as `denoland/deno` is looked up in whatever registries the builder is set up to search, so
 * the same file can pull a different image on another machine. A `FROM ${BASE_IMAGE}` is judged by
 * the default of its build argument; a caller that passes another value answers for that value.
 * The base image is built on the machine itself. Its default name starts with `localhost/`: Podman
 * reads that as a locally built image, and Docker as a registry on this machine, so a build run by
 * hand with the default fails there instead of asking Docker Hub for a stranger's image. Compose,
 * the release pipeline and the e2e scripts all pass `BASE_IMAGE`.
 *
 * Every `deno install` and `deno cache` runs with `--frozen`, so an image build fails when
 * `deno.lock` does not match `deno.jsonc` instead of resolving versions CI never tested.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** A file name that is a Dockerfile: `Dockerfile`, `dockerfile.prod`, `Dockerfile.base`, `api.Dockerfile`. */
export function isDockerfile(name: string): boolean {
  return /^dockerfile(\..+)?$/i.test(name) || /\.dockerfile$/i.test(name)
}

/**
 * A directory the search does not enter. `.volumes` holds the data of the development stack, which
 * belongs to the containers' users and often cannot be read.
 */
export function isSkippedDirectory(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === ".volumes"
}

/** Every Dockerfile under `directory`, as its path from the root. */
async function dockerfiles(directory = ""): Promise<string[]> {
  const found: string[] = []
  for await (const entry of Deno.readDir(`${ROOT}${directory}`)) {
    const path = `${directory}${entry.name}`
    if (entry.isDirectory) {
      if (isSkippedDirectory(entry.name)) continue
      found.push(...await dockerfiles(`${path}/`))
    } else if (entry.isFile && isDockerfile(entry.name)) found.push(path)
  }
  return found.sort()
}

/** The instructions of a Dockerfile: comments dropped, lines ending in `\` joined to the next. */
export function instructions(dockerfile: string): string[] {
  return dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
}

/** Puts the defaults of the `ARG` lines read so far into `${NAME}` and `$NAME`; an unknown name stays. */
function expand(text: string, defaults: Map<string, string>): string {
  return text.replace(
    /\$\{(\w+)\}|\$(\w+)/g,
    (whole, braced, bare) => defaults.get(braced ?? bare) ?? whole,
  )
}

/**
 * The image of every `FROM` that does not name a registry, as the Dockerfile wrote it. A registry
 * is a first path part that is a host: it holds a dot or a port, or is `localhost`. `scratch` and
 * an earlier stage of the same file are no images. A build argument counts with its default, and
 * one without a default names nothing.
 */
export function imagesWithoutRegistry(dockerfile: string): string[] {
  const defaults = new Map<string, string>()
  const stages = new Set<string>()
  const short: string[] = []
  for (const line of instructions(dockerfile)) {
    const arg = /^ARG\s+(\w+)(?:=(.*))?$/i.exec(line)
    if (arg) {
      if (arg[2] !== undefined) defaults.set(arg[1], expand(arg[2].replace(/^"|"$/g, ""), defaults))
      continue
    }
    const from = /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
    if (!from) continue
    const image = expand(from[1], defaults)
    const host = image.includes("/") ? image.split("/")[0] : ""
    const named = /[.:]/.test(host) && !host.includes("$") || host === "localhost"
    if (!named && image !== "scratch" && !stages.has(image.toLowerCase())) short.push(from[1])
    if (from[2]) stages.add(from[2].toLowerCase())
  }
  return short
}

/** Every `deno install`, `deno i` and `deno cache` command that does not run with `--frozen`. */
export function unfrozenInstalls(dockerfile: string): string[] {
  return instructions(dockerfile)
    .filter((line) => /^RUN\s/i.test(line))
    .flatMap((line) => line.replace(/^RUN\s+/i, "").split(/&&|\|\||;|\|/))
    .map((command) => command.trim().replace(/\s+/g, " "))
    .filter((command) => /\bdeno\s+(install|i|cache)\b/.test(command))
    .filter((command) => !/\s--frozen(=true)?(\s|$)/.test(command))
}

/** Every `deno install`, `deno i` and `deno cache` command, frozen or not. */
function installs(dockerfile: string): string[] {
  return instructions(dockerfile).filter((line) =>
    /^RUN\s.*\bdeno\s+(install|i|cache)\b/i.test(line)
  )
}

const read = (path: string) => Deno.readTextFile(`${ROOT}${path}`)

Deno.test("every Dockerfile of the repository is found, in any letter case", async () => {
  // A wrong root or a walk that skips too much must not pass by checking fewer files.
  expect(await dockerfiles()).toEqual(expect.arrayContaining([
    "Dockerfile.base",
    "apps/api/dockerfile",
    "apps/mpa/dockerfile.prod",
    "apps/spa/dockerfile.dev",
    "apps/spa/dockerfile.prod",
  ]))
  expect(
    ["Dockerfile", "dockerfile", "DOCKERFILE.base", "dockerfile.prod", "api.Dockerfile"].filter(
      (name) => !isDockerfile(name),
    ),
  ).toEqual([])
  expect(["dockerfiles.test.ts", "dockerfile-base.test.ts", ".dockerignore"].filter(isDockerfile))
    .toEqual([])
})

Deno.test("every FROM in every Dockerfile names its registry", async () => {
  const short: string[] = []
  for (const path of await dockerfiles()) {
    short.push(...imagesWithoutRegistry(await read(path)).map((image) => `${path}: FROM ${image}`))
  }
  expect(short).toEqual([])
})

Deno.test("every deno install and deno cache in every Dockerfile runs with --frozen", async () => {
  const unfrozen: string[] = []
  for (const path of await dockerfiles()) {
    unfrozen.push(...unfrozenInstalls(await read(path)).map((command) => `${path}: ${command}`))
  }
  expect(unfrozen).toEqual([])
  // The base image installs the dependencies: with that line gone, nothing above would be checked.
  expect(installs(await read("Dockerfile.base"))).toEqual(["RUN deno install --frozen"])
})

Deno.test("a FROM is short when its image, or its build argument's default, has no registry", () => {
  expect(imagesWithoutRegistry(`
    ARG DENO_VERSION=2.9.7
    ARG BASE_IMAGE=app/deno-base:\${DENO_VERSION}
    ARG ELSEWHERE
    FROM denoland/deno:alpine-\${DENO_VERSION}
    FROM \${BASE_IMAGE} AS build
    FROM --platform=linux/amd64 nginx
    FROM $ELSEWHERE
    from library/alpine:3
  `)).toEqual([
    "denoland/deno:alpine-${DENO_VERSION}",
    "${BASE_IMAGE}",
    "nginx",
    "$ELSEWHERE",
    "library/alpine:3",
  ])
})

Deno.test("a FROM is not short for a registry host, localhost, scratch or an earlier stage", () => {
  expect(imagesWithoutRegistry(`
    ARG DENO_VERSION=2.9.7
    ARG BASE_IMAGE="localhost/app/deno-base:\${DENO_VERSION}"
    FROM docker.io/denoland/deno:alpine-\${DENO_VERSION} AS Deps
    FROM \${BASE_IMAGE} AS build
    FROM --platform=linux/amd64 registry.example.com:5000/team/app:1
    FROM localhost:5000/app
    FROM deps
    FROM build AS final
    FROM scratch
  `)).toEqual([])
})

Deno.test("an install is unfrozen without --frozen, with --frozen=false, or beside a frozen one", () => {
  expect(unfrozenInstalls(`
    RUN deno install
    RUN deno install --frozen=false
    RUN deno install --frozen && deno cache apps/healthcheck.ts
    RUN apk add curl; deno i \\
      --allow-scripts
    # RUN deno install
    RUN deno install --frozen
    RUN deno cache --frozen=true apps/healthcheck.ts
    RUN deno task mpa:build
  `)).toEqual([
    "deno install",
    "deno install --frozen=false",
    "deno cache apps/healthcheck.ts",
    "deno i --allow-scripts",
  ])
})

Deno.test("the search for Dockerfiles stays out of git's folder, installed packages and the stack's data", () => {
  expect([".git", "node_modules", ".volumes"].map(isSkippedDirectory)).toEqual([true, true, true])
  expect(["apps", ".woodpecker", "volumes", "infra"].map(isSkippedDirectory)).toEqual([
    false,
    false,
    false,
    false,
  ])
})
