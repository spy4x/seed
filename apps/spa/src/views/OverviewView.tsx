import { signal } from "@preact/signals"
import { useEffect, useMemo, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { type LayoutEntry, mergeLayout, setLayoutHidden } from "@spy4x/preact-ui/layout-customiser"
import { rangeForPreset } from "@spy4x/preact-ui/date-range"
import { rangeFromSearch, rangeToSearch } from "@spy4x/preact-ui/date-range-search"
import { canMutateNotes, type CountWidgetResult, GroupRole, groupTimeZone } from "@domain/groups"
import { freePlanAllowsNothing, needsFirstPlan } from "@domain/billing"
import { NOTE_WIDGET_IDS } from "@domain/notes"
import { OVERVIEW_DEFAULT_PRESET, OVERVIEW_PRESETS, OverviewScreen } from "@ui/overview-screen.tsx"
import { OVERVIEW_VIEWS, overviewWidgets } from "@ui/overview-widgets.ts"
import { GROUP_PATHS, OVERVIEW_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { useAppText } from "@ui/i18n.ts"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { isGuestSession } from "../state/guest.ts"
import { overviewStore } from "../state/overview.ts"
import { preferencesState } from "../state/preferences.ts"
import { selectionStore } from "../state/selection.ts"
import { toasts } from "../state/toasts.ts"
import { onboardingStore } from "../state/onboarding.ts"
import { notesOn } from "../modules.ts"
import { OnboardingView } from "./OnboardingView.tsx"

/** The page's own keys, `d` and `c`, while the overview is open; `null` on every other page. */
export const overviewPageActions = signal<{ openRange(): void; openCustomise(): void } | null>(
  null,
)

/** The `data-e2e` of the range picker's button, which `d` presses. */
const RANGE_E2E = "overview-range"

/** The message under the Customise list when a change did not reach the server, by its key. */
const SAVE_FAILED = `OverviewView.saveFailed`

/** `/overview`: the selected group's overview, once the selection is known. */
export function OverviewRedirect() {
  const [, navigate] = useLocation()
  const selected = selectionStore.groupId.value
  const loading = groupsStore.loading.value
  const t = useAppText()
  useEffect(() => {
    if (selected !== null) navigate(OVERVIEW_PATHS.group(selected), { replace: true })
    else if (!loading) navigate(SCREEN_PATHS.groups, { replace: true })
  }, [selected, loading])
  return <LoadingSpinner size="lg" label={t.t(`OverviewView.opening`)} class="min-h-[50vh]" />
}

/**
 * Wires `/overview/:groupId` to the overview store, the person's preferences (where the layout is
 * kept) and the address (where the range is kept). A person who is not a member sees "This group
 * does not exist." without a request, as on the other group pages. With the notes off it is where a
 * new account lands, so it draws the first steps under its header; `onboarding` is their store,
 * which tests replace.
 */
export function OverviewView(
  { groupId, onboarding = onboardingStore }: {
    groupId: string
    onboarding?: typeof onboardingStore
  },
) {
  const [location, navigate] = useLocation()
  const search = useSearch()
  const membership = groupsStore.groups.value.find((group) => group.id === groupId)
  const format = preferencesState.format.value
  // Days are cut in the group's zone, the same for every member. A list stored before
  // groups had a zone falls back to the person's own until the server's answer arrives.
  const timeZone = membership ? groupTimeZone(membership, format.timeZone) : format.timeZone
  const [customising, setCustomising] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const t = useAppText()
  // One clock per range read: a render a minute later must not move "Last 30 days" under the page.
  const now = useMemo(() => new Date(), [search, timeZone])
  const choice = rangeFromSearch(new URLSearchParams(search), {
    now,
    timeZone,
    defaultPreset: OVERVIEW_DEFAULT_PRESET,
    presets: OVERVIEW_PRESETS.map((option) => option.preset),
  })

  // With the notes off their widgets are not registered (`overviewWidgets`): none is asked for.
  const available = membership
    ? overviewWidgets(notesOn()).filter((widget) => widget.canView(membership.role))
    : []
  // With no widget at all the page has no range, no Customise and so no keys of its own.
  const hasWidgets = available.length > 0
  const layout = mergeLayout(
    preferencesState.value.value.overview,
    available.map((widget) => widget.id),
  )
  const shown = layout.flatMap((entry) =>
    entry.hidden ? [] : available.filter((widget) => widget.id === entry.id)
  )
  const shownKey = shown.map((widget) => widget.id).join(",")

  useEffect(() => {
    if (!membership) return
    overviewStore.open({ groupId, range: choice.range, timeZone }, shown)
  }, [groupId, membership?.role, choice.range.from, choice.range.to, timeZone, shownKey])

  // The owner of a new group under a free plan that allows nothing is told to choose a plan, as the
  // home page tells them on sign-in, and with the same exceptions (`landingPath`).
  const asksForPlan = membership?.role === GroupRole.OWNER && freePlanAllowsNothing() &&
    !isGuestSession() &&
    groupsStore.groups.value.every((group) => group.role === GroupRole.OWNER)
  useEffect(() => {
    if (asksForPlan) void billingStore.load(groupId)
  }, [asksForPlan, groupId, membership?.changeSequence])
  const billing = billingStore.current.value
  const choosePlan = asksForPlan && billing?.groupId === groupId && needsFirstPlan(billing.billing)

  useEffect(() => {
    if (!hasWidgets) return
    overviewPageActions.value = {
      openRange: () =>
        document.querySelector<HTMLButtonElement>(`[data-e2e="${RANGE_E2E}"]`)?.click(),
      openCustomise: () => setCustomising(true),
    }
    return () => overviewPageActions.value = null
  }, [hasWidgets])

  /** Saves `next` as the layout; a failure stays under the Customise list until the next save. */
  async function saveLayout(next: LayoutEntry[]): Promise<boolean> {
    const outcome = await preferencesState.save({ overview: next })
    setLayoutError(outcome.ok ? null : t.t(SAVE_FAILED))
    return outcome.ok
  }

  function offerUndo(id: string, title: string, before: LayoutEntry[]): void {
    toasts.info({
      id,
      body: title,
      duration: 8000,
      dataE2E: "overview-undo-toast",
      action: {
        label: t.t(`OverviewView.undo`),
        dataE2E: "overview-undo",
        onAction: () => void saveLayout(before),
      },
    })
  }

  async function hide(id: string): Promise<void> {
    const widget = available.find((candidate) => candidate.id === id)
    const title = widget ? t.t(widget.titleKey) : t.t(`OverviewView.widget`)
    const before = layout
    if (await saveLayout(setLayoutHidden(layout, id, true))) {
      offerUndo(`overview-hidden-${id}`, t.t(`OverviewView.hidden`, { widget: title }), before)
    } else {
      toasts.error({ body: t.t(SAVE_FAILED), dataE2E: "overview-save-failed" })
    }
  }

  async function reset(): Promise<void> {
    const before = layout
    if (await saveLayout([])) offerUndo("overview-reset", t.t(`OverviewView.restored`), before)
  }

  const loads = overviewStore.loads.value
  const total = loads[NOTE_WIDGET_IDS.total]
  // The count at the end of today is the group's notes now: none, and the page says so.
  const endsToday = choice.range.to === rangeForPreset("today", { now, timeZone }).to
  const totalNow = total?.status === "ready" && endsToday
    ? (total.data as CountWidgetResult).current
    : null
  const isSelected = selectionStore.groupId.value === groupId

  return (
    <OverviewScreen
      group={membership ? { id: membership.id, name: membership.name } : null}
      loading={groupsStore.loading.value}
      range={choice}
      timeZone={timeZone}
      viewerTimeZone={format.timeZone}
      now={now}
      onRangeChange={(next) => {
        const query = rangeToSearch(new URLSearchParams(search), next, OVERVIEW_DEFAULT_PRESET)
        const text = query.toString()
        navigate(`${location}${text ? `?${text}` : ""}`, { replace: true })
      }}
      widgets={shown.map((widget) => ({
        id: widget.id,
        titleKey: widget.titleKey,
        size: widget.size,
        load: loads[widget.id] ?? { status: "loading" },
      }))}
      views={OVERVIEW_VIEWS}
      onRetry={overviewStore.retry}
      onHide={(id) => void hide(id)}
      layout={layout.flatMap((entry) => {
        const widget = available.find((candidate) => candidate.id === entry.id)
        return widget ? [{ ...entry, titleKey: widget.titleKey }] : []
      })}
      customising={customising}
      onCustomise={() => setCustomising(true)}
      onCloseCustomise={() => setCustomising(false)}
      onLayoutChange={(next) => void saveLayout(next)}
      onResetLayout={() => void reset()}
      layoutError={layoutError}
      onCopyLink={() =>
        void navigator.clipboard.writeText(globalThis.location.href).then(
          () =>
            toasts.success({
              body: t.t(`OverviewView.linkCopied`),
              dataE2E: "overview-link-copied",
            }),
          () => {},
        )}
      emptyGroup={totalNow === 0 && membership
        ? { canCreate: isSelected && canMutateNotes(membership.role) && !choosePlan }
        : null}
      choosePlanHref={choosePlan ? GROUP_PATHS.billing(groupId) : null}
      rangeDataE2E={RANGE_E2E}
      navigate={navigate}
      intro={notesOn() ? null : <OnboardingView store={onboarding} />}
    />
  )
}
