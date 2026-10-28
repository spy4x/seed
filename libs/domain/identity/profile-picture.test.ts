/** The picture rules both the SPA and the API share (#228, #464). */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { pictureContentType, PictureState, shownPictureId } from "./profile-picture.ts"

describe("pictureContentType", () => {
  it("keeps a type the picture rules know", () => {
    expect(pictureContentType({ name: `cat.png`, type: `image/png` })).toBe(`image/png`)
    expect(pictureContentType({ name: `cat.HEIC`, type: `image/heic` })).toBe(`image/heic`)
  })

  it("sends a .heic or .heif file a browser gave no type, or image/heif, as HEIC", () => {
    expect(pictureContentType({ name: `IMG_0001.HEIC`, type: `` })).toBe(`image/heic`)
    expect(pictureContentType({ name: `photo.heif`, type: `image/heif` })).toBe(`image/heic`)
  })

  it("leaves any other file's type alone, so the API refuses it", () => {
    expect(pictureContentType({ name: `cat.gif`, type: `image/gif` })).toBe(`image/gif`)
    expect(pictureContentType({ name: `notes`, type: `` })).toBe(``)
  })
})

describe("shownPictureId", () => {
  it("shows a ready picture, and one kept before pictures had a state", () => {
    expect(shownPictureId({ pictureId: `p`, pictureState: PictureState.Ready })).toBe(`p`)
    expect(shownPictureId({ pictureId: `p` })).toBe(`p`)
  })

  it("shows nothing while the picture is prepared, once it was refused, or with none", () => {
    expect(shownPictureId({ pictureId: `p`, pictureState: PictureState.Preparing })).toBeNull()
    expect(shownPictureId({ pictureId: `p`, pictureState: PictureState.Refused })).toBeNull()
    expect(shownPictureId({ pictureId: null })).toBeNull()
    expect(shownPictureId(null)).toBeNull()
  })
})
