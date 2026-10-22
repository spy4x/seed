import { effect } from "@preact/signals"
import { useEffect } from "preact/hooks"
import { useHotkeys } from "@spy4x/preact-ui/hotkeys"
import { keyFaces } from "@spy4x/preact-ui/kbd"
import { isApplePlatform } from "@spy4x/platform/browser/hotkeys"
import type { notesStore } from "../state/notes.ts"
import { toasts } from "../state/toasts.ts"

/** The key that takes a deleted note back while its toast shows. */
export const UNDO_KEYS = "mod+z"

/**
 * The toast's hint for {@link UNDO_KEYS}, as the platform writes the key ("Ctrl+Z", "⌘Z"), or
 * nothing on a device without a fine pointer, where a keyboard is unlikely. Read when the toast is
 * pushed, in the browser, never during render.
 */
function undoKeyHint(): string {
  if (globalThis.matchMedia?.("(pointer: fine)").matches === false) return ""
  const apple = isApplePlatform()
  const key = keyFaces(UNDO_KEYS, apple).map((face) => face.text).join(apple ? "" : "+")
  return ` Press ${key} to undo.`
}

/**
 * Shows the toast that follows a delete in the app's one toast list: the note's title and an Undo
 * button. It lasts as long as the offer does, and goes when the offer ends or the list leaves the
 * screen. An offer that ended while another page was open is not shown late.
 *
 * While the offer lasts, Ctrl Z (⌘Z on a Mac) takes the note back too, so a keyboard user need not
 * Tab past every row to reach the toast. A press in a text field keeps the field's own undo.
 */
export function useUndoToast(store: typeof notesStore): void {
  const offer = store.undo.value
  useHotkeys([{ keys: UNDO_KEYS, handler: () => void store.undoDelete() }], {
    enabled: offer !== null,
  })
  useEffect(() => {
    if (!offer) return
    const left = offer.until - Date.now()
    if (left <= 0) return
    toasts.info({
      id: offer.id,
      title: "Note deleted",
      body: (offer.title ? `"${offer.title}" was deleted.` : "The note was deleted.") +
        undoKeyHint(),
      duration: left,
      dataE2E: "note-undo-toast",
      action: { label: "Undo", dataE2E: "note-undo", onAction: () => void store.undoDelete() },
    })
    // Dismiss and the toast's own timer take it off the list: that ends the offer too, so it does
    // not come back when the person returns to the list.
    const stop = effect(() => {
      if (!toasts.list.value.some((toast) => toast.id === offer.id)) store.dismissUndo()
    })
    return () => {
      stop()
      toasts.remove(offer.id)
    }
  }, [offer, store])
}
