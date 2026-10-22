import type { WidgetDefinition } from "@domain/groups"
import { NOTE_WIDGETS } from "@domain/notes"
import { NOTE_WIDGET_VIEWS, type WidgetView } from "./note-widgets.tsx"

/**
 * Every widget the group overview can show, in the default order: each aggregate's list, one after
 * the other. A new aggregate adds its list here and its drawings to {@link OVERVIEW_VIEWS}
 * (`docs/aggregates.md`, "Adding a widget to the overview").
 */
export const OVERVIEW_WIDGETS: readonly WidgetDefinition[] = [...NOTE_WIDGETS]

/** How each widget of {@link OVERVIEW_WIDGETS} is drawn, by id. */
export const OVERVIEW_VIEWS: Readonly<Record<string, WidgetView>> = { ...NOTE_WIDGET_VIEWS }
