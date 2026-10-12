import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { Cluster, Grid, Section } from "@spy4x/preact-ui/layout"
import { REPOSITORY_URL, SiteFrame, spaLinks } from "../site.tsx"
import { define } from "../utils.ts"

const FEATURES = [
  {
    title: "Sign-in that is done",
    text: "Sign-up, sign-in and sessions in a signed cookie. E-mail verification by one-time " +
      "code, password reset and an authenticator-app second factor.",
  },
  {
    title: "Groups with roles",
    text: "Every account gets a group at sign-up. Invite members, give them roles from viewer " +
      "to owner, hand ownership over. Groups are the one boundary every rule checks.",
  },
  {
    title: "Billing per member",
    text: "Stripe subscriptions per group: a free plan with limits, a paid plan per member, " +
      "trials, cancelling and notices when a payment fails.",
  },
  {
    title: "Realtime",
    text: "A change reaches every open tab over a WebSocket, and an app that wakes up from the " +
      "background catches up on what it missed.",
  },
  {
    title: "An app that works offline",
    text: "The web app installs like a native one, opens with no network and queues writes. A " +
      "write that went stale shows as a conflict to settle, never as a silent overwrite.",
  },
  {
    title: "Web push",
    text: "People allow notifications once and get them on their phone or desktop, with the " +
      "keys created for you.",
  },
  {
    title: "A worker with an outbox",
    text: "The API writes an event in the same transaction as the change; the worker sends the " +
      "mail and does the slow work after, so nothing is lost when a step fails.",
  },
  {
    title: "Deploy to your own server",
    text: "Docker Compose for development and one-server production: Traefik with certificates, " +
      "Postgres, Valkey, MinIO, Loki, Prometheus and Grafana.",
  },
  {
    title: "A public website",
    text: "This site: rendered on the server, works with JavaScript turned off, with pricing, " +
      "legal pages and a newsletter with double opt-in.",
  },
] as const

const PARTS = [
  {
    name: "The API",
    text: "Hono on Deno. It holds every rule: who may do what, in which group. It is the only " +
      "part that writes to Postgres.",
  },
  {
    name: "The web app",
    text: "Preact. It is what your users sign in to. It calls the API and listens on a " +
      "WebSocket, so it shows other people's changes as they happen.",
  },
  {
    name: "The worker",
    text: "It reads the events the API wrote next to each change and does the slow work: mail, " +
      "notifications, clean-up.",
  },
  {
    name: "The website",
    text: "Fresh, rendered on the server, like this page. It explains your product and links " +
      "into the app.",
  },
] as const

const QUICK_START = [
  "gh repo create my-product --template spy4x/template --private --clone",
  "cd my-product",
  "cp infra/envs/.env.example infra/envs/.env   # then fill in the secrets",
  "deno task vapid-key:create",
  "deno task proxy:start",
  "deno task dev",
].join("\n")

const WORKS_TODAY = [
  "Sign-up, sign-in, e-mail verification, password reset and the second factor",
  "Groups with members, roles, invitations and ownership transfer",
  "Billing per member with trials, through Stripe",
  "Notes, the example feature to copy for your own",
  "Realtime updates, the offline app and web push",
  "The outbox worker, the mailing list and this website",
]

const NOT_YET = [
  "Sign-in with Google, GitHub or passkeys",
  "Downloading an account's data",
  "Parts of the worker",
]

function List({ items }: { items: readonly string[] }): JSX.Element {
  return (
    <ul class="list-disc space-y-2 pl-6">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}

/** The home page: what Template is, who it is for, how it works, how to start, and its status. */
export default define.page(function Home({ state }) {
  const spa = spaLinks(state.spaOrigin)
  return (
    <SiteFrame
      state={state}
      path="/"
      head={{
        title: "Template: an open-source SaaS starter on Deno",
        description: "Sign-up with a second factor, groups with roles, billing per member, " +
          "realtime and an offline app, wired together and MIT-licensed. Try the live demo.",
      }}
    >
      <section class="flex flex-col gap-6 py-8" aria-labelledby="hero-title">
        <p class="text-sm font-semibold text-muted">Open source · MIT · Deno 2</p>
        <h1 id="hero-title" class="max-w-3xl text-4xl font-bold sm:text-5xl">
          The groundwork of a SaaS, already built.
        </h1>
        <p class="max-w-2xl text-lg text-muted">
          Template is an open-source starter for multi-user web products. Accounts with a second
          factor, groups with roles, billing per member, realtime and an offline app are wired
          together, so your first week goes to your product, not to sign-in.
        </p>
        <Cluster gap="md">
          <Button href={spa.signUp} size="lg" data-e2e="home-try-demo">Try the live demo</Button>
          <Button href={REPOSITORY_URL} variant="outline" size="lg">View on GitHub</Button>
        </Cluster>
        <p class="text-sm text-muted">
          The demo is the app you get on day one, with nothing added.
        </p>
      </section>

      <Section title="Who it is for">
        <p class="max-w-3xl">
          Developers starting a product that many people use together, who want sign-in, groups,
          billing and deployment settled before the first feature. It runs on a server you control.
          Skip it if you deploy to serverless functions.
        </p>
      </Section>

      <Section id="features" title="What you get" description="Each part works today.">
        <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <Card class="h-full">
                <CardBody>
                  <h3 class="font-semibold">{feature.title}</h3>
                  <p class="mt-2 text-sm text-muted">{feature.text}</p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="how-it-works"
        title="How it works"
        description="Four parts, one repository, one server."
      >
        <ol class="grid gap-4 sm:grid-cols-2">
          {PARTS.map((part, index) => (
            <li key={part.name} class="flex gap-4">
              <span class="text-2xl font-bold text-muted" aria-hidden="true">{index + 1}</span>
              <div>
                <h3 class="font-semibold">{part.name}</h3>
                <p class="mt-1 text-sm text-muted">{part.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="quick-start"
        title="Quick start"
        description="You need Deno 2, Docker and the GitHub CLI."
      >
        <pre class="overflow-x-auto rounded-md border border-subtle bg-surface p-4 text-sm"><code>{QUICK_START}</code></pre>
        <p>
          Then open the address in <code>DOMAIN</code>, <code>app.localhost</code>{" "}
          by default. The README lists every secret to fill in and how to deploy.
        </p>
      </Section>

      <Section
        id="status"
        title="Honest status"
        description="Work in progress, built in public. Here is where it stands."
      >
        <Grid gap="lg" minColumnWidth="lg">
          <div>
            <h3 class="mb-2 font-semibold">Works today</h3>
            <List items={WORKS_TODAY} />
          </div>
          <div>
            <h3 class="mb-2 font-semibold">Not built yet</h3>
            <List items={NOT_YET} />
          </div>
        </Grid>
      </Section>

      <Section title="Built in public">
        <p class="max-w-3xl">
          I'm Anton Shubin. I build client MVPs on this template and develop it in the open. If
          something is missing for your product, or you just want to say what you think,{" "}
          <a href={`${REPOSITORY_URL}/issues`} class="underline">open an issue</a> or{" "}
          <a href="https://antonshubin.com" class="underline">write to me</a>.
        </p>
        <Cluster gap="md">
          <Button href={spa.signUp}>Try the live demo</Button>
          <Button href={REPOSITORY_URL} variant="outline">View on GitHub</Button>
        </Cluster>
      </Section>
    </SiteFrame>
  )
})
