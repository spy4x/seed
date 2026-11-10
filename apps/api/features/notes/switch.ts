/**
 * The notes example behind its switch (`NOTES`, `readNotesSetup`): its operations and its routes.
 * Off, none is built, so a note, tag or attachment operation is refused as an unknown one and their
 * paths answer 404. The buses refuse their commands and queries too (`cqrs/+init.ts`).
 *
 * @module
 */

import type { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import type { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import type { Operations } from "@spy4x/realtime/operations"
import type { Actor } from "@domain/identity"
import type { LiveApiToken } from "@server/api-tokens/api-tokens.ts"
import type { NotesSetup } from "@server/notes/setup.ts"
import type { APIContext } from "../../_types.ts"
import { createNotesRoute } from "../../routes/notes.ts"
import { createTagsRoute } from "../../routes/tags.ts"
import { createTokenApiRoute, type TokenApiContext } from "../../routes/token-api.ts"
import { createTagOperations } from "../tags/operations.ts"
import { createAttachmentOperations } from "./attachments.ts"
import type { NoteListDependencies } from "./list.ts"
import { createNoteOperations } from "./operations.ts"
import { createNoteWidgetOperations } from "./widgets.ts"

/** What the notes' operations and routes dispatch through. */
export interface NotesFeatureDependencies {
  commandBus: Pick<CommandBus, `execute`>
  queryBus: Pick<QueryBus, `execute`>
  cursor: NoteListDependencies[`cursor`]
  /** Runs after a note is created: a guest's first note gets the reminder to keep it. */
  noteCreated(userId: number): Promise<void>
}

/** What the routes need beside the buses. */
export interface NotesRoutesDependencies extends NotesFeatureDependencies {
  expectedOrigin?: string
  /** The personal-token API's checks; it serves notes only, so it shares their switch. */
  tokenApi: {
    authenticate(c: Context, presented: string | undefined): Promise<LiveApiToken | null>
    auditRefusal(c: Context, tokenId: string, reason: `scope`): Promise<void>
    limitByIp: MiddlewareHandler<TokenApiContext>
    limitByToken: MiddlewareHandler<TokenApiContext>
  }
}

/**
 * Every note, tag, attachment and note-widget operation while the notes are on; none while off.
 * The socket and `POST /api/call` serve the table this joins (`services/realtimeHub.ts`).
 */
export function createNotesOperations(
  setup: NotesSetup,
  { commandBus, queryBus, cursor, noteCreated }: NotesFeatureDependencies,
): Operations<Actor> {
  if (!setup.on) return {}
  return {
    ...createNoteOperations({
      create: async (command) => {
        const created = await commandBus.execute(command)
        await noteCreated(command.data.actor.userId)
        return created
      },
      update: (command) => commandBus.execute(command),
      delete: (command) => commandBus.execute(command),
      restore: (command) => commandBus.execute(command),
      move: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
      get: (query) => queryBus.execute(query),
      locate: (query) => queryBus.execute(query),
      search: (query) => queryBus.execute(query),
      cursor,
    }),
    ...createNoteWidgetOperations({
      total: (query) => queryBus.execute(query),
      added: (query) => queryBus.execute(query),
      series: (query) => queryBus.execute(query),
    }),
    ...createAttachmentOperations({
      sign: (command) => commandBus.execute(command),
      confirm: (command) => commandBus.execute(command),
      cancel: (command) => commandBus.execute(command),
      remove: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
      download: (query) => queryBus.execute(query),
    }),
    ...createTagOperations({
      create: (command) => commandBus.execute(command),
      update: (command) => commandBus.execute(command),
      delete: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
      get: (query) => queryBus.execute(query),
    }),
  }
}

/**
 * Mounts the note and tag routes and the personal-token API (`/v1`) on `app` while the notes are
 * on, and nothing while off. Call it before `/groups`, whose authentication would answer for
 * `/groups/:groupId/notes` otherwise.
 */
export function mountNotesRoutes(
  app: Hono<APIContext>,
  setup: NotesSetup,
  dependencies: NotesRoutesDependencies,
): void {
  if (!setup.on) return
  const { commandBus, queryBus, cursor, noteCreated, expectedOrigin, tokenApi } = dependencies
  app.route(
    "/groups/:groupId/notes",
    createNotesRoute({
      create: async (command) => {
        const created = await commandBus.execute(command)
        await noteCreated(command.data.actor.userId)
        return created
      },
      update: (command) => commandBus.execute(command),
      delete: (command) => commandBus.execute(command),
      restore: (command) => commandBus.execute(command),
      move: (command) => commandBus.execute(command),
      list: (query) => queryBus.execute(query),
      get: (query) => queryBus.execute(query),
      cursor,
      expectedOrigin,
    }),
  )
  app.route("/groups/:groupId/tags", createTagsRoute({ list: (query) => queryBus.execute(query) }))
  // The only routes that accept a token, and they accept nothing else.
  app.route(
    "/v1",
    createTokenApiRoute({
      ...tokenApi,
      list: (query) => queryBus.execute(query),
      get: (query) => queryBus.execute(query),
      create: (command) => commandBus.execute(command),
      cursor,
    }),
  )
}
