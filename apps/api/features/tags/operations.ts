import {
  type DeletedTag,
  type ListedTag,
  parseTagRequest,
  type Tag,
  TagCreateCommand,
  tagCreatePayloadSchema,
  TagDeleteCommand,
  tagDeletePayloadSchema,
  tagGetPayloadSchema,
  TagGetQuery,
  tagListPayloadSchema,
  TagListQuery,
  TagUpdateCommand,
  tagUpdatePayloadSchema,
  type TagWriteResult,
} from "@domain/tags"
import type { Actor } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"

/** What the tag requests need from the app: the buses. */
export interface TagOperationDependencies {
  create(command: TagCreateCommand): Promise<TagWriteResult>
  update(command: TagUpdateCommand): Promise<{ tag: Tag }>
  delete(command: TagDeleteCommand): Promise<{ tag: DeletedTag }>
  get(query: TagGetQuery): Promise<{ tag: Tag }>
  list(query: TagListQuery): Promise<{ tags: ListedTag[] }>
}

/**
 * The tag commands and queries, listed once. The socket and `POST /api/call/<name>` both serve
 * this list, so a tag has no REST route per command. Each one parses its payload and dispatches on
 * the bus; who may do what is decided in the handlers.
 */
export function createTagOperations(dependencies: TagOperationDependencies): Operations<Actor> {
  return {
    "tag.create": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parseTagRequest(tagCreatePayloadSchema, payload)
        return await dependencies.create(
          new TagCreateCommand({ actor, ...input, requestId, idempotencyKey }),
        )
      },
    },
    "tag.update": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parseTagRequest(tagUpdatePayloadSchema, payload)
        return await dependencies.update(
          new TagUpdateCommand({ actor, ...input, requestId, idempotencyKey }),
        )
      },
    },
    "tag.delete": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parseTagRequest(tagDeletePayloadSchema, payload)
        return await dependencies.delete(
          new TagDeleteCommand({ actor, ...input, requestId, idempotencyKey }),
        )
      },
    },
    "tag.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parseTagRequest(tagGetPayloadSchema, payload)
        return await dependencies.get(new TagGetQuery({ actor, ...input }))
      },
    },
    "tag.list": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parseTagRequest(tagListPayloadSchema, payload)
        return await dependencies.list(new TagListQuery({ actor, ...input }))
      },
    },
  }
}
