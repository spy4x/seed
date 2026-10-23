// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { Shot } from "./shot.tsx"

/** The realtime pair is captured half a desktop wide, at 640 and 320 px, 4:5. */
const PAIR_WIDTHS = [640, 320] as const
const PAIR_HEIGHT = 800

function pairSrcset(name: string, theme: "light" | "dark"): string {
  return PAIR_WIDTHS.map((width) => `/shots/${name}-${theme}-${width}.webp ${width}w`).join(`, `)
}

/** One half of the realtime pair, light or dark as the device asks, `sizes` wide. */
export function PairShot(
  { name, alt, sizes = `(min-width: 1280px) 220px, (min-width: 768px) 336px, 50vw` }: {
    name: string
    alt: string
    sizes?: string
  },
): JSX.Element {
  return (
    <picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcset={pairSrcset(name, `dark`)}
        sizes={sizes}
      />
      <img
        src={`/shots/${name}-light-${PAIR_WIDTHS[0]}.webp`}
        srcset={pairSrcset(name, `light`)}
        sizes={sizes}
        width={PAIR_WIDTHS[0]}
        height={PAIR_HEIGHT}
        alt={alt}
        loading="lazy"
        decoding="async"
        class="block h-auto w-full"
      />
    </picture>
  )
}

/** Two windows side by side: a note saved in one is already in the list of the other. */
export function RealtimePair(): JSX.Element {
  return (
    <div class="grid grid-cols-2 gap-4">
      <WindowFrame variant="browser" title="Window 1">
        <PairShot
          name="realtime-a"
          alt="First window: the note editor, with the title changed to “Q4 roadmap: onboarding, billing and invoices”."
        />
      </WindowFrame>
      <WindowFrame variant="browser" title="Window 2">
        <PairShot
          name="realtime-b"
          alt="Second window, a separate sign-in: right after Save, its notes list shows the new title at the top, without a reload."
        />
      </WindowFrame>
    </div>
  )
}

/** The conflict chooser in a browser, with the installed app on a phone beside it. */
export function OfflinePair(): JSX.Element {
  return (
    <div class="grid items-end gap-4 sm:grid-cols-3">
      <WindowFrame
        variant="browser"
        title="app.seedsaas.com/notes"
        class="sm:col-span-2"
      >
        <Shot
          name="offline-conflict"
          alt="A change made offline meets a newer one on the server: “1 change needs your choice” shows both versions of the note side by side, with “Keep mine” and “Use the server's”."
          sizes="(min-width: 1280px) 300px, (min-width: 640px) 448px, 100vw"
        />
      </WindowFrame>
      <WindowFrame variant="phone" class="hidden sm:flex">
        <Shot
          name="notes"
          kind="mobile"
          alt="The same app installed on a phone, showing the group's notes with a search box and filters, each note with its author, when it was created and its tags."
          sizes="160px"
        />
      </WindowFrame>
    </div>
  )
}

interface Box {
  x: number
  y: number
  w: number
  title: string
  note: string
  accent?: boolean
}

const BOX_HEIGHT = 56

const BOXES: readonly Box[] = [
  { x: 20, y: 24, w: 170, title: "The change", note: "a note, a member" },
  { x: 210, y: 24, w: 170, title: "Its event", note: "an outbox row" },
  { x: 115, y: 168, w: 170, title: "Worker", note: "drains the outbox", accent: true },
  { x: 8, y: 280, w: 120, title: "Mail", note: "codes, notices" },
  { x: 140, y: 280, w: 120, title: "Push", note: "phone, desktop" },
  { x: 272, y: 280, w: 120, title: "Live", note: "other tabs" },
]

const ARROWS = [
  `M200 128 L200 164`,
  `M170 224 L80 276`,
  `M200 224 L200 276`,
  `M230 224 L320 276`,
] as const

/**
 * What the diagram shows, for a screen reader. An `aria-label`, not an SVG `<title>`: Fresh treats
 * every `<title>` it renders as the page's.
 */
