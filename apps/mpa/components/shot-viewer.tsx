import type { JSX } from "preact"
import ShotLightbox, { LIGHTBOX_KEYS } from "../islands/shot-lightbox.tsx"
import { useSite } from "../use-site.tsx"

/**
 * Opens the page's screenshots in a lightbox. Only pages that show screenshots render it, so the
 * others load no JavaScript; only the lightbox's words, in the page's language, reach the browser.
 */
export function ShotViewer(): JSX.Element {
  const { language, t } = useSite()
  return (
    <ShotLightbox
      language={language}
      messages={Object.fromEntries(LIGHTBOX_KEYS.map((key) => [key, t.t(key)]))}
    />
  )
}
