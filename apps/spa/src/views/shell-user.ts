import { pictureUrl, shownPictureId } from "@domain/identity"
import type { FrameUser } from "@ui/frame.tsx"
import type { SessionUser } from "../state/session.ts"

/**
 * The signed-in person as the shell's account menu shows them. The avatar is the picture only once
 * it is ready: a picture still being prepared, or one the worker refused, shows the initials.
 */
export function shellUser(
  user: Pick<SessionUser, "firstName" | "lastName" | "pictureId" | "pictureState">,
  guest: boolean,
  email: string | null | undefined,
): FrameUser {
  return {
    // With no name and no address the menu would read "User"; a guest is named for what it is.
    firstName: guest && !user.firstName && !user.lastName ? `Guest` : user.firstName,
    lastName: user.lastName,
    email,
    avatarUrl: pictureUrl(shownPictureId(user)),
  }
}
