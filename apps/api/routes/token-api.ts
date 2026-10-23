import { Hono } from "hono"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { Context, MiddlewareHandler } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { bearerTokenFromHeaders } from "@spy4x/server/http/bearer-auth"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { ApiTokenAccess, ApiTokenError, type ApiTokenErrorCode } from "@domain/api-tokens"
import type { Actor } from "@domain/identity"
import {
  type Note,
  NoteCreateCommand,
  noteCreateRequestSchema,
  NoteGetQuery,
  type NoteWriteResult,
  parseNoteRequest,
} from "@domain/notes"
import type { LiveApiToken } from "@server/api-tokens/api-tokens.ts"
import type { APIContext } from "../_types.ts"
import { noteErrorResponse, NoteFeatureError } from "../features/notes/errors.ts"
import {
  DEFAULT_NOTE_LIST_LIMIT,
  listNotesPage,
  type NoteListDependencies,
} from "../features/notes/list.ts"
import { readFeatureJson } from "@api/services/json-body.ts"
import { parseListLimit } from "@api/services/list-limit.ts"
import { codeForStatus, errorResponse } from "../services/error-response.ts"

/** The context of a token request: the token that `authenticate` accepted. */
export interface TokenApiContext {
  Variables: APIContext["Variables"] & { apiToken: LiveApiToken }
}

export interface TokenApiDependencies extends NoteListDependencies {
  /** The live token a request presents, or `null`. Reads the database on every call. */
  authenticate(c: Context, presented: string | undefined): Promise<LiveApiToken | null>
  /** Audits that a live token was refused for its scope, within the audit budget. Never throws. */
  auditRefusal(c: Context, tokenId: string, reason: "scope"): Promise<void>
  create(command: NoteCreateCommand): Promise<NoteWriteResult>
  get(query: NoteGetQuery): Promise<{ note: Note }>
  /** Spent per client address before the token is checked, so guessing costs a budget. */
  limitByIp: MiddlewareHandler<TokenApiContext>
  /** Spent per token once it is accepted: each token has a budget of its own. */
  limitByToken: MiddlewareHandler<TokenApiContext>
}

const TOKEN_ERRORS: Record<ApiTokenErrorCode, { status: ContentfulStatusCode; message: string }> = {
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  PASSWORD_INVALID: { status: 400, message: "The password is incorrect" },
  GROUP_NOT_FOUND: { status: 404, message: "Group not found" },
  TOKEN_NOT_FOUND: { status: 404, message: "Token not found" },
  TOO_MANY_TOKENS: { status: 409, message: "Too many tokens" },
  TOKEN_INVALID: { status: 401, message: "The API token is missing, revoked or expired" },
  TOKEN_SCOPE: { status: 403, message: "This API token cannot do that" },
}

/**
 * The API for personal tokens (#167), mounted at `/api/v1`: the only routes that accept one, and
 * the only thing they accept. A session cookie is ignored here, and a token is ignored everywhere
 * else, so a token can never reach an account action (password, address, deletion, sessions,
 * tokens). Send it as `Authorization: Bearer tpl_…`.
 *
 * - `GET /groups/:groupId/notes` lists the group's notes: `?limit=1..100&cursor=…`.
 * - `GET /groups/:groupId/notes/:noteId` reads one note.
 * - `POST /groups/:groupId/notes` creates `{ id, title, body, tagIds? }` (tag ids the group does not have are ignored): 201, or 200 for a retry of the
 *   same create. Accepts an `Idempotency-Key` header.
 *
 * Each request dispatches the same messages the SPA's do, with an actor that carries the token's
 * scope. The session gate refuses another group, a write from a read-only token and every message
 * a token may not send (`cqrs/token-scope.ts`); the handlers refuse what the owner's role does not
 * allow. A missing, revoked or expired token gets 401 `TOKEN_INVALID`, the scope 403 `TOKEN_SCOPE`.
 * A refusal of a token that has an owner (revoked, expired, or out of its scope) is audited, a few
 * rows an hour per token at most.
 * No origin check: the browser never attaches the header on its own, so another site cannot make
 * it send one.
 */
