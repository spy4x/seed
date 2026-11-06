// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { type Catalog, createTranslator } from "@spy4x/platform/universal/i18n"
import { createFormatters } from "@spy4x/time/format"
import { buttonClasses } from "@spy4x/preact-ui/button"
import {
  type ChecklistControl,
  type ChecklistState,
  enhanceChecklist,
} from "@spy4x/preact-ui/checklist"
import { Progress } from "@spy4x/preact-ui/progress"

/** The catalog keys the summary reads, sent to the browser and nothing more. */
export const CHECKLIST_KEYS = [
  `LaunchChecklist.static`,
  `LaunchChecklist.progress`,
  `LaunchChecklist.progressLabel`,
  `LaunchChecklist.sectionProgress`,
  `LaunchChecklist.storageOk`,
  `LaunchChecklist.storageBlocked`,
  `LaunchChecklist.empty`,
  `LaunchChecklist.allChecked`,
  `LaunchChecklist.clear`,
  `LaunchChecklist.cleared`,
  `LaunchChecklist.undo`,
  `LaunchChecklist.restored`,
  `LaunchChecklist.printed`,
] as const

/** How long Undo stays after Clear ticks. */
export const UNDO_MS = 10_000

/** The element that holds the server-rendered checkboxes. */
export const CHECKLIST_ROOT_ID = `checklist`

/** What the server hands the summary. */
export interface LaunchChecklistProps {
  language: string
  messages: Catalog
  storageKey: string
  /** Items and sections, for the line shown before the script runs. */
  total: number
  sections: number
}

/** Where focus goes after the next render. */
type FocusTarget = `undo` | `clear` | `first-box`

/**
 * The checklist's summary: before the script runs, how many items there are; then the count, a
 * `Progress` bar, where the ticks are kept, and Clear ticks with an Undo that goes after
 * {@link UNDO_MS}. It also writes each section's count beside its heading and in "On this page"
 * (`data-checklist-count`, `data-checklist-nav`), and the date into the printed header
 * (`data-checklist-printed`). The ticks themselves are `enhanceChecklist`'s.
 */
