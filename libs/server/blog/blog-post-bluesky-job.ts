import {
  BLUESKY_MAX_GRAPHEMES,
  createBlueskySession,
  findBlueskyPostByLink,
  postBlueskyLink,
} from "@spy4x/integrations/bluesky"
import type { BlogPostRow } from "./postgres-blog-repository.ts"
import { type AutoPoster, mayHavePosted } from "./auto-post.ts"

/**
 * The `blog.post-bluesky` job's poster: a short text with the post's link and a link card (title
 * and description, no image), on the account `BLUESKY_IDENTIFIER` signs in to with the app
 * password `BLUESKY_APP_PASSWORD`. A run after one that may have posted waits a few seconds, as
 * Bluesky's feed lags behind a new post, then looks for the account's post that links to the
 * same address before it posts.
 *
 * @module
 */

type Result<T> = { success: true; output: T } | { success: false; error: string }

/** The two calls the poster makes; the client signs in with the app password itself. */
export interface BlueskyPostClient {
  post(input: {
    text: string
    link: { uri: string; title: string; description: string }
    langs: string[]
  }): Promise<Result<{ url: string }>>
  /** The account's post that links to `uri`, or `null` for none. */
  find(uri: string): Promise<Result<{ url: string } | null>>
}

/** How long a lookup waits after a run that may have posted. */
export const BLUESKY_FIND_WAIT_MS = 5_000

/** The client of the account `identifier` names, from `@spy4x/integrations/bluesky`. */
export function blueskyClient(
  setup: { identifier: string; appPassword: string; service?: string },
): BlueskyPostClient {
  const session = () =>
    createBlueskySession({
      identifier: setup.identifier,
      appPassword: setup.appPassword,
      ...(setup.service ? { service: setup.service } : {}),
    })
  return {
    async post({ text, link, langs }) {
      const signedIn = await session()
      if (!signedIn.success) return signedIn
      return await postBlueskyLink({ session: signedIn.output, text, link, langs })
    },
    async find(uri) {
      const signedIn = await session()
      if (!signedIn.success) return signedIn
      return await findBlueskyPostByLink({ actor: signedIn.output.did, uri })
    },
  }
}

/**
 * The post's short text for Bluesky, ending with `url`: the title and the opening when both fit
 * in {@link BLUESKY_MAX_GRAPHEMES} characters with the link, else the title, cut when it must be.
 */
export function blueskyText(
  post: Pick<BlogPostRow, `title` | `intro` | `description`>,
  url: string,
): string {
  const room = BLUESKY_MAX_GRAPHEMES - Array.from(url).length - 2
  const opening = post.intro ?? post.description
  const full = `${post.title}\n\n${opening}`
  if (Array.from(full).length <= room) return `${full}\n\n${url}`
  if (Array.from(post.title).length <= room) return `${post.title}\n\n${url}`
  return `${Array.from(post.title).slice(0, room - 1).join(``)}…\n\n${url}`
}

/** The poster from `BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD`, or `null` without both. */
export function readBlueskyPoster(env: { get(name: string): string | undefined }) {
  const identifier = env.get(`BLUESKY_IDENTIFIER`)?.trim() ?? ``
  const appPassword = env.get(`BLUESKY_APP_PASSWORD`)?.trim() ?? ``
  const service = env.get(`BLUESKY_SERVICE`)?.trim() || undefined
  if (identifier === `` || appPassword === ``) return null
  return blueskyPoster(blueskyClient({ identifier, appPassword, service }), appPassword)
}

/** The poster, posting with `client`; `appPassword` is only kept out of stored errors. */
export function blueskyPoster(client: BlueskyPostClient, appPassword: string): AutoPoster {
  return {
    kind: `bluesky`,
    mode: `lookup`,
    waitBeforeFindMs: BLUESKY_FIND_WAIT_MS,
    secrets: [appPassword],
    async find({ link }) {
      const found = await client.find(link)
      if (!found.success) return { problem: found.error }
      return { found: found.output?.url ?? null }
    },
    async post({ post, link }) {
      const made = await client.post({
        text: blueskyText(post, link),
        link: { uri: link, title: post.title, description: post.description },
        langs: [post.language],
      })
      if (made.success) return { url: made.output.url }
      return { problem: made.error, uncertain: mayHavePosted(made.error) }
    },
  }
}
