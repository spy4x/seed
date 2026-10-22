import type { QueryHandler } from "@spy4x/platform/cqrs"
import type {
  NoteAddedWidgetQuery,
  NoteSeriesWidgetQuery,
  NoteTotalWidgetQuery,
} from "@domain/notes"
import {
  createNoteAddedWidgetHandler,
  createNoteSeriesWidgetHandler,
  createNoteTotalWidgetHandler,
} from "../../features/notes/widgets.ts"
import { noteWidgetDependencies } from "../note-dependencies.ts"

export const noteTotalWidgetHandler: QueryHandler<NoteTotalWidgetQuery> =
  createNoteTotalWidgetHandler(noteWidgetDependencies)
export const noteAddedWidgetHandler: QueryHandler<NoteAddedWidgetQuery> =
  createNoteAddedWidgetHandler(noteWidgetDependencies)
export const noteSeriesWidgetHandler: QueryHandler<NoteSeriesWidgetQuery> =
  createNoteSeriesWidgetHandler(noteWidgetDependencies)
