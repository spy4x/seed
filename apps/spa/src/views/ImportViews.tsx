import { useEffect } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { importKindView } from "@ui/import-kinds.ts"
import {
  ImportGoneScreen,
  ImportLoadingScreen,
  ImportNewScreen,
  ImportScreen,
} from "@ui/import-screen.tsx"
import { NotFoundScreen } from "@ui/not-found-screen.tsx"
import { IMPORT_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { importsStore } from "../state/imports.ts"
import { notesStore } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { notesOn } from "../modules.ts"

const network = createOnlineStatus()

/** The person's membership of the selected group, once the groups are read. */
function selectedMembership() {
  const groupId = selectionStore.groupId.value
  const membership = groupId
    ? groupsStore.groups.value.find((group) => group.id === groupId)
    : undefined
  return { groupId, membership }
}

/**
 * `/imports/new?kind=…`: the file picker of one kind for the selected group, with the person's
 * recent imports of that kind. A kind this app does not take is not found. An uploaded file's
 * import takes the picker's place in the history, so Back leaves the import instead of reopening
 * an empty picker.
 */
export function ImportNewView() {
  const [, navigate] = useLocation()
  const kind = importKindView(new URLSearchParams(useSearch()).get(`kind`), notesOn())
  const { groupId, membership } = selectedMembership()
  const store = importsStore
  useEffect(() => network.watch(), [])
  useEffect(() => {
    store.startNew()
    if (groupId && kind) void store.loadRecent(groupId)
  }, [groupId, kind?.limits.id])
  if (!kind) return <NotFoundScreen audience="member" navigate={navigate} notes={notesOn()} />
  const forbidden = store.forbidden.value || (membership ? !kind.canCreate(membership.role) : false)
  return (
    <ImportNewScreen
      kind={kind}
      groupName={membership?.name ?? ``}
      forbidden={forbidden}
      offline={!network.online.value}
      navigate={navigate}
      uploading={store.uploading.value}
      error={store.uploadError.value}
      recent={store.recent.value}
      onFile={(file) => {
        if (!groupId) return
        void store.upload(groupId, kind.limits.id, file).then((id) => {
          if (id) navigate(IMPORT_PATHS.import(id), { replace: true })
        })
      }}
    />
  )
}

/**
 * `/imports/:importId`: one import of the selected group, read as it opens and again on its
 * group's change hints (`pull.ts`). An import the server lacks, or of another group, is gone.
 */
export function ImportView({ importId }: { importId: string }) {
  const [, navigate] = useLocation()
  const { groupId, membership } = selectedMembership()
  const store = importsStore
  useEffect(() => network.watch(), [])
  useEffect(() => {
    if (!groupId) return
    void store.open(groupId, importId)
    return () => store.close()
  }, [groupId, importId])
  const summary = store.current.value
  if (store.gone.value) return <ImportGoneScreen />
  if (summary === null || summary.id !== importId) return <ImportLoadingScreen />
  const kind = importKindView(summary.kind, notesOn())
  if (!kind) return <NotFoundScreen audience="member" navigate={navigate} notes={notesOn()} />
  const forbidden = store.forbidden.value || (membership ? !kind.canCreate(membership.role) : false)
  return (
    <ImportScreen
      kind={kind}
      groupName={membership?.name ?? ``}
      forbidden={forbidden}
      offline={!network.online.value}
      navigate={navigate}
      summary={summary}
      mapping={store.mapping.value}
      onMap={store.map}
      check={store.check.value}
      checking={store.checking.value}
      committing={store.committing.value}
      undoing={store.undoing.value}
      error={store.error.value}
      onCommit={() => void store.commit()}
      onUndo={() => void store.undo()}
      onShowRemoved={() => {
        void notesStore.setShowDeleted(true)
        navigate(kind.href)
      }}
    />
  )
}
