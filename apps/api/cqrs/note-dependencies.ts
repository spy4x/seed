import type { NoteHandlerDependencies } from "../features/notes/handlers.ts"
import type { NoteWidgetHandlerDependencies } from "../features/notes/widgets.ts"
import { db } from "../services/db.ts"

/**
 * What the note handlers run on: the notes table, and the actor's role read from the group's
 * membership in Postgres (never from a cache, since it decides who may write).
 */
export const noteDependencies: NoteHandlerDependencies = {
  notes: db.note,
  groups: {
    roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
  },
}

/** What the note widget handlers run on: the same role lookup, and the widgets' numbers. */
export const noteWidgetDependencies: NoteWidgetHandlerDependencies = {
  overview: db.noteOverview,
  groups: noteDependencies.groups,
}
