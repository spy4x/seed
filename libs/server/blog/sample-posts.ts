import type postgres from "postgres"
import type { BlogPostStatus } from "@domain/blog"
import type { Language } from "@domain/identity"
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
  language: Language
  /** The id of the post this one translates, or `null`. */
  translationOf: string | null
  status: BlogPostStatus
  /** Days from now when it goes or went live; `null` for a draft. */
  liveInDays: number | null
}

const DAY_MS = 86_400_000

/** The published English post, which every translation below translates. */
const HELLO_WORLD = `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed703d`

/** A short published translation of the hello-world post. */
function translation(
  id: string,
  language: Language,
  text: Pick<SamplePost, `slug` | `title` | `description` | `topic` | `bodyMd`>,
): SamplePost {
  return {
    id,
    language,
    translationOf: HELLO_WORLD,
    tldr: [],
    status: `published`,
    liveInDays: -2,
    ...text,
  }
}

/**
 * Posts for local work and the website's Lighthouse run: in English a published one, a scheduled
 * one and a draft, and the published one translated into every other language the apps ship, so
 * each language's blog index has a post and the post page links its language versions. The
 * English Markdown has headings, lists, code, a quote and links, so every part of the renderer
 * shows. The ids are fixed, so seeding again adds nothing.
 */
export const SAMPLE_POSTS: readonly SamplePost[] = [
  {
    id: HELLO_WORLD,
    language: `en`,
    translationOf: null,
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
    language: `en`,
    translationOf: null,
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
    language: `en`,
    translationOf: null,
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
  translation(`01a184ae-adb5-7d69-8dde-d1fc4a3059c2`, `ru`, {
    slug: `privet-mir`,
    title: `Привет, мир: зачем мы это сделали`,
    description: `Что умеет продукт, для кого он и что мы выпустим в ближайшие месяцы.`,
    topic: `Продукт`,
    bodyMd: `Мы начали этот продукт, потому что привычные инструменты мешали работать.

## Что он умеет

- Хранит заметки, метки и группы команды в одном месте.
- Работает без сети и догоняет, когда сеть вернётся.
- Работает на вашем сервере или на нашем.

Откройте [демо](https://example.com/demo), чтобы попробовать.
`,
  }),
  translation(`01a184ae-adb5-7fbb-bdd4-6b12cf69245b`, `es`, {
    slug: `hola-mundo`,
    title: `Hola, mundo: por qué lo creamos`,
    description: `Qué hace el producto, para quién es y qué lanzaremos en los próximos meses.`,
    topic: `Producto`,
    bodyMd: `Empezamos este producto porque las herramientas de cada día nos estorbaban.

## Qué hace

- Guarda las notas, etiquetas y grupos de tu equipo en un solo lugar.
- Funciona sin conexión y se pone al día cuando vuelves a tenerla.
- Funciona en tu propio servidor o en el nuestro.

Abre la [demo](https://example.com/demo) para probarlo.
`,
  }),
  translation(`01a184ae-adb5-7dab-baee-75cfc527bb48`, `de`, {
    slug: `hallo-welt`,
    title: `Hallo, Welt: warum wir das gebaut haben`,
    description:
      `Was das Produkt kann, für wen es ist und was wir in den nächsten Monaten liefern.`,
    topic: `Produkt`,
    bodyMd:
      `Wir haben dieses Produkt angefangen, weil uns unsere Werkzeuge jeden Tag im Weg standen.

## Was es kann

- Hält Notizen, Tags und Gruppen deines Teams an einem Ort.
- Funktioniert offline und holt auf, sobald du wieder online bist.
- Läuft auf deinem eigenen Server oder auf unserem.

Öffne die [Demo](https://example.com/demo), um es auszuprobieren.
`,
  }),
  translation(`01a184ae-adb5-7300-a00d-f745cf4ae082`, `pt-BR`, {
    slug: `ola-mundo`,
    title: `Olá, mundo: por que criamos isto`,
    description: `O que o produto faz, para quem é e o que vamos lançar nos próximos meses.`,
    topic: `Produto`,
    bodyMd: `Começamos este produto porque as ferramentas do dia a dia atrapalhavam.

## O que ele faz

- Guarda as notas, tags e grupos da sua equipe em um só lugar.
- Funciona offline e se atualiza quando você volta a ficar online.
- Roda no seu próprio servidor ou no nosso.

Abra a [demo](https://example.com/demo) para experimentar.
`,
  }),
  translation(`01a184ae-adb5-77e0-9788-f0e53059508d`, `ar`, {
    slug: `marhaban-bialalam`,
    title: `مرحبًا بالعالم: لماذا بنينا هذا`,
    description: `ما الذي يفعله المنتج، ولمن هو، وما الذي سنطلقه في الأشهر القادمة.`,
    topic: `المنتج`,
    bodyMd: `بدأنا هذا المنتج لأن الأدوات التي نستخدمها كل يوم كانت تعيق عملنا.

## ما الذي يفعله

- يحفظ ملاحظات فريقك ووسومه ومجموعاته في مكان واحد.
- يعمل دون اتصال، ويلحق بما فاته عند عودة الاتصال.
- يعمل على خادمك الخاص أو على خادمنا.

افتح [العرض التجريبي](https://example.com/demo) لتجربته.
`,
  }),
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
        id, slug, title, description, tldr, topic, body_md, language, translation_of, status,
        publish_at, published_at, author_id, author_name, created_at, updated_at
      ) VALUES (
        ${post.id}, ${post.slug}, ${post.title}, ${post.description}, ${
      sql.array(post.tldr)
    }::text[],
        ${post.topic}, ${post.bodyMd}, ${post.language}, ${post.translationOf}, ${post.status},
        ${live},
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
