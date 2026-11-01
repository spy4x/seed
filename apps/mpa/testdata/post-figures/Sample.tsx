import type { JSX } from "preact"
import { type } from "arktype"

/** A figure file the registry test finds by itself: no list names it. */
export const props = type({ "label?": `string` })

export default function Sample({ label = `Sample` }: { label?: string }): JSX.Element {
  return <figure data-live="false">{label}</figure>
}
