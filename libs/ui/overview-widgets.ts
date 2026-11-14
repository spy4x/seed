import type { WidgetDefinition } from "@domain/groups"
import { NOTE_WIDGET_IDS, NOTE_WIDGETS } from "@domain/notes"
import { NOTE_WIDGET_VIEWS, type WidgetView } from "./note-widgets.tsx"

/**
 * Every widget the group overview can show, in the default order: each aggregate's list, one after
 * the other. A new aggregate adds its list here and its drawings to {@link OVERVIEW_VIEWS}
 * (`docs/aggregate-extras.md`, "Add a widget to the overview").
 */
export const OVERVIEW_WIDGETS: readonly WidgetDefinition[] = [...NOTE_WIDGETS]

/** How each widget of {@link OVERVIEW_WIDGETS} is drawn, by id. */
export const OVERVIEW_VIEWS: Readonly<Record<string, WidgetView>> = { ...NOTE_WIDGET_VIEWS }

const NOTE_IDS: ReadonlySet<string> = new Set(Object.values(NOTE_WIDGET_IDS))

/**
 * The widgets of {@link OVERVIEW_WIDGETS} a product registers: with the notes off
 * (`SPA_NOTES=false`), none of the notes' widgets, so none is drawn or asked for.
 */
export function overviewWidgets(notes = true): readonly WidgetDefinition[] {
  return notes ? OVERVIEW_WIDGETS : OVERVIEW_WIDGETS.filter((widget) => !NOTE_IDS.has(widget.id))
}
