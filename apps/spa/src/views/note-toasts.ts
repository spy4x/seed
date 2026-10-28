import type { Translator } from "@spy4x/platform/universal/i18n"

/**
 * The toast after a move: "The note was moved to Home." or "3 notes were moved to Home." Without
 * the group's name, it names "the other group".
 */
export function movedToast(
  t: Translator<string>,
  count: number,
  groupName: string | undefined,
): { title: string; body: string } {
  return {
    title: t.t(`NoteToasts.movedTitle`, { count }),
    body: groupName === undefined
      ? t.t(`NoteToasts.movedElsewhere`, { count })
      : t.t(`NoteToasts.moved`, { count, group: groupName }),
  }
}
