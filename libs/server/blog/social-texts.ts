import { type BlogPostFields, blogPostPath } from "@domain/blog"

/**
 * The texts the owner pastes into LinkedIn, Telegram and X when a post goes live, built
 * from the post's own words: its title, its intro (else its description) and its "In short"
 * points, then its address. They use no label of their own, so each reads in the post's language.
 *
 * @module
 */

/** How many characters X allows in one post. */
export const X_MAX = 280
/** How many characters X counts for any link, however long. */
export const X_LINK_LENGTH = 23

/** The three texts of one post. */
export interface SocialTexts {
  linkedin: string
  telegram: string
  x: string
}

/** The texts for `post`, whose address is on `origin` (such as `https://seedsaas.com`). */
export function socialTexts(
  post: Pick<BlogPostFields, `title` | `slug` | `language` | `description` | `intro` | `tldr`>,
  origin: string,
): SocialTexts {
  const url = `${origin}${blogPostPath(post)}`
  const opening = post.intro ?? post.description
  return {
    linkedin: [post.title, opening, post.tldr.map((point) => `→ ${point}`).join(`\n`), url]
      .filter(Boolean).join(`\n\n`),
    // Telegram's composer turns **words** into bold when the text is pasted.
    telegram: [`**${post.title}**`, opening, post.tldr.map((point) => `• ${point}`).join(`\n`), url]
      .filter(Boolean).join(`\n\n`),
    x: xText(post.title, opening, url),
  }
}

/** The title, the opening when it still fits in {@link X_MAX}, and the link. */
function xText(title: string, opening: string, url: string): string {
  const fits = (text: string) => Array.from(text).length + X_LINK_LENGTH <= X_MAX
  const full = `${title}\n\n${opening}\n\n`
  if (fits(full)) return `${full}${url}`
  const short = `${title}\n\n`
  if (fits(short)) return `${short}${url}`
  const room = X_MAX - X_LINK_LENGTH - 3
  return `${Array.from(title).slice(0, room).join(``)}…\n\n${url}`
}
