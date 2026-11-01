import type { JSX } from "preact"
import type { Catalog } from "@spy4x/platform/universal/i18n"
import { Prose } from "@spy4x/preact-ui/prose"
import { islandProps, type ResolvedBody } from "../post-figures.tsx"

/**
 * Keeps `Prose`'s rhythm across chunks: the column's gap is the space `Prose` puts between two
 * blocks, so a chunk that opens with a heading adds the rest of the heading's top margin.
 */
const CHUNK = `[&>h2:first-child]:mt-8 [&>h3:first-child]:mt-4`

/**
 * A post's body: each HTML chunk in `Prose`, each figure that passed its check as its island,
 * between them. The chunks are the API's HTML from the safe Markdown renderer (docs/blog.md).
 */
export function PostSegments(
  { parts, language, messages }: {
    parts: ResolvedBody[`parts`]
    language: string
    messages: Catalog
  },
): JSX.Element {
  return (
    <div class="flex min-w-0 flex-col gap-4" data-e2e="blog-post-body">
      {parts.map((part, index) => {
        if (part.kind === `html`) return <Prose key={index} html={part.html} class={CHUNK} />
        const Island = part.figure.default
        return <Island key={part.id} {...islandProps(part, language, messages)} />
      })}
    </div>
  )
}