const OUTBOX_LABEL =
  `The outbox: a change and its event are written in one database transaction; ` +
  `the worker reads the event and sends mail, push notifications and live updates to other tabs.`

/** A change and its event in one transaction, then the worker fanning out to mail, push and tabs. */
export function OutboxDiagram(): JSX.Element {
  return (
    <svg
      viewBox="0 0 400 352"
      role="img"
      aria-label={OUTBOX_LABEL}
      class="mx-auto h-auto w-full max-w-md text-foreground"
    >
      <defs>
        <marker
          id="outbox-head"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" class="fill-current" />
        </marker>
      </defs>
      <rect x="8" y="8" width="384" height="88" rx="14" class="arch-frame" />
      <text x="16" y="118" class="arch-note text-[14px]">
        One transaction: both are saved, or neither
      </text>
      {ARROWS.map((d) => (
        <path
          key={d}
          d={d}
          class="stroke-current"
          fill="none"
          stroke-width="1.5"
          marker-end="url(#outbox-head)"
        />
      ))}
      {BOXES.map((box) => (
        <g key={box.title}>
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={BOX_HEIGHT}
            rx="10"
            class={box.accent ? "arch-box arch-accent" : "arch-box"}
          />
          <text x={box.x + 14} y={box.y + 23} class="fill-current text-[17px] font-semibold">
            {box.title}
          </text>
          <text x={box.x + 14} y={box.y + 44} class="arch-note text-[14px]">{box.note}</text>
        </g>
      ))}
    </svg>
  )
}

/** The notes aggregate's files, in the order `docs/aggregates.md` adds them, by its step numbers. */
const AGGREGATE_FILES = [
  `libs/domain/notes/+lib.ts`,
  `libs/server/db/migrations/…_notes.sql`,
  `libs/server/notes/`,
  `apps/api/features/notes/handlers.ts`,
  `apps/api/features/notes/operations.ts`,
  `libs/ui/notes-screen.tsx`,
  `apps/spa/src/state/notes.ts`,
  `e2e/notes.e2e.ts`,
] as const

/** The file list a new aggregate copies, numbered, as a terminal shows it. */
export function AggregateFiles(): JSX.Element {
  return (
    <WindowFrame variant="terminal" title="docs/aggregates.md">
      {AGGREGATE_FILES.map((path, index) => `${index + 1}  ${path}`).join(`\n`)}
    </WindowFrame>
  )
}

/** What `deno task deploy` prints: its step labels, without the rsync and Compose output between. */
const DEPLOY_OUTPUT = [
  `$ deno task deploy`,
  `Copying files...`,
  `Copying infra/envs/.env.prod to infra/envs/.env...`,
  `Creating web push keys if missing...`,
  `Starting the app...`,
  `Deploy completed.`,
] as const

/** The services Compose starts on the server, besides the product's own apps. */
const SERVICES = [
  `Traefik`,
  `Postgres`,
  `Valkey`,
  `VictoriaMetrics`,
  `VictoriaLogs`,
  `Grafana`,
  `Alertmanager`,
  `Garage file store`,
  `restic backups`,
] as const

/** The deploy's output in a terminal, and the services it starts as a row of labels. */
export function DeployVisual(): JSX.Element {
  return (
    <div class="flex flex-col gap-4">
      <WindowFrame
        variant="terminal"
        title="Terminal"
        caption="Shortened: the rsync and Compose output between the steps is left out."
      >
        {DEPLOY_OUTPUT.join(`\n`)}
      </WindowFrame>
      <ul aria-label="Services on the server" class="flex flex-wrap gap-2">
        {SERVICES.map((service) => (
          <li
            key={service}
            class="rounded-control border border-subtle bg-surface px-2 py-1 font-mono text-sm"
          >
            {service}
          </li>
        ))}
      </ul>
    </div>
  )
}
