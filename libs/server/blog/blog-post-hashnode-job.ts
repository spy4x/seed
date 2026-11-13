import { findHashnodePostBySlug, publishHashnodePost } from "@spy4x/integrations/hashnode"
import type { BlogPostRow } from "./postgres-blog-repository.ts"
import { devtoArticle } from "./blog-crosspost-job.ts"
import { type AutoPoster, mayHavePosted } from "./auto-post.ts"

/**
 * The `blog.post-hashnode` job's poster: the whole article on the publication
 * `HASHNODE_PUBLICATION_ID`, with `HASHNODE_TOKEN`, its original address set to the post on the
 * website so search engines credit the website. A run after one that may have posted looks the
 * article up by its slug before it posts.
 *
 * @module
 */

type Result<T> = { success: true; output: T } | { success: false; error: string }

/** An article as the poster sends it. */
export interface HashnodeArticle {
  title: string
  slug: string
  subtitle: string
  contentMarkdown: string
  originalArticleURL: string
  coverImageURL?: string
  tags?: string[]
}

/** The two calls the poster makes; the client holds the token and the publication. */
export interface HashnodePostClient {
  publish(article: HashnodeArticle): Promise<Result<{ url: string }>>
  /** The publication's article at `slug`, or `null` for none. */
  find(slug: string): Promise<Result<{ url: string } | null>>
}

/** The client of publication `publicationId`, from `@spy4x/integrations/hashnode`. */
export function hashnodeClient(token: string, publicationId: string): HashnodePostClient {
  return {
    publish: (article) => publishHashnodePost({ token, publicationId, ...article }),
    find: (slug) => findHashnodePostBySlug({ token, publicationId, slug }),
  }
}

/** The article's slug: the post's, with its language after it for a translation. */
export function hashnodeSlug(post: Pick<BlogPostRow, `slug` | `language` | `translationOf`>) {
  return post.translationOf === null ? post.slug : `${post.slug}-${post.language.toLowerCase()}`
}

/** The article of `post`: Dev.to's text ({@link devtoArticle}), with the post's own slug. */
export function hashnodeArticle(post: BlogPostRow, siteUrl: string): HashnodeArticle {
  const article = devtoArticle(post, siteUrl)
  return {
    title: article.title,
    slug: hashnodeSlug(post),
    subtitle: post.description,
    contentMarkdown: article.body_markdown,
    originalArticleURL: article.canonical_url,
    ...(article.main_image ? { coverImageURL: article.main_image } : {}),
    ...(article.tags ? { tags: [...article.tags] } : {}),
  }
}

/** The poster from `HASHNODE_TOKEN` and `HASHNODE_PUBLICATION_ID`, or `null` without both. */
export function readHashnodePoster(env: { get(name: string): string | undefined }) {
  const token = env.get(`HASHNODE_TOKEN`)?.trim() ?? ``
  const publicationId = env.get(`HASHNODE_PUBLICATION_ID`)?.trim() ?? ``
  if (token === `` || publicationId === ``) return null
  return hashnodePoster(hashnodeClient(token, publicationId), token)
}

/** The poster, posting with `client`; `token` is only kept out of stored errors. */
export function hashnodePoster(client: HashnodePostClient, token: string): AutoPoster {
  return {
    kind: `hashnode`,
    mode: `lookup`,
    secrets: [token],
    async find({ post }) {
      const found = await client.find(hashnodeSlug(post))
      if (!found.success) return { problem: found.error }
      return { found: found.output?.url ?? null }
    },
    async post({ post, siteUrl }) {
      const made = await client.publish(hashnodeArticle(post, siteUrl))
      if (made.success) return { url: made.output.url }
      return { problem: made.error, uncertain: mayHavePosted(made.error) }
    },
  }
}
