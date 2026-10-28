import type { JSX } from "preact"
import { useSite } from "../use-site.tsx"

/** A box of the diagram; its title and note are keys of the `site` catalog. */
interface Box {
  x: number
  y: number
  w: number
  title: string
  note: string
  accent?: boolean
}

interface Arrow {
  d: string
  label?: { x: number; y: number; text: string }
}

interface Layout {
  width: number
  height: number
  boxes: readonly Box[]
  arrows: readonly Arrow[]
  frame: { w: number; h: number }
  caption: readonly { y: number; text: string }[]
  class: string
}

const BOX_HEIGHT = 56

const WIDE: Layout = {
  width: 640,
  height: 360,
  class: "hidden md:block",
  boxes: [
    { x: 24, y: 40, w: 170, title: "Architecture.webApp", note: "Architecture.webAppNote" },
    { x: 24, y: 120, w: 170, title: "Architecture.website", note: "Architecture.websiteNote" },
    {
      x: 250,
      y: 80,
      w: 150,
      title: "Architecture.api",
      note: "Architecture.apiNote",
      accent: true,
    },
    { x: 460, y: 80, w: 156, title: "Architecture.postgres", note: "Architecture.postgresNote" },
    { x: 250, y: 216, w: 150, title: "Architecture.worker", note: "Architecture.workerNote" },
    { x: 460, y: 216, w: 156, title: "Architecture.mail", note: "Architecture.mailNote" },
  ],
  arrows: [
    { d: "M194 68 L246 100" },
    { d: "M194 148 L246 116" },
    { d: "M400 108 L456 108" },
    { d: "M325 136 L325 212", label: { x: 335, y: 180, text: "Architecture.events" } },
    { d: "M400 244 L456 244" },
  ],
  frame: { w: 624, h: 300 },
  caption: [{ y: 340, text: "Architecture.caption" }],
}

const TALL: Layout = {
  width: 360,
  height: 470,
  class: "md:hidden",
  boxes: [
    { x: 24, y: 32, w: 148, title: "Architecture.webApp", note: "Architecture.webAppNoteShort" },
    { x: 188, y: 32, w: 148, title: "Architecture.website", note: "Architecture.websiteNoteShort" },
    {
      x: 96,
      y: 136,
      w: 168,
      title: "Architecture.api",
      note: "Architecture.apiNote",
      accent: true,
    },
    { x: 24, y: 240, w: 148, title: "Architecture.postgres", note: "Architecture.postgresNote" },
    { x: 188, y: 240, w: 148, title: "Architecture.worker", note: "Architecture.workerNote" },
    { x: 188, y: 336, w: 148, title: "Architecture.mail", note: "Architecture.mailNote" },
  ],
  arrows: [
    { d: "M98 88 L150 132" },
    { d: "M262 88 L210 132" },
    { d: "M150 192 L100 236" },
    { d: "M210 192 L260 236" },
    { d: "M262 296 L262 332" },
  ],
  frame: { w: 344, h: 410 },
  caption: [
    { y: 440, text: "Architecture.captionTop" },
    { y: 460, text: "Architecture.captionBottom" },
  ],
}

/**
 * What the diagram shows, for a screen reader. It is an `aria-label`, not an SVG `<title>`: Fresh
 * treats every `<title>` it renders as the page's, so one in the body would replace the head's.
 */
const DIAGRAM_LABEL = `Architecture.label`

/**
 * One layout of the diagram. It is drawn left to right in every language, so a right-to-left page
 * does not anchor its words outside their boxes. SVG text takes its direction from the CSS
 * `direction` property, which the HTML `dir` attribute does not set on an SVG element: the
 * `direction` attribute does.
 */
function Diagram({ layout, idPrefix }: { layout: Layout; idPrefix: string }): JSX.Element {
  const { t } = useSite()
  return (
    <svg
      dir="ltr"
      direction="ltr"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={t.t(DIAGRAM_LABEL)}
      class={`h-auto w-full text-foreground ${layout.class}`}
    >
      <defs>
        <marker
          id={`${idPrefix}-head`}
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
      <rect
        x="8"
        y="16"
        width={layout.frame.w}
        height={layout.frame.h}
        rx="16"
        class="arch-frame"
      />
      {layout.arrows.map((arrow) => (
        <g key={arrow.d}>
          <path
            d={arrow.d}
            class="stroke-current"
            fill="none"
            stroke-width="1.5"
            marker-end={`url(#${idPrefix}-head)`}
          />
          {arrow.label && (
            <text x={arrow.label.x} y={arrow.label.y} class="fill-current text-[14px]">
              {t.t(arrow.label.text)}
            </text>
          )}
        </g>
      ))}
      {layout.boxes.map((box) => (
        <g key={box.title}>
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={BOX_HEIGHT}
            rx="10"
            class={box.accent ? "arch-box arch-accent" : "arch-box"}
          />
          <text
            x={box.x + 14}
            y={box.y + 23}
            class="fill-current text-[17px] font-semibold"
          >
            {t.t(box.title)}
          </text>
          <text x={box.x + 14} y={box.y + 44} class="arch-note text-[14px]">{t.t(box.note)}</text>
        </g>
      ))}
      {layout.caption.map((line) => (
        <text key={line.y} x="16" y={line.y} class="arch-note text-[14px]">{t.t(line.text)}</text>
      ))}
    </svg>
  )
}

/**
 * The parts of Seed and how a change flows through them, as a picture: a wide layout from `md`, a
 * tall one below it. The text beside it carries the same facts, so nothing is in the picture alone.
 */
export function ArchitectureDiagram(): JSX.Element {
  return (
    <>
      <Diagram layout={WIDE} idPrefix="arch-wide" />
      <Diagram layout={TALL} idPrefix="arch-tall" />
    </>
  )
}
