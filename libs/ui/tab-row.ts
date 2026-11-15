/**
 * `Tabs` props for a row that scrolls sideways instead of wrapping, for a screen with many tabs:
 * spread them into `Tabs`. The bottom padding keeps the selected tab's underline inside the scroll
 * box. The scroll box would also cut off a focus ring drawn outside the tab, so a focused tab draws
 * its ring inside its own edge instead.
 */
export const SCROLLING_TABS = {
  listClass: `flex-nowrap overflow-x-auto pb-px`,
  tabClass: `focus-visible:ring-inset focus-visible:ring-offset-0`,
} as const
