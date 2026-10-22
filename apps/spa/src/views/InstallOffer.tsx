import { InstallPrompt } from "@spy4x/preact-system/install-prompt"
import type { InstallPromptStore } from "@spy4x/preact-signals/install-prompt"
import { pageHeading } from "@spy4x/preact-system/route-announcer"
import { install } from "../install.ts"

/**
 * The "install this app" offer above every signed-in page. After "Not now" or an accepted install
 * the card leaves, and focus moves to the page's `<h1>` (`<main>` while a page has no heading yet)
 * instead of falling to the page body: the element a route change moves focus to. The card keeps
 * the page's own section gap (`gap-8`) above the page header, so it never touches the title.
 */
export function InstallOffer({ store = install }: { store?: InstallPromptStore }) {
  return (
    <InstallPrompt
      mode={store.visible.value ? store.mode.value : "unavailable"}
      onInstall={() => store.install()}
      onDismiss={() => store.dismiss()}
      returnFocus={pageHeading}
      class="mb-8"
    />
  )
}
