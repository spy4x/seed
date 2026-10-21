import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import {
  GROUP_IMPORT_MAX_BYTES,
  GroupExportCommand,
  type GroupExportResult,
  GroupImportCheckQuery,
  GroupImportCommand,
  GroupImportError,
  type GroupImportResult,
  type GroupImportSummary,
  parseGroupId,
  parseGroupImportBody,
} from "@domain/groups"
import { JSON_BODY_WRONG_TYPE, readJsonBody } from "@spy4x/server/http/bounded-body"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"
import { groupErrorResponse, GroupFeatureError } from "../features/groups/errors.ts"
import type { GroupFileRateLimits } from "../features/groups/file-rate-limits.ts"

/** Room for the name beside the file in an import's body. */
const IMPORT_BODY_EXTRA_BYTES = 4 * 1024

export interface GroupFilesRouteDependencies {
  exportGroup(command: GroupExportCommand): Promise<GroupExportResult>
  check(query: GroupImportCheckQuery): Promise<GroupImportSummary>
  importGroup(command: GroupImportCommand): Promise<GroupImportResult>
  rateLimits: GroupFileRateLimits
  /** See `GroupsRouteDependencies.expectedOrigin`. */
  expectedOrigin?: string
}

/**
 * A group's export file and the import of one (#230), under `/api/groups`. HTTP only, never the
 * socket: a file is a download or an upload.
 *
 * - `GET /:groupId/export` streams the owner's file as an attachment.
 * - `POST /import/check` takes the file as the body and answers what it holds; it writes nothing.
 * - `POST /import` takes `{ name, file }` and creates the new group; 201 with it.
 *
 * A file over `GROUP_IMPORT_MAX_BYTES`, or one that is not JSON, is refused as the import refuses
 * any bad file: 422 `IMPORT_REFUSED` with its `problems`.
 */
export function createGroupFilesRoute(dependencies: GroupFilesRouteDependencies): Hono<APIContext> {
  const requireSameOrigin = createSameOriginMutationGuard<APIContext>({
    expectedOrigin: dependencies.expectedOrigin,
    onReject: (c) =>
      groupErrorResponse(
        c,
        new GroupFeatureError("REQUEST_ORIGIN_INVALID", "Mutation origin check failed"),
      ),
  })
  return new Hono<APIContext>()
    .onError((error, c) => groupErrorResponse(c, error))
    // Each route names the session check itself: this app shares `/api/groups` with the groups
    // route, and a middleware for all its paths would run in front of that route's too.
    .get(
      "/:groupId/export",
      requireAuthentication,
      // Before the budget, so another site cannot spend a person's exports.
      requireAppPage,
      dependencies.rateLimits.exportByUser,
      async (c) => {
        const groupId = parseGroupId(c.req.param("groupId"))
        const file = await dependencies.exportGroup(
          new GroupExportCommand({
            actor: actorFromAuth(c.get("auth")!),
            groupId,
            requestId: c.get("requestId"),
          }),
        )
        const encoder = new TextEncoder()
        const iterator = file.chunks[Symbol.asyncIterator]()
        // The first piece is read before the answer starts: a read that fails at once is a 500, not
        // a 200 with half a file. A failure after it can only cut the download short, and a file cut
        // short is not valid JSON, so an import refuses it.
        const first = await iterator.next()
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            if (first.done) controller.close()
            else controller.enqueue(encoder.encode(first.value))
          },
          async pull(controller) {
            const next = await iterator.next()
            if (next.done) controller.close()
            else controller.enqueue(encoder.encode(next.value))
          },
          // The person stopped the download: the cursor closes.
          async cancel() {
            await iterator.return?.()
          },
        })
        return c.body(body, 200, {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${file.fileName}"`,
          "cache-control": "no-store",
        })
      },
    )
    .post(
      "/import/check",
      requireAuthentication,
      requireSameOrigin,
      dependencies.rateLimits.checkByUser,
      async (c) => {
        const file = await readFile(c, GROUP_IMPORT_MAX_BYTES)
        return c.json(
          await dependencies.check(
            new GroupImportCheckQuery({ actor: actorFromAuth(c.get("auth")!), file }),
          ),
        )
      },
    )
    .post(
      "/import",
      requireAuthentication,
      requireSameOrigin,
      dependencies.rateLimits.importByUser,
      async (c) => {
        const { name, file } = parseGroupImportBody(
          await readFile(c, GROUP_IMPORT_MAX_BYTES + IMPORT_BODY_EXTRA_BYTES),
        )
        const result = await dependencies.importGroup(
          new GroupImportCommand({
            actor: actorFromAuth(c.get("auth")!),
            file,
            name,
            requestId: c.get("requestId"),
            idempotencyKey: c.req.header("idempotency-key"),
          }),
        )
        return c.json(result, 201)
      },
    )
}

/**
 * The JSON body, capped at `maxBytes`. Too large is the "too large" problem and anything that is
 * not JSON the "not an export" problem, so the page words them as it words a bad file. A body not
 * declared as JSON is `INVALID_REQUEST`, which only a client other than the app sends.
 */
async function readFile(c: Context<APIContext>, maxBytes: number): Promise<unknown> {
  let refused: Error | undefined
  try {
    return await readJsonBody(c, {
      maxBytes,
      requireJsonContentType: true,
      toError: ({ status }) =>
        refused = status === 413
          ? new GroupImportError([{ kind: "too_large", maxBytes: GROUP_IMPORT_MAX_BYTES }])
          : status === 415
          ? new GroupFeatureError("INVALID_REQUEST", JSON_BODY_WRONG_TYPE)
          : new GroupImportError([{ kind: "not_export" }]),
    })
  } catch (_error) {
    throw refused ?? new GroupImportError([{ kind: "not_export" }])
  }
}

/** A session at all; its strength is the session gate's on the buses, as for every group route. */
/**
 * A GET the mutation guards let through, yet the export writes an audit event in the person's name
 * and hands out the group's data: only the app's own page may ask for it. A missing header is
 * refused too.
 */
const requireAppPage: MiddlewareHandler<APIContext> = async (c, next) => {
  if (c.req.header("sec-fetch-site") !== "same-origin") {
    return groupErrorResponse(
      c,
      new GroupFeatureError("REQUEST_ORIGIN_INVALID", "Export must come from the app"),
    )
  }
  return await next()
}

const requireAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return groupErrorResponse(c, new GroupFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
}
