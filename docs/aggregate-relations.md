# Link two aggregates

> Also on the website: [seedsaas.com/docs/aggregate-relations](https://seedsaas.com/docs/aggregate-relations).

This page links one aggregate to another, with tags and notes as the worked example. A note names
its tags by id (`tagIds`), and a tag knows nothing of notes. Here the tag is the **parent** and the
note the **child**.

You need:

- Both aggregates built ([the aggregate reference](aggregates.md)).

## The choices to copy

- **The link is its own table** (`note_tags`). The group's change log records every change to it.
  Deleting a tag removes its links and never touches a note's row or version.
- **The child's write carries the ids, and the server ignores unknown ones.** It answers with the
  links the note really has, so a client never needs to know whether a tag still exists.
- **Moving the child maps the parent by name.** A moved note keeps its tags by name. The target
  group gets any tag it lacks, each with its own audit event.
- **The parent is capped per group** (`TAG_MAX_PER_GROUP`), because its list has no pages. The
  repository counts after its insert, in the transaction that holds the group's row, so two
  creates at once cannot both pass.
- **A move whose tags do not fit is refused whole** (`TAG_LIMIT_REACHED`). Moving the notes without
  their tags would lose them silently.
- **Offline, the parent's collection comes first** in `offline/index.ts`, and the child names it in
  its `dependencies` (`parents`, `on`, `without`). The four rules are in
  [offline-writes.md](offline-writes.md#tags-and-what-a-parent-means).
- **The child's screens read the parent's store** (`state/tags.ts`) for their picker, labels and
  filter. The filter lives in the address (`useUrlFilters`) and runs over the local list.

## The tag files

The steps of [the aggregate reference](aggregates.md), as tags fill them:

| Step          | Files                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| 1. Domain     | `libs/domain/tags/+lib.ts`, `+lib.test.ts`, `deno.json`                                       |
| 2. Database   | `libs/server/db/migrations/2026_10_27_0001_tags.sql`, `schema.sql`                            |
| 3. Repository | `libs/server/tags/postgres-tag-repository.ts`; `setNoteTags` and the move mapping in `libs/server/notes/postgres-note-repository.ts` |
| 4. Handlers   | `apps/api/features/tags/handlers.ts`; in `apps/api/cqrs/`, the dependencies, handlers and `+init.ts` |
| 5. Transports | `apps/api/features/tags/operations.ts`, `errors.ts`, `apps/api/routes/tags.ts`, `realtimeHub.ts` |
| 6. Screens    | `libs/ui/tags-screen.tsx`, `tag-parts.tsx`, the tag parts of the two note screens, `tags.test.tsx` |
| 7. SPA wiring | `state/tags.ts`, `offline/tags-collection.ts`, `tags-cache.ts`, `views/TagsView.tsx`, the tag parts of the note views, `pull.ts`, `OfflineStatus.tsx` |
| 8. Tests      | `apps/api/features/tags/transports.test.ts`, `tests/integration/tags.integration.test.ts`, `state/tags.test.ts`, `offline/tags-collection.test.ts`, `e2e/tags.e2e.ts`, `e2e/tags-realtime-off.e2e.ts` |

The public website has no session, so tags exist in the SPA only.

## Next

- [Delete, move and export an aggregate](aggregate-lifecycle.md)
- [Make an aggregate work offline](aggregate-offline.md)
