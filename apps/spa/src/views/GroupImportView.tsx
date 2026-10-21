import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { GROUP_IMPORT_MAX_BYTES, type GroupImportResult } from "@domain/groups"
import { fileContents, GroupImportScreen } from "@ui/group-import-screen.tsx"
import { GROUP_PATHS } from "@ui/progressive.tsx"
import { groupImportStore } from "../state/group-files.ts"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"
import { toasts } from "../state/toasts.ts"

const network = createOnlineStatus()

/**
 * Opens a group the import created: the groups are read again so the new one is in the list, the
 * address turns into its page in place of `/groups/import`, so Back does not reopen the emptied
 * page, the group becomes the current one, and a toast says what came in.
 */
export async function openImported(
  result: GroupImportResult,
  groups: Pick<typeof groupsStore, "refreshFromUser">,
  selection: Pick<typeof selectionStore, "select">,
  navigate: (to: string, options: { replace: boolean }) => void,
  notices: Pick<typeof toasts, "success">,
): Promise<void> {
  await groups.refreshFromUser().catch(() => {})
  navigate(GROUP_PATHS.settings(result.group.id), { replace: true })
  void selection.select(result.group.id)
  notices.success({
    title: "Group imported",
    body: `Imported ${fileContents(result.parts, " and ")} into "${result.group.name}".`,
    dataE2E: "group-imported",
  })
}

/** `/groups/import`: wires the import page to the import store. Leaving the page forgets the file. */
export function GroupImportView() {
  const [, navigate] = useLocation()
  const store = groupImportStore
  useEffect(() => network.watch(), [])
  useEffect(() => () => store.reset(), [])
  return (
    <GroupImportScreen
      state={store.state.value}
      name={store.name.value}
      onNameChange={(name) => (store.name.value = name)}
      nameError={store.nameError.value}
      importing={store.importing.value}
      importFailed={store.importFailed.value}
      offline={!network.online.value}
      maxBytes={GROUP_IMPORT_MAX_BYTES}
      attempt={store.attempt.value}
      onFile={(file) => void store.choose(file)}
      onRetryCheck={() => void store.retry()}
      onChooseAnother={() => store.reset()}
      onImport={() =>
        void store.importNow().then((result) => {
          if (result) return openImported(result, groupsStore, selectionStore, navigate, toasts)
        })}
      navigate={navigate}
    />
  )
}
