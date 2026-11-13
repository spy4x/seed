import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { BlogChannelKind } from "@domain/blog"

interface SampleChannel {
  id: string
  name: string
  kind: BlogChannelKind
  address: string
  utmSource: string
  addUtm: boolean
}

/**
 * Four channels for local work, with made-up addresses. The ids are fixed, so seeding again adds
 * nothing. The public demo seeds none: its blog and where it was shared are the product's own.
 */
export const SAMPLE_CHANNELS: readonly SampleChannel[] = [
  {
    id: `019a2f6c-0c00-7000-8000-00000000b001`,
    name: `r/selfhosted`,
    kind: `reddit`,
    address: `https://www.reddit.com/r/selfhosted/`,
    utmSource: `reddit-selfhosted`,
    addUtm: true,
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000b002`,
    name: `Telegram channel`,
    kind: `telegram`,
    address: `https://t.me/seed_example`,
    utmSource: `telegram`,
    addUtm: true,
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000b003`,
    name: `Hacker News`,
    kind: `hackernews`,
    address: `news.ycombinator.com`,
    utmSource: `hackernews`,
    addUtm: false,
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000b004`,
    name: `LinkedIn`,
    kind: `linkedin`,
    address: `https://www.linkedin.com/in/example`,
    utmSource: `linkedin`,
    addUtm: true,
  },
]

/**
 * Adds {@link SAMPLE_CHANNELS} for English posts, then marks the newest live English post posted
 * on Reddit with plainly fake numbers and skipped on Hacker News. Every insert skips a row that
 * exists, and numbers go only on a share this run added, so seeding again adds nothing.
 */
export async function seedSampleSharing(sql: postgres.Sql): Promise<void> {
  for (const channel of SAMPLE_CHANNELS) {
    // Manual (`auto_post` false): the sample addresses are fake, so nothing is posted to them.
    await sql`
      INSERT INTO blog_channels (id, name, kind, address, utm_source, add_utm, languages, auto_post)
      VALUES (
        ${channel.id}, ${channel.name}, ${channel.kind}, ${channel.address},
        ${channel.utmSource}, ${channel.addUtm}, ${[`en`]}, false
      )
      ON CONFLICT DO NOTHING
    `
  }
  const [post] = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM blog_posts
    WHERE status = 'published' AND published_at IS NOT NULL AND language = 'en'
    ORDER BY published_at DESC LIMIT 1
  `
  if (!post) return
  const [reddit, , hackerNews] = SAMPLE_CHANNELS
  const shared = await sql<{ id: string }[]>`
    INSERT INTO blog_post_shares (id, post_id, channel_id, status, url, shared_at)
    VALUES (
      ${uuidV7()}, ${post.id}, ${reddit.id}, 'posted',
      ${`https://www.reddit.com/r/selfhosted/comments/example/${post.slug}/`}, now()
    )
    ON CONFLICT (post_id, channel_id) DO NOTHING
    RETURNING id
  `
  for (const share of shared) {
    await sql`
      INSERT INTO blog_share_results (id, share_id, source, views, reactions, comments, score)
      VALUES (${uuidV7()}, ${share.id}, 'hand', 1234, 56, 7, 89)
    `
  }
  await sql`
    INSERT INTO blog_post_shares (id, post_id, channel_id, status, skip_reason)
    VALUES (${uuidV7()}, ${post.id}, ${hackerNews.id}, 'skipped', 'Not news')
    ON CONFLICT (post_id, channel_id) DO NOTHING
  `
}
