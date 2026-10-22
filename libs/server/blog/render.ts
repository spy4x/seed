import { escapeHtml } from "@spy4x/email/html"
import type { RenderedBlogBody } from "@domain/blog"

/** Reading speed for a post's "n min read". */
const WORDS_PER_MINUTE = 230

/**
 * Renders a post's Markdown to HTML that is safe to put on the public page, with its headings for
 * "On this page", its word count and its reading time (at least one minute). Every page that shows
 * a body (the public post, the RSS feed, the admin preview) renders it here, so they all agree.
 *
 * This is the only place that turns Markdown into HTML. Until the safe Markdown renderer of
 * spy4x/ts-libs#743 is released, it escapes the text and keeps its paragraphs, so no Markdown
 * syntax is interpreted and nothing in the source can become markup.
 */
export function renderBlogBody(markdown: string): RenderedBlogBody {
  const html = markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== ``)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join(`\n`)
  return { html, headings: [], ...blogBodyLength(markdown) }
}

/**
 * How many words a post's Markdown has, and how many minutes it takes to read: at least one. The
 * blog index reads this for every post without rendering any. Until `readingMinutes` of
 * spy4x/ts-libs#743 is released, it counts runs of letters and digits.
 */
export function blogBodyLength(markdown: string): { words: number; readingMinutes: number } {
  const words = markdown.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
  return { words, readingMinutes: Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) }
}
