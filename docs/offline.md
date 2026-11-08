# Offline in the SPA

> Also on the website: [seedsaas.com/docs/offline](https://seedsaas.com/docs/offline).

This page shows how to turn the SPA's offline layer or its WebSocket module off, or remove either
from your product.

The SPA opens with no network and shows every list it last saw. A person can add, edit and delete
notes and tags offline, and the changes are sent when the connection is back. A change the server
cannot take is shown as a conflict for the person to settle; nothing is overwritten on its own.

How it works, in four Concepts pages:

- [How offline reads work](offline-data.md): what the device keeps, and the three levels.
- [How offline writes sync](offline-writes.md): the queue, conflicts and tags.
- [Sign-out and the device's data](offline-sign-out.md): what a sign-out deletes and keeps.
- [The app shell](offline-app-shell.md): the service worker, and why offline tests use the build.

To make a new aggregate readable or writable offline, follow
[aggregates.md](aggregates.md#choosing-the-offline-level).

## Switching a module off

Both modules run unless their switch says `false`.

| Variable       | `/config.json` key | What `false` does                                                                                |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `SPA_REALTIME` | `realtime`         | No socket. The page reads and writes over HTTP and sees others' changes within about 30 seconds. |
| `SPA_OFFLINE`  | `offline`          | No device copy, no queue, no remembered user. Every screen needs the network.                    |

1. In a deployment, set the variable in `infra/envs/.env.prod`. Compose passes it to the `spa`
   container.
2. Deploy:

   ```sh
   deno task deploy
   ```

In development, edit `apps/spa/public/config.json` instead.

`true`, `false`, `1` and `0` are accepted. Any other value is ignored with a warning in the
browser's console, and the module runs (`apps/spa/src/runtime-config.ts`).

With the offline layer off, the service worker still caches the app's files, so the page loads
fast. Copies written before the switch are deleted at the next start. The e2e specs
`e2e/realtime-off.e2e.ts` and `e2e/local-data.e2e.ts` run the core flows with each module off.

**A queue left behind is sent once, then deleted.** At each signed-in start with the layer off, the
app looks for the person's queue databases without opening them. It sends what it finds in order
(`offline/send-once.ts`), then deletes them. A write that cannot reach the server keeps the queue
for the next try. A write the server refuses is dropped, since there is no conflict screen, and a
warning names up to three of them.

## Removing the WebSocket module

1. Delete the folder `apps/spa/src/realtime/`.
2. In `apps/spa/src/modules.ts`, delete the `./realtime/index.ts` import and its uses:
   - the `socket` option of `createAppCallPort`;
   - the `if (switches.realtime)` branch of `startModules`;
   - the `disconnectRealtime` calls;
   - the `realtime` switch.
3. Make `advanceGroupCursor` an empty function, and make `connectionDisplay` always answer
   `"idle"`.
4. Delete `tests/realtime-removal.test.ts` and its entry in `infra/scripts/test.ts`.
5. Delete the e2e specs that test the socket itself: `e2e/groups-socket.e2e.ts` and
   `e2e/realtime-resume.e2e.ts`.

The API's socket route (`/api/ws`) can stay: with no socket clients, its hints reach nobody.

## Removing the layer

A product that does not want offline deletes the layer and keeps an online SPA with live updates.
The guard test `tests/offline-removal.test.ts` fails when a file that imports the layer is missing
from these steps.

1. Delete the folder `apps/spa/src/offline/`, and the files `apps/spa/src/sw-options.ts` and
   `apps/spa/src/sw-options.test.ts`.
2. In `apps/spa/src/sw.ts`, delete the `@spy4x/platform/browser/offline-shell` and
   `./sw-options.ts` imports and the `installOfflineShell(...)` call. Keep the push handlers, and
   add back the one listener `SWUpdater` needs:

   ```ts
   scope.addEventListener("message", (event) => {
     if (event.data?.action === "skipWaiting") scope.skipWaiting()
   })
   ```

3. In `apps/spa/src/modules.ts`, delete:
   - the `./offline/` imports and the "Local data" part of the file;
   - `watchUnsentChanges`, `reviewConflicts` and the `UnsentWait` and `UnsentView` types, which are
     in that part;
   - the `startOfflineLayer` and `sendLeftQueue` calls in `startModules`, `sendLeftQueue` itself,
     and the `databases` option;
   - the `stopOfflineLayer` call in `forgetModules`;
   - the `offline` switch.
4. In the same file, keep the `LocalReads` and `createLocalReads` re-export and `noLocalReads`, and
   end that part with:

   ```ts
   export const localReads = noLocalReads
   export const benchmarkLocalData: BenchmarkLocalData | null = null
   ```

   The level 2 stores then read from the server and keep nothing, with no change to them or their
   tests. The `null` closes the benchmark page, which measures this layer.
5. In `apps/spa/src/app.tsx`:
   - `bootstrapSession(recallUser)` becomes `bootstrapSession()` and loses its `wipeSignedOut`
     step;
   - in the effect that remembers the user, drop `rememberUser`, and call `clearBrowserStorage()`
     where it called `wipeSignedOut()`;
   - delete `wipeSignedOut`, and the `flushOutbox` line of `reads`.
6. In `apps/spa/src/state/notes.ts`, delete the `currentLayer` and `offlineNotes` imports, and
   export `createNotesStore(onlineNotes)`. The optional `readLocal` dependency and its `showLocal`
   call can go too.
7. In `apps/spa/src/state/tags.ts`, delete the `currentLayer` and `offlineTags` imports, and export
   `createTagsStore(onlineTags)`.
8. In `apps/spa/src/views/AppShell.tsx`:
   - delete the `currentLayer` import, and make the search's `deviceNotes` answer `[]`;
   - delete `useSignOut` and the `watchUnsentChanges`, `reviewConflicts` and `UnsentSignOut`
     imports, and pass `useSignOutNow()` as `onSignOut`.
9. Delete `apps/spa/src/views/UnsentSignOut.tsx` and `apps/spa/src/views/UnsentSignOut.test.tsx`.
10. In `apps/spa/src/views/NotesView.tsx`, `apps/spa/src/views/NoteEditorView.tsx` and
    `apps/spa/src/views/TagsView.tsx`, delete the `OfflineStatus` import and element.
11. Delete the specs `e2e/offline.e2e.ts`, `e2e/local-data.e2e.ts`, `e2e/search-offline.e2e.ts`,
    `e2e/tags-offline.e2e.ts` and `e2e/notes-restore-offline.e2e.ts`, and their names in
    `OFFLINE_SPECS` of `infra/scripts/e2e-local-plan.ts`.
12. Delete `tests/offline-removal.test.ts` and its group in `infra/scripts/test.ts`.

The app then reads and writes over the network only. The server's changes read (`group.changes`)
stays and is not called; the notes store pages the REST list instead.

## Next

- [How offline reads work](offline-data.md).
- [Add an aggregate](aggregates.md).