export function createTokenApiRoute(dependencies: TokenApiDependencies): Hono<TokenApiContext> {
  return new Hono<TokenApiContext>()
    .onError(async (error, c) => {
      const token = c.get("apiToken")
      if (token && error instanceof ApiTokenError && error.code === "TOKEN_SCOPE") {
        await dependencies.auditRefusal(c, token.id, "scope")
      }
      return tokenApiErrorResponse(c, error)
    })
    .use(dependencies.limitByIp)
    .use(async (c, next) => {
      const token = await dependencies.authenticate(c, bearerTokenFromHeaders(c.req.raw.headers))
      if (!token) {
        c.header("WWW-Authenticate", `Bearer realm="api"`)
        return tokenApiErrorResponse(c, new ApiTokenError("TOKEN_INVALID", "No live token"))
      }
      c.set("apiToken", token)
      return await next()
    })
    .use(dependencies.limitByToken)
    .get("/groups/:groupId/notes", async (c) => {
      const page = await listNotesPage(dependencies, actorOf(c), groupIdOf(c), {
        limit: parseLimit(c.req.query("limit")),
        cursor: c.req.query("cursor"),
      })
      return c.json(page)
    })
    .get("/groups/:groupId/notes/:noteId", async (c) => {
      const noteId = c.req.param("noteId")
      if (!isUuid(noteId)) throw new NoteFeatureError("INVALID_REQUEST", "Note id is invalid")
      return c.json(
        await dependencies.get(
          new NoteGetQuery({ actor: actorOf(c), groupId: groupIdOf(c), id: noteId }),
        ),
      )
    })
    .post("/groups/:groupId/notes", async (c) => {
      const input = parseNoteRequest(noteCreateRequestSchema, await readJson(c))
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
}

/**
 * The actor of a token request: the owner, acting through the token. The token stands in for the
 * second factor, as the session that created it had passed it; what it may do is `token`.
 */
export function actorFromApiToken(token: LiveApiToken): Actor {
  return {
    userId: token.userId,
    userMfa: token.userMfa,
    sessionSecondFactor: SecondFactorStatus.Completed,
    token: {
      tokenId: token.id,
      groupId: token.groupId,
      canWrite: token.access === ApiTokenAccess.WRITE,
    },
  }
}

function actorOf(c: Context<TokenApiContext>): Actor {
  return actorFromApiToken(c.get("apiToken"))
}

/** A token refusal in its own words; anything else as the note routes answer it. */
function tokenApiErrorResponse(c: Context<TokenApiContext>, error: unknown): Response {
  // The note answers read only `requestId`, which both contexts carry.
  if (!(error instanceof ApiTokenError)) {
    return noteErrorResponse(c as unknown as Context<APIContext>, error)
  }
  const definition = TOKEN_ERRORS[error.code]
  return errorResponse(c, codeForStatus(definition.status), {
    message: definition.message,
    reason: error.code,
    status: definition.status,
    fields: error.fields,
  })
}

function groupIdOf(c: Context<TokenApiContext>): string {
  const groupId = c.req.param("groupId")
  if (!groupId || !isUuid(groupId)) {
    throw new NoteFeatureError("INVALID_REQUEST", "Group id is invalid")
  }
  return groupId
}

async function readJson(c: Context<TokenApiContext>): Promise<unknown> {
  return readFeatureJson(c, (message) => new NoteFeatureError("INVALID_REQUEST", message))
}

function parseLimit(value: string | undefined): number {
  return parseListLimit(
    value,
    DEFAULT_NOTE_LIST_LIMIT,
    () => new NoteFeatureError("INVALID_REQUEST", "Note list limit is invalid"),
  )
}
