import {
  type BlogChannelKind,
  type BlogPostFields,
  blogPostPath,
  withUtmSource,
} from "@domain/blog"

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

/** What a post's texts are built from. */
export type SocialPost = Pick<
  BlogPostFields,
  `title` | `slug` | `language` | `description` | `intro` | `tldr`
>

/**
 * The texts for `post`, whose address is on `origin` (such as `https://seedsaas.com`). With
 * `utmSource`, the address carries it, so the website's stats count the visits it brings.
 */
export function socialTexts(
  post: SocialPost,
  origin: string,
  utmSource: string | null = null,
): SocialTexts {
  const url = withUtmSource(`${origin}${blogPostPath(post)}`, utmSource)
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

/**
 * The text a sharing channel of `kind` gets, or `null` for a kind that takes no pasted text:
 * Dev.to and Hashnode copy the whole post, and Reddit and Hacker News take a title and a link.
 * Mastodon and Bluesky take X's short text; a newsletter and any other channel, LinkedIn's.
 */
export function channelText(
  kind: BlogChannelKind,
  post: SocialPost,
  origin: string,
  utmSource: string | null,
): string | null {
  if (kind === `devto` || kind === `hashnode` || kind === `reddit` || kind === `hackernews`) {
    return null
  }
  const texts = socialTexts(post, origin, utmSource)
  if (kind === `telegram`) return texts.telegram
  if (kind === `x` || kind === `mastodon` || kind === `bluesky`) return texts.x
  return texts.linkedin
}