export default function LaunchChecklist(
  { language, messages, storageKey, total, sections }: LaunchChecklistProps,
): JSX.Element {
  const t = createTranslator({ language, catalogs: [{ source: messages }] })
  const [state, setState] = useState<ChecklistState>()
  const [cleared, setCleared] = useState<string[]>([])
  const [spoken, setSpoken] = useState(``)
  const control = useRef<ChecklistControl>()
  const undoTimer = useRef<ReturnType<typeof setTimeout>>()
  const focusNext = useRef<FocusTarget>()
  const undoButton = useRef<HTMLButtonElement>(null)
  const clearButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const root = document.getElementById(CHECKLIST_ROOT_ID)
    if (!root) return
    let started = false
    let checked = 0
    const unwire = enhanceChecklist(root, {
      key: storageKey,
      storage: () => localStorage,
      onChange: (next) => {
        const all = next.total > 0 && next.checked === next.total
        // The first report is the stored ticks coming back, which nobody needs to hear. After
        // that, each change empties the live region, so the same message later is heard again.
        if (started) setSpoken(all && checked < next.total ? t.t(`LaunchChecklist.allChecked`) : ``)
        started = true
        checked = next.checked
        setState(next)
        // A tick after Clear makes the cleared ticks stale, so their Undo goes.
        if (next.checked > 0) {
          clearTimeout(undoTimer.current)
          setCleared([])
        }
        for (const [section, count] of Object.entries(next.bySection)) {
          const values = { done: count.checked, count: count.total }
          for (const node of root.querySelectorAll(`[data-checklist-count="${section}"]`)) {
            node.textContent = t.t(`LaunchChecklist.sectionProgress`, values)
          }
          for (const node of document.querySelectorAll(`[data-checklist-nav="${section}"]`)) {
            node.textContent = `${count.checked}/${count.total}`
          }
        }
      },
    })
    control.current = unwire
    const format = createFormatters({ locale: language === `en` ? `en-GB` : language })
    const stamp = () => {
      for (const node of document.querySelectorAll(`[data-checklist-printed]`)) {
        node.textContent = `, ${t.t(`LaunchChecklist.printed`, { date: format.date(new Date()) })}`
      }
    }
    addEventListener(`beforeprint`, stamp)
    return () => {
      unwire()
      clearTimeout(undoTimer.current)
      removeEventListener(`beforeprint`, stamp)
    }
  }, [])

  // Runs after every render, so the button it focuses exists by then.
  useEffect(() => {
    const target = focusNext.current
    focusNext.current = undefined
    if (target === `undo`) undoButton.current?.focus()
    if (target === `clear`) clearButton.current?.focus()
    if (target === `first-box`) {
      document.getElementById(CHECKLIST_ROOT_ID)?.querySelector(`input`)?.focus()
    }
  })

  const clearTicks = () => {
    const ids = control.current?.clear() ?? []
    if (ids.length === 0) return
    setCleared(ids)
    setSpoken(t.t(`LaunchChecklist.cleared`))
    focusNext.current = `undo`
    undoTimer.current = setTimeout(() => {
      // Focus on the vanishing button would fall to the page's start; keep it in the list.
      if (document.activeElement === undoButton.current) focusNext.current = `first-box`
      setCleared([])
      // Emptied, so the next "Ticks cleared." is a change a screen reader announces again.
      setSpoken(``)
    }, UNDO_MS)
  }

  const undo = () => {
    const ids = cleared
    clearTimeout(undoTimer.current)
    setCleared([])
    focusNext.current = `clear`
    control.current?.restore(ids)
    setSpoken(t.t(`LaunchChecklist.restored`))
  }

  if (!state) {
    return (
      <div class={`${SUMMARY} min-h-44 lg:min-h-52 noscript:min-h-0`} data-e2e="checklist-summary">
        <p class="font-medium" data-e2e="checklist-count">
          {t.t(`LaunchChecklist.static`, { count: total, sections })}
        </p>
      </div>
    )
  }

  const all = state.checked === state.total
  return (
    <div class={SUMMARY} data-e2e="checklist-summary">
      <p class="font-medium" data-e2e="checklist-count">
        {t.t(`LaunchChecklist.progress`, { done: state.checked, count: state.total })}
      </p>
      <Progress
        value={state.checked}
        max={state.total}
        showValue={false}
        tone={all ? `success` : `primary`}
        ariaLabel={t.t(`LaunchChecklist.progressLabel`)}
      />
      {(state.checked === 0 || all) && (
        <p class={all ? `text-sm text-success` : `text-sm text-muted`} data-e2e="checklist-note">
          {t.t(all ? `LaunchChecklist.allChecked` : `LaunchChecklist.empty`, {
            count: state.total,
          })}
        </p>
      )}
      <p class="text-sm text-muted" data-e2e="checklist-storage">
        {t.t(state.storageOk ? `LaunchChecklist.storageOk` : `LaunchChecklist.storageBlocked`)}
      </p>
      {/* `min-h-8` is the height of Clear and Undo, so Clear and Undo appearing move nothing. */}
      <div class="flex min-h-8 flex-wrap items-center gap-x-3 print:hidden">
        {cleared.length > 0
          ? (
            <>
              <span class="text-sm text-muted">{t.t(`LaunchChecklist.cleared`)}</span>
              <button
                key="undo"
                ref={undoButton}
                type="button"
                class={buttonClasses(`ghost`, `md`, `h-8`)}
                onClick={undo}
                data-e2e="checklist-undo"
              >
                {t.t(`LaunchChecklist.undo`)}
              </button>
            </>
          )
          : state.checked > 0 && (
            <button
              key="clear"
              ref={clearButton}
              type="button"
              class={buttonClasses(`ghost`, `md`, `-ms-3 h-8`)}
              onClick={clearTicks}
              data-e2e="checklist-clear"
            >
              {t.t(`LaunchChecklist.clear`)}
            </button>
          )}
      </div>
      <p role="status" aria-live="polite" class="sr-only" data-e2e="checklist-live">{spoken}</p>
    </div>
  )
}

/**
 * The summary's box. Before the script runs it reserves about the height of a first visit's
 * summary (nothing checked yet; measured across the nine languages: 156-196 px on a phone, 176-260
 * px beside the list), so the list barely moves when the script fills it. Without a script it
 * reserves nothing.
 */
const SUMMARY = `flex flex-col gap-2`
