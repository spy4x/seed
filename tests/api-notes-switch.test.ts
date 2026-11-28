/// <reference lib="deno.ns" />
/**
 * `NOTES=false` reaches every part of the API that serves notes (docs/start-a-product.md,
 * "Settings"). `readNotesSetup`, `mountNotesRoutes`, `createNotesOperations`, the admin routes and
 * `AppDbBase`'s notes option have tests of their own; the files below run against the real environment
 * and database at import, so this reads their source to check each one is handed the switch.
 */

import { expect } from "@std/expect"

const read = (path: string) => Deno.readTextFile(new URL(`../${path}`, import.meta.url))

Deno.test("the API's config reads the notes switch from its environment", async () => {
  expect(await read(`apps/api/services/config.ts`)).toMatch(
    /^\s+notes = readNotesSetup\(processEnv\)$/m,
  )
})

Deno.test("the API's entry point hands the notes switch to its routes, admin and bot", async () => {
  const index = await read(`apps/api/index.ts`)
  expect(index).toMatch(/^mountNotesRoutes\(app, config\.notes, \{$/m)
  expect(index).toMatch(/^\s+notes: config\.notes,$/m)
  expect(index).toContain(`createTelegramProduct({ queryBus, notes: config.notes })`)
  expect(index).not.toMatch(/createNotesRoute|createTagsRoute|createTokenApiRoute/)
})

Deno.test("the operations table takes the notes' operations only through their switch", async () => {
  const hub = await read(`apps/api/services/realtimeHub.ts`)
  expect(hub).toMatch(/^\s+\.\.\.createNotesOperations\(config\.notes, \{$/m)
  expect(hub).not.toMatch(/createNoteOperations|createNoteWidgetOperations|createTagOperations/)
  // Attachments come from the kinds the switch leaves registered, not from the notes' table.
  expect(hub).toMatch(
    /^\s+\.\.\.createAttachmentOperations\(attachmentKinds\(config\.notes\), \{$/m,
  )
})

Deno.test("the API's database takes the notes switch", async () => {
  expect(await read(`apps/api/services/db.ts`)).toContain(`notes: config.notes`)
})

/** The registrations in `init` named by `names`, each with whether it sits inside `block`. */
function registrationsIn(init: string, block: string, names: RegExp) {
  const start = init.indexOf(block)
  expect(start).toBeGreaterThan(-1)
  const end = init.indexOf(`\n}\n`, start)
  return [...init.matchAll(/(?:commandBus|queryBus)\.register\(\s*(\w+)/g)]
    .filter(([, name]) => names.test(name))
    .map((registration) => ({
      name: registration[1],
      gated: registration.index! > start && registration.index! < end,
    }))
}

Deno.test("the buses register every note and tag handler only with the notes on", async () => {
  const init = await read(`apps/api/cqrs/+init.ts`)
  const notes = registrationsIn(init, `if (config.notes.on) {`, /^(Note|Tag)/)
  expect(notes.length).toBe(17)
  for (const registration of notes) expect(registration).toEqual({ ...registration, gated: true })
})

Deno.test("the buses register the attachment handlers only while some kind is served", async () => {
  const init = await read(`apps/api/cqrs/+init.ts`)
  const attachments = registrationsIn(
    init,
    `if (attachmentDependencies.kinds.length > 0) {`,
    /^Attachment/,
  )
  expect(attachments.length).toBe(6)
  for (const registration of attachments) {
    expect(registration).toEqual({ ...registration, gated: true })
  }
  expect(await read(`apps/api/cqrs/attachment-dependencies.ts`)).toContain(
    `attachmentKinds(config.notes)`,
  )
})
