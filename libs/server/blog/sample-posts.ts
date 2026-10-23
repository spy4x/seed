import type postgres from "postgres"
import type { BlogPostStatus } from "@domain/blog"
import { queueDueBlogJobs } from "./blog-publish-job.ts"

/** One sample post, with its time counted from the seed's moment. */
interface SamplePost {
  id: string
  slug: string
  title: string
  description: string
  tldr: string[]
  topic: string
  bodyMd: string
  status: BlogPostStatus
  /** Days from now when it goes or went live; `null` for a draft. */
  liveInDays: number | null
}

const DAY_MS = 86_400_000

/**
 * Three posts for local work and the website's Lighthouse run: a published one, a scheduled one
 * and a draft. Their Markdown has headings, lists, code, a quote and links, so every part of the
 * renderer shows. The ids are fixed, so seeding again adds nothing.
 */
export const SAMPLE_POSTS: readonly SamplePost[] = [
  {
    id: `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed703d`,
    slug: `hello-world`,
    title: `Hello, world: why we built this`,
    description:
      `What the product does, who it is for, and what we plan to ship over the next few months.`,
    tldr: [
      `One place for the work your team repeats every week.`,
      `Free to self-host, with a paid cloud for teams that would rather not.`,
      `New releases every week, announced here and in the newsletter.`,
    ],
    topic: `Product`,
    status: `published`,
    liveInDays: -3,
    bodyMd: `We started this product because the tools we used every day kept getting in the way.
This post explains what we built, and what comes next.

## What it does

- Keeps your team's notes, tags and groups in one place.
- Works offline, and catches up when you are back online.
- Runs on your own server, or on ours.

## How to try it

1. Open the [live demo](https://example.com/demo) and press **Try it now**.
2. Make a note, invite a friend, and watch it appear on their screen.
3. Read the [documentation](/docs) when you want to host it yourself.

## For developers

The API answers plain JSON. A note is one request away:

\`\`\`sh
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/notes
\`\`\`

### What is next

> Ship small, ship often, and write down what you learn.

We publish a post for every release. Subscribe below to get them by email.
`,
  },
  {
    id: `01a1658a-5fe8-7f47-9c53-042020858511`,
    slug: `scheduled-jobs-explained`,
    title: `Scheduled jobs, explained`,
    description: `How the server runs work in the background: one-off, delayed and repeating jobs.`,
    tldr: [`Jobs run in the worker, never in a request.`, `Every job is retried until it works.`],
    topic: `Engineering`,
    status: `scheduled`,
    liveInDays: 7,
    bodyMd: `Some work should not make a person wait: sending an email, cleaning up old rows.

## Three kinds of job

- **One-off**: runs as soon as the worker is free.
- **Delayed**: runs at a time you choose.
- **Repeating**: runs on a schedule, such as every night at 03:00 UTC.

Read the code in \`libs/server/jobs\` to see how a job is added.
`,
  },
  {
    id: `01a1658a-5fe8-7cd2-bd98-1316372f4646`,
    slug: `draft-pricing-notes`,
    title: `Draft: how we think about pricing`,
    description: `Notes on pricing a product that is free to self-host. Not published yet.`,
    tldr: [],
    topic: `Product`,
    status: `draft`,
    liveInDays: null,
    bodyMd: `## Open questions

- What does the paid cloud include?
- Do teams pay per seat or per workspace?

More soon.
`,
  },
]

/**
 * Writes {@link SAMPLE_POSTS} by `authorId` with their times counted from `now`, and queues the
 * scheduled one's job. A post that exists already is left as it is, so running it again adds
 * nothing. Development only (`deno task db:seed`): the public demo seeds no posts. Answers how
 * many posts it wrote.
 */
export async function seedSamplePosts(
  sql: postgres.Sql,
  authorId: number,
  now = new Date(),
): Promise<number> {
  let written = 0
  for (const post of SAMPLE_POSTS) {
    const live = post.liveInDays === null
      ? null
      : new Date(now.getTime() + post.liveInDays * DAY_MS)
    // A published post was written before it went live.
    const writtenAt = live !== null && live < now ? live : now
    const rows = await sql`
      INSERT INTO blog_posts (
        id, slug, title, description, tldr, topic, body_md, status, publish_at, published_at,
        author_id, author_name, created_at, updated_at
      ) VALUES (
        ${post.id}, ${post.slug}, ${post.title}, ${post.description}, ${
      sql.array(post.tldr)
    }::text[],
        ${post.topic}, ${post.bodyMd}, ${post.status}, ${live},
        ${post.status === `published` ? live : null}, ${authorId},
        (SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), '')
          FROM users WHERE id = ${authorId}),
        ${writtenAt}, ${writtenAt}
      )
      ON CONFLICT DO NOTHING
    `
    written += rows.count
  }
  await queueDueBlogJobs(sql)
  return written
}
