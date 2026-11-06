import { postMastodonStatus } from "@spy4x/integrations/mastodon"
import { channelUtmSource } from "@domain/blog"
import { channelText } from "./social-texts.ts"
import { type AutoPoster, mayHavePosted } from "./auto-post.ts"

/**
 * The `blog.post-mastodon` job's poster: the post's short text with its link, as a public status
 * of the account `MASTODON_ACCESS_TOKEN` belongs to, on the server `MASTODON_INSTANCE_URL` names.
 * The token goes to that server only: a channel whose address (`@you@instance`) names another
 * host is refused before any request. The instance draws the link card. Each status is sent with
 * the share's id as its idempotency key, so a retry within the hour answers the first status
 * instead of posting a second.
 *
 * @module
 */

/** The one call the poster makes; the client holds the token. */
export interface MastodonPostClient {
  post(input: {
    instanceUrl: string
    status: string
    idempotencyKey: string
    language: string
  }): Promise<{ success: true; output: { url: string } } | { success: false; error: string }>
}

/** The client of the account `accessToken` belongs to, from `@spy4x/integrations/mastodon`. */
export function mastodonClient(accessToken: string): MastodonPostClient {
  return { post: (input) => postMastodonStatus({ ...input, accessToken, visibility: `public` }) }
}

/** The instance of a Mastodon account address such as `@seed@mastodon.social`, or `null`. */
export function mastodonInstance(address: string): string | null {
  const host = /^@?[A-Za-z0-9_]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(address.trim())?.[1]
  return host === undefined ? null : `https://${host.toLowerCase()}`
}

/** The origin of an `https` server address such as `https://mastodon.social/`, or `null`. */
export function mastodonServer(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === `https:` ? parsed.origin : null
  } catch {
    return null
  }
}

/**
 * The poster from `MASTODON_ACCESS_TOKEN` and `MASTODON_INSTANCE_URL`, or `null` while either is
 * unset or the server is not an `https` address.
 */
export function readMastodonPoster(env: { get(name: string): string | undefined }) {
  const token = env.get(`MASTODON_ACCESS_TOKEN`)?.trim() ?? ``
  const server = mastodonServer(env.get(`MASTODON_INSTANCE_URL`) ?? ``)
  return token === `` || server === null
    ? null
    : mastodonPoster(mastodonClient(token), token, server)
}

/**
 * The poster, posting with `client` to `server` (an origin such as `https://mastodon.social`);
 * `token` is only kept out of stored errors.
 */
export function mastodonPoster(
  client: MastodonPostClient,
  token: string,
  server: string,
): AutoPoster {
  return {
    kind: `mastodon`,
    mode: `idempotent`,
    secrets: [token],
    async post({ shareId, post, channel, siteUrl }) {
      const instanceUrl = mastodonInstance(channel.address)
      if (instanceUrl === null) {
        return {
          problem: `the channel's address is not a Mastodon account (@you@instance)`,
          uncertain: false,
        }
      }
      if (instanceUrl !== server) {
        return {
          problem: `the channel's account is on ${new URL(instanceUrl).host}, but ` +
            `MASTODON_INSTANCE_URL names ${new URL(server).host}`,
          uncertain: false,
        }
      }
      const utm = channelUtmSource(channel)
      const status = channelText(`mastodon`, post, siteUrl, utm)!
      const made = await client.post({
        instanceUrl,
        status,
        idempotencyKey: shareId,
        language: post.language,
      })
      if (made.success) return { url: made.output.url }
      return { problem: made.error, uncertain: mayHavePosted(made.error) }
    },
  }
}
