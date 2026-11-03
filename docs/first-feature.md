# Add your first feature

> Also on the website: [seedsaas.com/docs/first-feature](https://seedsaas.com/docs/first-feature).

This page walks you through a new kind of record, from the database to the screen, by copying
notes. At the end, people in a group can list, add, edit and delete it, live on every open tab.

Seed calls such a kind of record an **aggregate**: a note, an invoice, a task. Every aggregate has
the same files, so you copy the notes files and rename them. This page uses `projects` as the new
name; put yours in its place.

You need:

- The stack running ([Run the local stack](local-stack.md)).
- `deno task check` passing before you start, so a failure later is yours.

Each step names the files to copy. [The aggregate reference](aggregates.md) says what each file
holds, in the same order and with the same step numbers.

## 1. The domain package

1. Copy `libs/domain/notes/` to `libs/domain/projects/`. Rename `Note` to `Project` inside, and
   change the fields and their rules.
2. In the root `deno.jsonc`, add `./libs/domain/projects` to `workspace` and an `@domain/projects`
   import alias. Without the workspace entry, its tests never run.
3. In `Dockerfile.base`, add a `COPY` line for its `deno.json`, next to the notes line.

Check it:

```sh
deno test --no-prompt --allow-read=. libs/domain/projects tests/dockerfile-base.test.ts
```

## 2. The table

1. Copy the notes migration, `libs/server/db/migrations/2026_10_02_0001_notes.sql`. Name the copy
   one step past the newest file in that folder
   ([Naming a migration](aggregates.md#2-database-libsserverdb)).
2. Append the same table to `libs/server/db/schema.sql`.
3. Append the file's name as the last line of `ON_MAIN` in `tests/migration-names.test.ts`.
4. Restart the stack, which applies the migration:

   ```sh
   deno task dev
   ```

Check it:

```sh
deno test --no-prompt --allow-read=. tests/migration-names.test.ts
```

## 3. The repository

1. Copy `libs/server/notes/postgres-note-repository.ts` and `note-list-cursor.ts`, with its
   `deno.json`, to `libs/server/projects/`.
2. Register it like the domain package: `workspace`, an `@server/projects/` alias and a `COPY` line.
3. Add a `project` getter to `AppDbBase` in `apps/api/services/db-base.ts`, built per access like
   `note`.

## 4. The handlers

1. Copy `apps/api/features/notes/handlers.ts` to `apps/api/features/projects/`.
2. Copy `apps/api/cqrs/note-dependencies.ts` and the note files under `cqrs/command-handlers/` and
   `cqrs/query-handlers/`.
3. Register the handlers in `apps/api/cqrs/+init.ts`.

## 5. The operations and the list route

1. Copy `list.ts`, `operations.ts`, `errors.ts` and `transports.test.ts` from
   `apps/api/features/notes/`.
2. Copy `apps/api/routes/notes.ts`, keeping only its list (`GET /`) route. Every write goes through
   the operations.
3. Mount the route in `apps/api/index.ts`, before `/groups`.
4. Spread your operations into `operations` in `apps/api/services/realtimeHub.ts`.
5. Map your domain error in `toRequestError` (`apps/api/services/realtime.ts`).

Check it:

```sh
deno test --no-prompt --allow-env=WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE apps/api/features/projects
```

## 6. The screens

1. Copy `libs/ui/notes-screen.tsx` (the list page) and `note-editor-screen.tsx` (the editor page).
2. Add the pages' paths to `libs/ui/progressive.tsx`, as `NOTE_PATHS` does.
3. Copy the notes' interaction tests from `libs/ui/notes.test.tsx`.

## 7. The SPA

1. Copy the store, `apps/spa/src/state/notes.ts`, with its test.
2. Copy `views/NotesView.tsx` and `views/NoteEditorView.tsx`.
3. Add the routes to `views/spa-paths.ts`, and say what each draws in `PAGES` in `app.tsx`.
4. Add the list to the icon rail, next to the notes entry in `libs/ui/frame.tsx`. Its label is a
   key in every `i18n/app/*.ts`.

Check it:

```sh
deno test --no-prompt --allow-env=WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE libs/ui apps/spa/src/state
```

Then open http://app.localhost/projects in two tabs. A project you add in one shows in the other
without a reload.

## 8. Before the pull request

1. Copy `e2e/notes.e2e.ts` and run it ([Run the browser tests](browser-tests.md)).
2. Give the aggregate its admin module ([Admin modules](admin-modules.md)).
3. Add fake rows to the public demo
   ([Show it in the public demo](aggregate-extras.md#show-it-in-the-public-demo)).
4. If it stores something new about a person, update the privacy page,
   `apps/mpa/routes/[[lang]]/privacy.tsx`.
5. Run every check:

   ```sh
   deno task check
   ```

## Next

- [The aggregate reference](aggregates.md): every file, and the rules it follows.
- [Make an aggregate work offline](aggregate-offline.md)
- [Delete, move and export an aggregate](aggregate-lifecycle.md)
