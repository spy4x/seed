import { NoteSearchQuery } from "@domain/notes"
import type { QueryHandler } from "@spy4x/platform/cqrs"
import { createRedisRateLimitStore } from "@spy4x/server/kv"
import { createNoteSearchHandler } from "../../features/notes/handlers.ts"
import { createNoteSearchLimit } from "../../features/notes/search-rate-limit.ts"
import { kv } from "../../services/cache.ts"
import { noteDependencies } from "../note-dependencies.ts"

export const noteSearchHandler: QueryHandler<NoteSearchQuery> = createNoteSearchHandler({
  notes: noteDependencies.notes,
  searchAllowed: createNoteSearchLimit({
    store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
  }),
})
