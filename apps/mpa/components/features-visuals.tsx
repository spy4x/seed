// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { TerminalText, useSite } from "../use-site.tsx"

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
  { x: 20, y: 24, w: 170, title: "Outbox.change", note: "Outbox.changeNote" },
  { x: 210, y: 24, w: 170, title: "Outbox.event", note: "Outbox.eventNote" },
  { x: 115, y: 168, w: 170, title: "Architecture.worker", note: "Outbox.workerNote", accent: true },
  { x: 8, y: 280, w: 120, title: "Outbox.mail", note: "Outbox.mailNote" },
  { x: 140, y: 280, w: 120, title: "Outbox.push", note: "Outbox.pushNote" },
  { x: 272, y: 280, w: 120, title: "Outbox.live", note: "Outbox.liveNote" },
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
const OUTBOX_LABEL = `Outbox.label`

/** A change and its event in one transaction, then the worker fanning out to mail, push and tabs. */
export function OutboxDiagram(): JSX.Element {
  const { t } = useSite()
  return (
    <svg
      dir="ltr"
      viewBox="0 0 400 352"
      role="img"
      aria-label={t.t(OUTBOX_LABEL)}
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
      <text x="16" y="118" class="arch-note text-[14px]">{t.t(`Outbox.transaction`)}</text>
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
            {t.t(box.title)}
          </text>
          <text x={box.x + 14} y={box.y + 44} class="arch-note text-[14px]">{t.t(box.note)}</text>
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

/** The guide the file list comes from, the terminal's title: a path, the same in every language. */
const AGGREGATES_DOC = `docs/aggregates.md`

/** The file list a new aggregate copies, numbered, as a terminal shows it. */
export function AggregateFiles(): JSX.Element {
  return (
    <WindowFrame variant="terminal" title={AGGREGATES_DOC}>
      <TerminalText>
        {AGGREGATE_FILES.map((path, index) => `${index + 1}  ${path}`).join(`\n`)}
      </TerminalText>
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

/**
 * The deploy's output in a terminal, and the services it starts as labels. Each label grows to fill
 * its row, so the rows end flush at any width instead of leaving one label alone on the last.
 */
export function DeployVisual(): JSX.Element {
  const { t } = useSite()
  return (
    <div class="flex flex-col gap-4">
      <WindowFrame
        variant="terminal"
        title={t.t(`HomeQuickStart.terminal`)}
        caption={t.t(`FeatureVisuals.deployCaption`)}
      >
        <TerminalText>{DEPLOY_OUTPUT.join(`\n`)}</TerminalText>
      </WindowFrame>
      <ul aria-label={t.t(`FeatureVisuals.services`)} class="flex flex-wrap gap-2">
        {SERVICES.map((service) => (
          <li
            key={service}
            class="grow rounded-control border border-subtle bg-surface px-2 py-1 text-center font-mono text-sm"
          >
            {service}
          </li>
        ))}
      </ul>
    </div>
  )
}
