/**
 * Clicks `button` and moves focus to it once the command palette's dialog has finished closing.
 *
 * A palette command runs right after the palette calls `dialog.close()`, which drops `open` at
 * once but sends its `close` event later. That event's handler gives focus back to the palette's
 * trigger or to what had it before, so the move waits for the event and then one more task. Call
 * this only from a palette command: the palette's close event is then the next one to come.
 *
 * @param doc The page's document.
 * @param button The control to click and focus.
 */
export function clickAfterPalette(doc: Document, button: HTMLElement | null): void {
  button?.click()
  doc.addEventListener("close", () => setTimeout(() => button?.focus()), {
    capture: true,
    once: true,
  })
}
