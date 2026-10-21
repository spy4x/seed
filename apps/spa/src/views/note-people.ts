/** A member as the notes screens need them: the members store's rows fit. */
export interface NotePerson {
  userId: number
  name: string
}

/**
 * How the notes screens name the member with `userId`: "You" for the person themselves, the
 * member's name, or "Former member" for an account that is gone or no longer in the group.
 * `undefined` while the members are not read yet (`members` is `null`), so a screen shows no name
 * rather than a wrong one.
 *
 * @param userId The note's `createdByUserId` or `updatedByUserId`; `null` once the account is gone.
 * @param youId The signed-in person's id, or `null` when it is not known.
 * @param members The group's members, or `null` until they are read.
 */
export function personName(
  userId: number | null,
  youId: number | null,
  members: readonly NotePerson[] | null,
): string | undefined {
  if (userId !== null && userId === youId) return "You"
  if (members === null) return undefined
  return members.find((member) => member.userId === userId)?.name ?? "Former member"
}
