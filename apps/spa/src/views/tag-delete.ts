import type { notesStore } from "../state/notes.ts"
import type { tagsStore } from "../state/tags.ts"
import type { toasts } from "../state/toasts.ts"

/**
 * Deletes a tag and, when it worked, says so in a toast that names it and how many notes lost it.
 * The count comes from the notes this device has read for the tag's group; while they are not read,
 * the toast leaves the count out rather than guess. A delete cannot be taken back, so the toast has
 * no "Undo". Resolves to whether the tag was deleted.
 */
export async function deleteAndAnnounce(
  tags: Pick<typeof tagsStore, "remove" | "byId">,
  id: string,
  notes: Pick<typeof notesStore, "groupId" | "notes" | "loading">,
  notices: Pick<typeof toasts, "success">,
): Promise<boolean> {
  const tag = tags.byId.value.get(id)
  const known = tag && notes.groupId.value === tag.groupId && !notes.loading.value
  const count = known ? notes.notes.value.filter((note) => note.tagIds.includes(id)).length : 0
  if (!tag || !await tags.remove(id)) return false
  const name = `"${tag.name}"`
  notices.success({
    title: "Tag deleted",
    body: count === 0
      ? `${name} was deleted.`
      : `${name} was deleted and taken off ${count} ${count === 1 ? "note" : "notes"}.`,
    dataE2E: "tag-deleted",
  })
  return true
}
