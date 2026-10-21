/** The toast after a move: "The note was moved to Home." or "3 notes were moved to Home." */
export function movedToast(count: number, groupName: string): { title: string; body: string } {
  return count === 1
    ? { title: "Note moved", body: `The note was moved to ${groupName}.` }
    : { title: "Notes moved", body: `${count} notes were moved to ${groupName}.` }
}
