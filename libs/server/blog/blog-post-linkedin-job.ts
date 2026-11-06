import { postLinkedinShare } from "@spy4x/integrations/linkedin"
import { BLOG_AUTO_POST_SIGN_IN_EXPIRED, channelUtmSource } from "@domain/blog"
import { socialTexts } from "./social-texts.ts"
import { type AutoPoster, mayHavePosted } from "./auto-post.ts"

/**
 * The `blog.post-linkedin` job's poster: the post's LinkedIn text and a link card, on the
 * owner's own profile, with the token `deno task linkedin:sign-in` printed
 * (`LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_TOKEN_EXPIRES_AT`, `LINKEDIN_MEMBER_ID`). LinkedIn has no
 * lookup, so a run that may have posted is never repeated by itself ({@link AutoPoster} `once`).
 * Once the sign-in has expired, rows stay manual until the owner signs in again.
 *
 * @module
 */

/** The one call the poster makes; the client holds the token. */
export interface LinkedinPostClient {
  post(input: {
    commentary: string
    link: { url: string; title: string; description: string }
  }): Promise<{ success: true; output: { url: string } } | { success: false; error: string }>
}

/** What the LinkedIn poster is set up with. */
export interface LinkedinSetup {
  accessToken: string
  /** The member's id, the `sub` the sign-in printed. */
  memberId: string
  /** ISO 8601, `null` when unset: then the expiry is not checked. */
  expiresAt: string | null
}

/** The client of the member `setup` names, from `@spy4x/integrations/linkedin`. */
export function linkedinClient(setup: LinkedinSetup): LinkedinPostClient {
  return {
    post: (input) =>
      postLinkedinShare({
        accessToken: setup.accessToken,
        authorUrn: `urn:li:person:${setup.memberId}`,
        ...input,
      }),
  }
}

/**
 * The LinkedIn sign-in's expiry from `LINKEDIN_TOKEN_EXPIRES_AT`, as an ISO date, or `null` when
 * it is unset or not a date. The API passes only this to the admin, never the token.
 */
export function readLinkedinExpiry(env: { get(name: string): string | undefined }) {
  const value = env.get(`LINKEDIN_TOKEN_EXPIRES_AT`)?.trim() ?? ``
  const time = Date.parse(value)
  return value === `` || Number.isNaN(time) ? null : new Date(time).toISOString()
}

/** The poster from the LinkedIn keys, or `null` without the token and the member id. */
export function readLinkedinPoster(
  env: { get(name: string): string | undefined },
  now: () => number = Date.now,
) {
  const accessToken = env.get(`LINKEDIN_ACCESS_TOKEN`)?.trim() ?? ``
  const memberId = env.get(`LINKEDIN_MEMBER_ID`)?.trim() ?? ``
  if (accessToken === `` || memberId === ``) return null
  const setup = { accessToken, memberId, expiresAt: readLinkedinExpiry(env) }
  return linkedinPoster(linkedinClient(setup), setup, now)
}

/** The poster, posting with `client`; `setup`'s token is only kept out of stored errors. */
export function linkedinPoster(
  client: LinkedinPostClient,
  setup: Pick<LinkedinSetup, `accessToken` | `expiresAt`>,
  now: () => number = Date.now,
): AutoPoster {
  return {
    kind: `linkedin`,
    mode: `once`,
    secrets: [setup.accessToken],
    unavailable: () =>
      setup.expiresAt !== null && Date.parse(setup.expiresAt) <= now()
        ? BLOG_AUTO_POST_SIGN_IN_EXPIRED
        : null,
    async post({ post, channel, siteUrl, link }) {
      const utm = channelUtmSource(channel)
      const made = await client.post({
        commentary: socialTexts(post, siteUrl, utm).linkedin,
        link: { url: link, title: post.title, description: post.description },
      })
      if (made.success) return { url: made.output.url }
      return { problem: made.error, uncertain: mayHavePosted(made.error) }
    },
  }
}
