import { type Context, Hono, type MiddlewareHandler } from "hono"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { ShownPicture } from "@server/auth/profile-pictures.ts"
import type { FileStore } from "@server/files/files.ts"
import type { APIContext } from "../_types.ts"
import { errorResponse } from "../services/error-response.ts"
import type { SignIn } from "@api/services/sign-in.ts"

/** The answer for a picture the viewer may not see, and for one that is not there. */
export const PICTURE_NOT_FOUND = `Picture not found`

/**
 * How long a browser may keep the redirect: less than the signed URL's five minutes, so a kept
 * redirect never points at an expired one. A new picture has a new id, so nothing stale shows.
 */
export const PICTURE_REDIRECT_SECONDS = 240

/**
 * Answers a 302 to a five-minute signed URL of `picture`, served as its type, or 404.
 * The page's `<img>` names the stable `/…/pictures/<id>` path, so a list kept offline or for hours
 * never holds an expired URL.
 */
export async function pictureRedirect(
  c: Context<APIContext>,
  picture: ShownPicture | null,
  signDownload: FileStore[`signDownload`],
): Promise<Response> {
  if (!picture) return errorResponse(c, `not_found`, { message: PICTURE_NOT_FOUND })
  const url = await signDownload(picture.objectKey, {
    contentType: picture.contentType,
    filename: `picture`,
  })
  c.header(`Cache-Control`, `private, max-age=${PICTURE_REDIRECT_SECONDS}`)
  return c.redirect(url, 302)
}

/**
 * The picture's bytes as the store keeps them, for a host whose page may not load the store's: its
 * confirmed type, `nosniff` and the sandbox policy the store's own answers carry, so it never runs
 * as a page. Its id changes with every new picture, so a browser may keep it for a day.
 */
export function pictureBody(picture: ShownPicture, bytes: Uint8Array): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "content-type": picture.contentType,
      "x-content-type-options": `nosniff`,
      "content-security-policy": `sandbox; default-src 'none'`,
      "cache-control": `private, max-age=86400`,
    },
  })
}

export interface PictureRouteDependencies {
  auth: Pick<SignIn[`auth`], `isAuthenticated2FA`>
  limit: MiddlewareHandler<APIContext>
  /** The picture, when the viewer may see it: their own, or a member's of a group they share. */
  readable(pictureId: string, viewerId: number): Promise<ShownPicture | null>
  signDownload: FileStore[`signDownload`]
}

/**
 * Profile pictures (#228), mounted at `/api/pictures`. `GET /:pictureId` answers a redirect to the
 * picture for a signed-in person who may see it, and 404 for anyone else and for no such picture,
 * so the answer never tells whether one exists.
 */
export function createPictureRoute(dependencies: PictureRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .use(dependencies.auth.isAuthenticated2FA)
    .use(dependencies.limit)
    .get(`/:pictureId`, async (c) => {
      const pictureId = c.req.param(`pictureId`)
      const picture = isUuid(pictureId)
        ? await dependencies.readable(pictureId, c.get(`auth`)!.user.id)
        : null
      return await pictureRedirect(c, picture, dependencies.signDownload)
    })
}
