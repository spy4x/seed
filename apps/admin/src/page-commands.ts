/**
 * The open page's own commands, which the shell's palette lists under "This page". A view hands
 * them over with {@link usePageCommands}; they leave with the view, so no command outlives its
 * page.
 *
 * @module
 */
import { useEffect, useRef } from "preact/hooks"
import { signal } from "@preact/signals"
import type { AdminPageCommand } from "@ui/admin-palette.tsx"

/** The commands the open view handed over; none while it has none. */
export const pageCommands = signal<readonly AdminPageCommand[]>([])

/**
 * Hands `commands` to the palette while the calling view is shown, and takes them back when it
 * goes. They are handed over again only when their ids or labels change, and each runs the
 * latest render's handler.
 */
export function usePageCommands(commands: readonly AdminPageCommand[]): void {
  const latest = useRef(commands)
  latest.current = commands
  const key = commands.map((command) => `${command.id}\t${command.label}`).join(`\n`)
  useEffect(() => {
    const shown = latest.current.map((command) => ({
      ...command,
      run: () => latest.current.find((next) => next.id === command.id)?.run(),
    }))
    pageCommands.value = shown
    return () => {
      if (pageCommands.value === shown) pageCommands.value = []
    }
  }, [key])
}
