import type { PublicBlogPostSummary } from "@domain/blog"

/**
 * Blog post covers. A Seed post's cover is a file in the repository
 * (`libs/server/blog/seed-posts/covers/`, served at {@link COVERS_PATH}) in three widths; a
 * product's post may name an `https://` picture instead (`coverUrl`).
 *
 * @module
 */

/** Where the website serves the covers of Seed's own posts. */
export const COVERS_PATH = `/blog/covers`

/** The size of a cover file, in pixels: 16:9. */
export const COVER_SIZE = { width: 1600, height: 900 } as const

/** The width of a cover's small copy, `<name>-640.webp`. */
export const COVER_SMALL_WIDTH = 640

/**
 * The width of a cover's middle copy, `<name>-960.webp`: a phone's full-width slot at 1.75x
 * density needs about 665 px, which the small copy cannot fill and the full one overfills.
 */
export const COVER_MEDIUM_WIDTH = 960

/** A cover as an `<img>` draws it: `srcset` only for a file, which has every width. */
export interface CoverImage {
  src: string
  srcset?: string
  width: number
  height: number
}

/**
 * The cover of `post` as an `<img>` takes it, or `null` when it has none. A file cover gets all
 * three widths; an `https://` cover is drawn at the cover size, as the editor asks for a 16:9 picture.
 */
export function coverImage(
  post: Pick<PublicBlogPostSummary, `coverFile` | `coverUrl`>,
): CoverImage | null {
  if (post.coverFile !== null) {
    const src = `${COVERS_PATH}/${post.coverFile}`
    const copy = (width: number) =>
      `${COVERS_PATH}/${post.coverFile!.replace(/\.webp$/, `-${width}.webp`)} ${width}w`
    return {
      src,
      srcset: [
        copy(COVER_SMALL_WIDTH),
        copy(COVER_MEDIUM_WIDTH),
        `${src} ${COVER_SIZE.width}w`,
      ].join(`, `),
      ...COVER_SIZE,
    }
  }
  return post.coverUrl === null ? null : { src: post.coverUrl, ...COVER_SIZE }
}

/** Where the website serves the link-preview cards of Seed's own posts. */
export const OG_CARDS_PATH = `/blog/og`

/**
 * The link-preview card of `post`, `<slug>.jpg` (made by `deno task og:blog`), or `null` for a
 * post that has none. Every Seed post has one, which `og-cards.test.ts` checks; a product's post,
 * written in the admin, shares its own cover or the site's image instead.
 */
export function ogCard(
  post: Pick<PublicBlogPostSummary, `coverFile` | `slug`>,
): { src: string; width: number; height: number } | null {
  if (post.coverFile === null) return null
  return { src: `${OG_CARDS_PATH}/${post.slug}.jpg`, width: 1200, height: 630 }
}

/** How wide a cover is drawn in a post list: beside the text from 640 px, full width below. */
export const LIST_COVER_SIZES = `(min-width: 640px) 192px, calc(100vw - 32px)`

/** The cover of `post` as a `PostList` row draws it, or `undefined` when it has none. */
export function listCoverImage(
  post: Pick<PublicBlogPostSummary, `coverFile` | `coverUrl`>,
): (CoverImage & { sizes?: string }) | undefined {
  const cover = coverImage(post)
  if (cover === null) return undefined
  return cover.srcset ? { ...cover, sizes: LIST_COVER_SIZES } : cover
}
