import type { JSX } from "preact"
import { useMemo, useState } from "preact/hooks"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { SegmentedControl } from "@spy4x/preact-ui/segmented-control"
import { type FigureFrame, figureTranslator, PostFigure } from "../../components/post-figure.tsx"

/**
 * `<OfflineSyncDemo />`: a model of the SPA's outbox (`docs/offline.md`, "Writes: the outbox") for
 * a post. It takes no props. An arktype definition, not a type: the server compiles it, so
 * arktype stays out of the island.
 */
export const props = { "+": `reject` }

/** One note of the model: its number, and whether the server has it yet. */
export interface DemoNote {
  id: number
  synced: boolean
}

/** Where the figure starts: offline, one note on the server and one waiting on the device. */
export const START: readonly DemoNote[] = [{ id: 1, synced: true }, { id: 2, synced: false }]

/** The most notes the model holds, so the figure stays one screen tall. */
export const MAX_NOTES = 6

/**
 * A note written on the device: saved at once, and sent at once only while `online`. Offline it
 * waits in the queue. Past {@link MAX_NOTES} nothing is added.
 */
export function writeNote(notes: readonly DemoNote[], online: boolean): readonly DemoNote[] {
  if (notes.length >= MAX_NOTES) return notes
  return [...notes, { id: notes.length + 1, synced: online }]
}

/** The network is back: the queue is sent in the order it was written, and every note is saved. */
export function reconnect(notes: readonly DemoNote[]): readonly DemoNote[] {
  return notes.map((note) => ({ ...note, synced: true }))
}

/** The RSS feed's sentence: what the figure shows. */
export function fallback(_props: Record<string, never>, t: Translator<string>): string {
  return t.t(`PostFigure.OfflineSyncDemo.fallback`)
}

type Network = `online` | `offline`

/**
 * Two lists side by side, this device and the server, with a network switch and a "Write a note"
 * button. Drawn by the server in its starting state; the controls work once the page hydrated.
 */
export default function OfflineSyncDemo({ figure }: { figure: FigureFrame }): JSX.Element {
  const t = useMemo(() => figureTranslator(figure), [figure])
  const [network, setNetwork] = useState<Network>(`offline`)
  const [notes, setNotes] = useState<readonly DemoNote[]>(START)
  const online = network === `online`
  const waiting = notes.filter((note) => !note.synced).length
  const full = notes.length >= MAX_NOTES
  const name = (note: DemoNote) => t.t(`PostFigure.OfflineSyncDemo.note`, { number: note.id })

  const switchNetwork = (next: Network) => {
    setNetwork(next)
    if (next === `online`) setNotes(reconnect)
  }

  return (
    <PostFigure
      frame={figure}
      t={t}
      title={t.t(`PostFigure.OfflineSyncDemo.title`)}
      lead={t.t(`PostFigure.OfflineSyncDemo.lead`)}
      caption={t.t(`PostFigure.OfflineSyncDemo.caption`)}
      controls={
        <div class="flex flex-wrap items-center gap-3">
          <SegmentedControl<Network>
            ariaLabel={t.t(`PostFigure.OfflineSyncDemo.network`)}
            options={[
              { value: `online`, label: t.t(`PostFigure.OfflineSyncDemo.online`) },
              { value: `offline`, label: t.t(`PostFigure.OfflineSyncDemo.offline`) },
            ]}
            value={network}
            onChange={switchNetwork}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={full}
            onClick={() => setNotes((current) => writeNote(current, online))}
          >
            {t.t(`PostFigure.OfflineSyncDemo.write`)}
          </Button>
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section class="flex flex-col gap-2">
            <p id={`${figure.id}-device`} class="text-sm font-semibold text-foreground">
              {t.t(`PostFigure.OfflineSyncDemo.device`)}
            </p>
            <ul aria-labelledby={`${figure.id}-device`} class="flex flex-col gap-2">
              {notes.map((note) => (
                <li
                  key={note.id}
                  class="flex items-center justify-between gap-2 rounded-card border border-subtle px-3 py-2"
                >
                  <span class="text-foreground">{name(note)}</span>
                  <Badge
                    color={note.synced ? `green` : `orange`}
                    type="outline"
                    text={t.t(
                      note.synced
                        ? `PostFigure.OfflineSyncDemo.saved`
                        : `PostFigure.OfflineSyncDemo.waiting`,
                    )}
                  />
                </li>
              ))}
            </ul>
          </section>
          <section class="flex flex-col gap-2">
            <p id={`${figure.id}-server`} class="text-sm font-semibold text-foreground">
              {t.t(`PostFigure.OfflineSyncDemo.server`)}
            </p>
            <ul aria-labelledby={`${figure.id}-server`} class="flex flex-col gap-2">
              {notes.filter((note) => note.synced).map((note) => (
                <li
                  key={note.id}
                  class="rounded-card border border-subtle px-3 py-2 text-foreground"
                >
                  {name(note)}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <p role="status" class="text-sm text-muted">
          {waiting > 0
            ? t.t(`PostFigure.OfflineSyncDemo.queue`, { count: waiting })
            : t.t(`PostFigure.OfflineSyncDemo.synced`)}
          {full && ` ${t.t(`PostFigure.OfflineSyncDemo.full`)}`}
        </p>
      </div>
    </PostFigure>
  )
}
