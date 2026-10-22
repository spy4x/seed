import { renderMarkdown } from "@spy4x/platform/universal/markdown"
import { readingMinutes } from "@spy4x/platform/universal/text"
import type { RenderedBlogBody } from "@domain/blog"

/**
 * Renders a post's Markdown to HTML that is safe to put on the public page, with its headings for
 * "On this page", its word count and its reading time (at least one minute). Every page that shows
 * a body (the public post, the RSS feed, the admin preview) renders it here, so they all agree.
 *
 * This is the only place that turns Markdown into HTML. `renderMarkdown` escapes raw HTML, keeps
 * only `http`, `https`, `mailto` and relative addresses, and gives every heading an id.
 */
export function renderBlogBody(markdown: string): RenderedBlogBody {
  return { ...renderMarkdown(markdown), ...blogBodyLength(markdown) }
}

/**
 * How many words a post's Markdown has, and how many minutes it takes to read: at least one. The
 * blog index reads this for every post without rendering any.
 */
export function blogBodyLength(markdown: string): { words: number; readingMinutes: number } {
  return {
    words: markdown.match(/\S+/g)?.length ?? 0,
    readingMinutes: readingMinutes(markdown),
  }
}
