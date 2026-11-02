import type { JSX } from "preact"

/** A figure file the registry test finds by itself: no list names it. */
export const props = { "label?": `string` }

export default function Sample({ label = `Sample` }: { label?: string }): JSX.Element {
  return <figure data-live="false">{label}</figure>
}
