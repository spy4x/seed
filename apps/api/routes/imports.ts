import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { PayloadTooLargeError, readBoundedBody } from "@spy4x/net/bounded-body"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import type { Actor } from "@domain/identity"
import {
  IMPORT_FILE_MAX_BYTES,
  ImportCheckQuery,
  type ImportCheckResult,
  ImportCommitCommand,
  ImportCreateCommand,
  ImportError,
  ImportGetQuery,
  ImportListQuery,
  importMappingBodySchema,
  type ImportSummary,
  ImportUndoCommand,
  importUpload,
  importUploadQuerySchema,
  parseImportFileName,
  parseImportRequest,
} from "@domain/imports"
import { readFeatureJson } from "@api/services/json-body.ts"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"
import { importErrorResponse, ImportFeatureError } from "../features/imports/errors.ts"

export interface ImportsRouteDependencies {
  create(command: ImportCreateCommand): Promise<ImportSummary>
  list(query: ImportListQuery): Promise<{ imports: ImportSummary[] }>
  get(query: ImportGetQuery): Promise<ImportSummary>
  check(query: ImportCheckQuery): Promise<ImportCheckResult>
  commit(command: ImportCommitCommand): Promise<ImportSummary>
  undo(command: ImportUndoCommand): Promise<ImportSummary>
  /** See `NotesRouteDependencies.expectedOrigin`. */
  expectedOrigin?: string
}

/**
 * A group's imports, mounted at `/api/groups/:groupId/imports` (docs/imports.md). HTTP only, never
 * the socket: a file is an upload. Who may see and act is decided by the handlers, never here.
 *
 * - `POST /?kind=<kind>&name=<file name>` takes the file as the body, at most
 *   `IMPORT_FILE_MAX_BYTES`; 201 with the import, which a job then reads.
 * - `GET /` lists the person's own imports in the group, newest first.
 * - `GET /:importId` answers one import with its preview.
 * - `POST /:importId/check` takes `{ mapping }` and answers every refused row, capped; saves nothing.
 * - `POST /:importId/commit` takes `{ mapping }` and queues the save; 202 with the import.
 * - `POST /:importId/undo` removes the records the save made.
 *
 * Writes need the web app's origin and accept an `Idempotency-Key` header.
 */
export function createImportsRoute(dependencies: ImportsRouteDependencies): Hono<APIContext> {
  const requireSameOrigin = createSameOriginMutationGuard<APIContext>({
    expectedOrigin: dependencies.expectedOrigin,
    onReject: (c) =>
      importErrorResponse(
        c,
        new ImportFeatureError("REQUEST_ORIGIN_INVALID", "Mutation origin check failed"),
      ),
  })
  return new Hono<APIContext>()
    .onError((error, c) => importErrorResponse(c, error))
    .use(requireAuthentication)
    .post("/", requireSameOrigin, async (c) => {
      const groupId = groupIdOf(c)
      const query = parseImportRequest(importUploadQuerySchema, {
        kind: c.req.query("kind"),
        name: c.req.query("name"),
      })
      const fileName = parseImportFileName(query.name)
      const file = await importUpload(await readFile(c))
      const created = await dependencies.create(
        new ImportCreateCommand({
          actor: actorOf(c),
          groupId,
          kind: query.kind,
          fileName,
          file,
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json(created, 201)
    })
    .get("/", async (c) => {
      return c.json(
        await dependencies.list(new ImportListQuery({ actor: actorOf(c), groupId: groupIdOf(c) })),
      )
    })
    .get("/:importId", async (c) => {
      return c.json(await dependencies.get(new ImportGetQuery(refOf(c))))
    })
    .post("/:importId/check", requireSameOrigin, async (c) => {
      const ref = refOf(c)
      const { mapping } = parseImportRequest(importMappingBodySchema, await readJson(c))
      return c.json(await dependencies.check(new ImportCheckQuery({ ...ref, mapping })))
    })
    .post("/:importId/commit", requireSameOrigin, async (c) => {
      const ref = refOf(c)
      const { mapping } = parseImportRequest(importMappingBodySchema, await readJson(c))
      const result = await dependencies.commit(
        new ImportCommitCommand({
          ...ref,
          mapping,
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json(result, 202)
    })
    .post("/:importId/undo", requireSameOrigin, async (c) => {
      const result = await dependencies.undo(
        new ImportUndoCommand({
          ...refOf(c),
          requestId: c.get("requestId"),
          idempotencyKey: c.req.header("idempotency-key"),
        }),
      )
      return c.json(result)
    })
}

/** The upload's bytes, at most {@link IMPORT_FILE_MAX_BYTES}; a declared larger body is not read. */
async function readFile(c: Context<APIContext>): Promise<Uint8Array> {
  const tooLarge = () =>
    new ImportError(
      "FILE_TOO_LARGE",
      `The file is larger than ${IMPORT_FILE_MAX_BYTES / 1024 / 1024} MiB`,
    )
  try {
    return await readBoundedBody(c.req.raw, { maxBytes: IMPORT_FILE_MAX_BYTES })
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw tooLarge()
    throw new ImportError("IMPORT_REFUSED", `The file did not arrive whole. Try again.`)
  }
}

/** Authentication only; the session gate on the bus decides whether the session is strong enough. */
const requireAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return importErrorResponse(c, new ImportFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
}

function readJson(c: Context<APIContext>): Promise<unknown> {
  return readFeatureJson(c, (message) => new ImportFeatureError("INVALID_REQUEST", message))
}

function actorOf(c: Context<APIContext>): Actor {
  return actorFromAuth(c.get("auth")!)
}

function groupIdOf(c: Context<APIContext>): string {
  const groupId = c.req.param("groupId")
  if (!groupId || !isUuid(groupId)) {
    throw new ImportFeatureError("INVALID_REQUEST", "Group id is invalid")
  }
  return groupId
}

function refOf(c: Context<APIContext>): { actor: Actor; groupId: string; importId: string } {
  const importId = c.req.param("importId")
  if (!importId || !isUuid(importId)) {
    throw new ImportFeatureError("INVALID_REQUEST", "Import id is invalid")
  }
  return { actor: actorOf(c), groupId: groupIdOf(c), importId }
}
