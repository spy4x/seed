import { Hono } from "hono"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { Context, MiddlewareHandler } from "hono"
import {
  type DeletedNote,
  type Note,
  NoteCreateCommand,
  noteCreateRequestSchema,
  NoteDeleteCommand,
  noteDeleteRequestSchema,
  NoteGetQuery,
  NoteMoveCommand,
  noteMoveRequestSchema,
  NoteRestoreCommand,
  noteRestoreRequestSchema,
  NoteUpdateCommand,
  noteUpdateRequestSchema,
  type NoteWriteResult,
  parseNoteMoveRequest,
  parseNoteRequest,
} from "@domain/notes"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"
import { noteErrorResponse, NoteFeatureError } from "../features/notes/errors.ts"
import {
  DEFAULT_NOTE_LIST_LIMIT,
  listNotesPage,
  type NoteListDependencies,
} from "../features/notes/list.ts"
import { readFeatureJson } from "@api/services/json-body.ts"
import { parseListLimit } from "@api/services/list-limit.ts"

export interface NotesRouteDependencies extends NoteListDependencies {
  create(command: NoteCreateCommand): Promise<NoteWriteResult>
  update(command: NoteUpdateCommand): Promise<{ note: Note }>
  delete(command: NoteDeleteCommand): Promise<{ note: DeletedNote }>
  restore(command: NoteRestoreCommand): Promise<{ note: Note }>
  get(query: NoteGetQuery): Promise<{ note: Note }>
  move(command: NoteMoveCommand): Promise<{ notes: Note[] }>
  /** The origin the browser sends; see `GroupsRouteDependencies.expectedOrigin`. */
  expectedOrigin?: string
}

/**
 * The REST routes of a group's notes, mounted at `/api/groups/:groupId/notes`: the transport the
 * MPA uses. Like the socket, it parses, names the actor from the session and dispatches on the
 * buses; who may read or write is decided by the handlers, never here.
 *
 * - `GET /` lists the notes, newest first: `?limit=1..100&cursor=…`; `deleted=true` lists the
 *   deleted ones instead.
 * - `GET /:noteId` reads one note.
 * - `POST /` creates `{ id, title, body }`: 201, or 200 for a retry of the same create.
 * - `PATCH /:noteId` updates `{ title, body, version }`.
 * - `DELETE /:noteId` deletes `{ version }`.
 * - `POST /:noteId/restore` restores a deleted note: `{ note }`, or 402 when the plan's cap is full.
 * - `POST /move` moves `{ toGroupId, noteIds }` to another group, all or none: `{ notes }`.
 *
 * An update or delete that names a stale version answers 409 `VERSION_CONFLICT` with
 * `currentVersion`. Writes need the web app's origin and accept an `Idempotency-Key` header.
 */
export function createNotesRoute(dependencies: NotesRouteDependencies): Hono<APIContext> {
  const requireSameOrigin = createSameOriginMutationGuard<APIContext>({
    expectedOrigin: dependencies.expectedOrigin,
    onReject: (c) =>
      noteErrorResponse(
        c,
        new NoteFeatureError("REQUEST_ORIGIN_INVALID", "Mutation origin check failed"),
      ),
  })
  return new Hono<APIContext>()
    .onError((error, c) => noteErrorResponse(c, error))
    .use(requireAuthentication)
    .get("/", async (c) => {
      const page = await listNotesPage(dependencies, actorOf(c), groupIdOf(c), {
        limit: parseLimit(c.req.query("limit")),
        cursor: c.req.query("cursor"),
        deleted: parseDeleted(c.req.query("deleted")),
      })
      return c.json(page)
    })
    .get("/:noteId", async (c) => {
      const result = await dependencies.get(
        new NoteGetQuery({ actor: actorOf(c), groupId: groupIdOf(c), id: noteIdOf(c) }),
      )
      return c.json(result)
    })
    .post("/move", requireSameOrigin, async (c) => {
      const groupId = groupIdOf(c)
      const input = parseNoteMoveRequest(noteMoveRequestSchema, await readJson(c), groupId)
      const result = await dependencies.move(
        new NoteMoveCommand({
          actor: actorOf(c),
          groupId,
          ...input,
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json(result)
    })
    .post("/:noteId/restore", requireSameOrigin, async (c) => {
      parseNoteRequest(noteRestoreRequestSchema, await readJson(c))
      const result = await dependencies.restore(
        new NoteRestoreCommand({
          actor: actorOf(c),
          groupId: groupIdOf(c),
          id: noteIdOf(c),
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json(result)
    })
    .post("/", requireSameOrigin, async (c) => {
      const input = parseNoteRequest(
        noteCreateRequestSchema,
        await readJson(c),
      )
      const result = await dependencies.create(
        new NoteCreateCommand({
          actor: actorOf(c),
          groupId: groupIdOf(c),
          ...input,
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json({ note: result.note }, result.created ? 201 : 200)
    })
    .patch("/:noteId", requireSameOrigin, async (c) => {
      const input = parseNoteRequest(
        noteUpdateRequestSchema,
        await readJson(c),
      )
      const result = await dependencies.update(
        new NoteUpdateCommand({
          actor: actorOf(c),
          groupId: groupIdOf(c),
          id: noteIdOf(c),
          ...input,
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json(result)
    })
    .delete("/:noteId", requireSameOrigin, async (c) => {
      const input = parseNoteRequest(
        noteDeleteRequestSchema,
        await readJson(c),
      )
      const result = await dependencies.delete(
        new NoteDeleteCommand({
          actor: actorOf(c),
          groupId: groupIdOf(c),
          id: noteIdOf(c),
          version: input.version,
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json(result)
    })
}

/** Authentication only; the session gate on the buses decides whether the session is strong enough. */
const requireAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return noteErrorResponse(c, new NoteFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
}

function actorOf(c: Context<APIContext>) {
  return actorFromAuth(c.get("auth")!)
}

function groupIdOf(c: Context<APIContext>): string {
  const groupId = c.req.param("groupId")
  if (!isUuid(groupId)) throw new NoteFeatureError("INVALID_REQUEST", "Group id is invalid")
  return groupId
}

function noteIdOf(c: Context<APIContext>): string {
  const noteId = c.req.param("noteId")
  if (!isUuid(noteId)) throw new NoteFeatureError("INVALID_REQUEST", "Note id is invalid")
  return noteId
}

async function readJson(c: Context<APIContext>): Promise<unknown> {
  return readFeatureJson(c, (message) => new NoteFeatureError("INVALID_REQUEST", message))
}

function parseDeleted(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false
  if (value === "true") return true
  throw new NoteFeatureError("INVALID_REQUEST", "Note list filter is invalid")
}

function parseLimit(value: string | undefined): number {
  return parseListLimit(
    value,
    DEFAULT_NOTE_LIST_LIMIT,
    () => new NoteFeatureError("INVALID_REQUEST", "Note list limit is invalid"),
  )
}
