import type { Translator } from "@spy4x/platform/universal/i18n"
import type { PageCommand } from "@ui/search-palette.tsx"
import { englishText } from "@ui/message.ts"

/** The overview's commands in the palette, while the overview is open; labels are `app` keys. */
const OVERVIEW_COMMANDS = [
  { id: "overview-range", label: `Shortcuts.dateRange` },
  { id: "overview-customise", label: `Shortcuts.customise` },
] as const

/** The note page's command in the palette, while a note an editor can change is open. */
const NOTE_COMMANDS = [{ id: "note-attach", label: `AppShell.attachFiles` }] as const

/**
 * The open page's commands in the palette, if it has any: labelled in the translator's language,
 * and found by their English label too.
 */
export function pageCommands(
  t: Translator<string>,
  open: { overview: boolean; noteEditor: boolean },
): PageCommand[] | undefined {
  const commands = open.overview ? OVERVIEW_COMMANDS : open.noteEditor ? NOTE_COMMANDS : undefined
  return commands?.map((command) => ({
    id: command.id,
    label: t.t(command.label),
    aliases: [englishText(command.label)],
  }))
}
