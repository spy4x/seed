import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { canMutateNotes } from "@domain/groups"
import { DEFAULT_TAG_COLOR } from "@domain/tags"
import { TagEditorScreen } from "@ui/tag-editor-screen.tsx"
import { TAG_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { tagsStore } from "../state/tags.ts"
import { toasts } from "../state/toasts.ts"
import { currentLayer, OfflineStatus } from "../modules.ts"
import { isSpaPath } from "./spa-paths.ts"
import { deleteAndAnnounce } from "./tag-delete.ts"
import { useAppText } from "@ui/i18n.ts"

const network = createOnlineStatus()

/**
 * Wires the tag editor to the tags store: `/tags/new` (no `tagId`) creates a tag in the person's
 * selected group, `/tags/:tagId` edits one of that group's tags. A created tag takes the place of
 * the create page in the history, at its own address, so Back returns to the list. Leaving with
 * unsaved changes asks first.
 */
export function TagEditorView({ tagId = null }: { tagId?: string | null }) {
  const [, navigate] = useLocation()
  const t = useAppText()
  const store = tagsStore
  const groupId = selectionStore.groupId.value
  useEffect(() => network.watch(), [])
  useEffect(() => {
    if (groupId) void store.open(groupId)
  }, [groupId])

  const membership = groupId
    ? groupsStore.groups.value.find((group) => group.id === groupId)
    : undefined
  const canWrite = membership ? canMutateNotes(membership.role) : false
  const tag = tagId === null ? undefined : store.byId.value.get(tagId)
  const form = store.form.value
  // The editor follows the tag as the list holds it until the person changes a field, and is
  // built again whenever the store has none (after a group change or a discard), so the page
  // never shows fields that ignore typing.
  useEffect(() => {
    if (tagId === null) store.startCreate()
    else if (tag) store.startEdit(tag.id)
  }, [tagId, tag, form === null])

  const editing = tagId !== null && form?.id === tagId ? form : null
  const creating = tagId === null && form?.id === null ? form : null
  const value = editing ?? creating ?? tag ?? { name: "", color: DEFAULT_TAG_COLOR }
  const listLoading = store.loading.value || store.groupId.value !== groupId
  // Once the group is known, a fresh read of the groups (after a reconnect, say) must not take
  // the form away: only the first read of the group, or of an edited tag, is loading.
  const groupLoading = !membership && (groupsStore.loading.value || groupId === null)
  const saved = tag
    ? { id: tag.id, name: tag.name, color: tag.color, noteCount: tag.noteCount }
    : null
  return (
    <>
      {groupId && (
        <OfflineStatus
          groupId={groupId}
          onResolved={() => void store.refresh().catch(() => {})}
        />
      )}
      <TagEditorScreen
        group={membership ? { id: membership.id, name: membership.name, canWrite } : null}
        loading={groupLoading || (tagId !== null && !tag && listLoading)}
        notFound={tagId !== null && !tag && !listLoading && !groupLoading}
        tag={saved}
        value={{ name: value.name, color: value.color }}
        onChange={(next) => {
          if (form) store.change({ ...form, name: next.name, color: next.color })
        }}
        errors={{
          name: store.formErrors.value.name,
          form: store.formErrors.value.form ?? (tag ? store.listError.value : null),
        }}
        saving={store.saving.value}
        dirty={store.unsaved.value}
        onSave={async () => {
          const created = tagId === null
          const result = await store.save()
          if (!result) return
          const name = result.name
          toasts.success({
            title: created ? t.t(`TagEditorView.createdTitle`) : t.t(`TagEditorView.savedTitle`),
            body: created
              ? t.t(`TagEditorView.created`, { name })
              : t.t(`TagEditorView.saved`, { name }),
            dataE2E: created ? "tag-created" : "tag-saved",
          })
          if (created) navigate(TAG_PATHS.tag(result.id), { replace: true })
        }}
        onRevert={() => store.revert()}
        deleting={store.deleting.value !== null}
        onDelete={canWrite && tag
          ? async () => {
            if (await deleteAndAnnounce(t, store, tag.id, notesStore, toasts)) {
              navigate(TAG_PATHS.list)
            }
          }
          : undefined}
        offline={!network.online.value && currentLayer() !== null}
        navigate={navigate}
      />
      <UnsavedGuard
        when={canWrite && store.unsaved.value}
        owns={(url) => isSpaPath(url.pathname)}
        navigate={navigate}
        labels={{
          title: t.t(`TagEditorView.discardTitle`),
          message: tag
            ? t.t(`TagEditorView.discard`, { name: tag.name })
            : t.t(`TagEditorView.discardNew`),
          leave: t.t(`TagEditorView.discardLeave`),
          stay: t.t(`TagEditorView.discardStay`),
        }}
        onDiscard={() => store.closeForm()}
      />
    </>
  )
}
