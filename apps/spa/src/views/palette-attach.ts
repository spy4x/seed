/**
 * Runs `run` once the command palette's dialog has finished closing, so what it focuses keeps
 * focus.
 *
 * A palette command runs right after the palette calls `dialog.close()`, which drops `open` at
 * once but sends its `close` event later. That event's handler gives focus back to the palette's
 * trigger or to what had it before, so `run` waits for the event and then one more task. Call
 * this only from a palette command: the palette's close event is then the next one to come.
 *
 * @param doc The page's document.
 * @param run What to do once the palette is closed, such as opening a dialog.
 */
export function afterPalette(doc: Document, run: () => void): void {
  doc.addEventListener("close", () => setTimeout(run), { capture: true, once: true })
}

/**
 * Clicks `button` at once, and moves focus to it once the palette has closed ({@link afterPalette}).
 * The click cannot wait: a file chooser opens only from a click made while the palette's pick is
 * still the person's own action.
 *
 * @param doc The page's document.
 * @param button The control to click and focus.
 */
export function clickAfterPalette(doc: Document, button: HTMLElement | null): void {
  button?.click()
  afterPalette(doc, () => button?.focus())
}
