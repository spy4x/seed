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
  expect(index).not.toMatch(/createNotesRoute|createTokenApiRoute/)
})

Deno.test("the entry point mounts the tags route whatever the notes switch says, before /groups", async () => {
  const index = await read(`apps/api/index.ts`)
  const tags = index.search(/^app\.route\("\/groups\/:groupId\/tags", createTagsRoute\(/m)
  expect(tags).toBeGreaterThan(-1)
  expect(tags).toBeLessThan(index.search(/^app\.route\(\s*"\/groups",/m))
})

Deno.test("the operations table takes the notes' operations only through their switch", async () => {
  const hub = await read(`apps/api/services/realtimeHub.ts`)
  expect(hub).toMatch(/^\s+\.\.\.createNotesOperations\(config\.notes, \{$/m)
  expect(hub).not.toMatch(
    /createNoteOperations|createNoteWidgetOperations|createAttachmentOperations/,
  )
})

Deno.test("the operations table takes the tag operations whatever the notes switch says", async () => {
  const hub = await read(`apps/api/services/realtimeHub.ts`)
  expect(hub).toMatch(/^ {2}\.\.\.createTagOperations\(\{$/m)
})

Deno.test("the API's database takes the notes switch", async () => {
  expect(await read(`apps/api/services/db.ts`)).toContain(`notes: config.notes`)
})

Deno.test("the buses register every note and attachment handler only with the notes on, and every tag handler always", async () => {
  const init = await read(`apps/api/cqrs/+init.ts`)
  const start = init.indexOf(`if (config.notes.on) {`)
  expect(start).toBeGreaterThan(-1)
  const end = init.indexOf(`\n}\n`, start)
  const registrations = [...init.matchAll(/(?:commandBus|queryBus)\.register\(\s*(\w+)/g)]
  const notes = registrations.filter(([, name]) => /^(Note|Tag|Attachment)/.test(name))
  expect(notes.length).toBe(23)
  expect(notes.filter(([, name]) => name.startsWith(`Tag`)).length).toBe(5)
  for (const registration of notes) {
    expect({
      name: registration[1],
      gated: registration.index! > start && registration.index! < end,
    })
      .toEqual({ name: registration[1], gated: !registration[1].startsWith(`Tag`) })
  }
})
