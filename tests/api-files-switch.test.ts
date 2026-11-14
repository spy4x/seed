/// <reference lib="deno.ns" />
/**
 * `FILES=false` reaches every part of the API and the worker that would reach the file store
 * (docs/files.md, "Without files"). `readApiEnv`, `isFilesOn`, `FILES_OFF_STORE`, the health and
 * System routes and the data export route have tests of their own; the files below run against the
 * real environment and database at import, so this reads their source to check each one is handed
 * the switch.
 */

import { expect } from "@std/expect"

const read = (path: string) => Deno.readTextFile(new URL(`../${path}`, import.meta.url))

Deno.test("the API's file store is the one that refuses every call while files are off", async () => {
  expect(await read(`apps/api/services/files.ts`)).toContain(
    `config.files ? s3FileStore(config.files) : FILES_OFF_STORE`,
  )
  expect(await read(`apps/api/index.ts`)).toContain(
    `const serverFiles = config.files ? s3ServerFiles(config.files) : FILES_OFF_STORE`,
  )
})

Deno.test("the API's entry point asks no store for health or the System page while files are off", async () => {
  const index = await read(`apps/api/index.ts`)
  expect(index).toContain(`isFileStoreReachable: config.files ? files.isReachable : null,`)
  expect(index).toContain(`fileStoreReachable: config.files ? files.isReachable : null,`)
  expect(index).toContain(`filesOn: config.files !== null,`)
})

Deno.test("the worker reads the files switch before it reads the store's settings", async () => {
  expect(await read(`apps/worker/+main.ts`)).toContain(
    `const filesSetup = isFilesOn(processEnv) ? readServerFilesSetup(processEnv) : null`,
  )
})
