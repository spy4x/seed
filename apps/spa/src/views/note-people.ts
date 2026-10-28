import type { Translator } from "@spy4x/platform/universal/i18n"
import { type PictureState, pictureUrl, shownPictureId } from "@domain/identity"

/** A member as the notes screens need them: the members store's rows fit. */
export interface NotePerson {
  userId: number
  name: string
  pictureId?: string | null
}

/**
 * The address of the profile picture of the member with `userId`, or `undefined` for initials.
 * The person's own comes from `you`, their session, which follows their picture as soon as it is
 * ready (#464); the members list is read again only on the group's changes.
 */
export function personPicture(
  userId: number | null,
  members: readonly NotePerson[] | null,
  you?: { id: number; pictureId?: string | null; pictureState?: PictureState | null } | null,
): string | undefined {
  if (you && userId === you.id) return pictureUrl(shownPictureId(you))
  return pictureUrl(members?.find((member) => member.userId === userId)?.pictureId)
}

/**
 * How the notes screens name the member with `userId`: "You" for the person themselves, the
 * member's name ("Unnamed member" when they set none), or "Former member" for an account that is
 * gone or no longer in the group.
 * `undefined` while the members are not read yet (`members` is `null`), so a screen shows no name
 * rather than a wrong one.
 *
 * @param t The words, in the person's language.
 * @param userId The note's `createdByUserId` or `updatedByUserId`; `null` once the account is gone.
 * @param youId The signed-in person's id, or `null` when it is not known.
 * @param members The group's members, or `null` until they are read.
 */
export function personName(
  t: Translator<string>,
  userId: number | null,
  youId: number | null,
  members: readonly NotePerson[] | null,
): string | undefined {
  if (userId !== null && userId === youId) return t.t(`NotePeople.you`)
  if (members === null) return undefined
  const member = members.find((candidate) => candidate.userId === userId)
  if (!member) return t.t(`NotePeople.former`)
  // The same words as the group's members list for a member who set no name.
  return member.name.trim() || t.t(`NotePeople.unnamed`)
}
