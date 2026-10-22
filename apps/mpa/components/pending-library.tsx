// TODO(preact-components 10.8.0): delete this file and import `Prose` from
// `@spy4x/preact-ui/prose`, `TldrBox` from `@spy4x/preact-ui/tldr-box` and `PostList` from
// `@spy4x/preact-ui/post-list` (spy4x/preact-components#1002). These stand-ins keep the same props
// so the swap is an import change; they never ship.
import type { ComponentChildren, JSX } from "preact"
import { useFormat } from "@spy4x/preact-ui/format"

export function Prose(
  { html, as = "div", class: className }: { html: string; as?: "div" | "article"; class?: string },
): JSX.Element {
  const Tag = as
  return <Tag class={`pc-prose ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />
}

export function TldrBox(
  { items, title = "In short", id, class: className }: {
    items: readonly ComponentChildren[]
    title?: string
    id?: string
    class?: string
  },
): JSX.Element | null {
  if (items.length === 0) return null
  const headingId = id ?? `tldr`
  return (
    <section
      aria-labelledby={headingId}
      class={`rounded-primary border border-subtle px-4 py-4 sm:px-6 ${className ?? ""}`}
    >
      <h2 id={headingId} class="text-base font-semibold">{title}</h2>
      <ul class="mt-2 list-disc pl-6">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </section>
  )
}

export interface PostListItem {
  href: string
  title: string
  description?: string
  publishedAt: string
  readMinutes?: number
}

export function PostList(
  { posts, headingLevel = 2, label, class: className }: {
    posts: readonly PostListItem[]
    headingLevel?: 2 | 3 | 4
    label?: string
    class?: string
  },
): JSX.Element | null {
  const format = useFormat().utc()
  if (posts.length === 0) return null
  const Heading = `h${headingLevel}` as const
  return (
    <ul aria-label={label} class={`border-t border-subtle ${className ?? ""}`}>
      {posts.map((post) => (
        <li key={post.href} class="relative border-b border-subtle py-6">
          <p class="text-sm text-muted">
            <time dateTime={post.publishedAt}>{format.date(post.publishedAt)}</time>
            {post.readMinutes !== undefined && ` · ${post.readMinutes} min read`}
          </p>
          <Heading class="mt-1 text-lg font-semibold">
            <a href={post.href}>{post.title}</a>
          </Heading>
          {post.description && <p class="mt-1 line-clamp-2 text-muted">{post.description}</p>}
        </li>
      ))}
    </ul>
  )
}
