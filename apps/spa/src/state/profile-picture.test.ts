import { createTranslator } from "@spy4x/platform/universal/i18n"
import appEn from "@i18n/app/en.json" with { type: "json" }
import { type Said, say } from "@ui/app-text.ts"
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { User } from "@domain/identity"
import { createPictureStore, type PictureDependencies } from "./profile-picture.ts"

const EN = createTranslator({ language: "en", catalogs: [{ source: appEn }] })
/** What the person reads, in English, for a message the store keeps as a key. */
const read = (said: Said | null) => said && say(EN, said)

const PICTURE = `0199c3a0-0000-7000-8000-0000000000a1`
const file = (name = `photo.jpg`, type = `image/jpeg`, size = 1000) =>
  new File([new Uint8Array(size)], name, { type })

/** The store over fakes that record every call; `overrides` replace one dependency. */
function setUp(overrides: Partial<PictureDependencies> = {}) {
  const calls: string[] = []
  const users: User[] = []
  const dependencies: PictureDependencies = {
    sign: (input) => {
      calls.push(`sign ${input.contentType} ${input.size}`)
      return Promise.resolve({
        id: PICTURE,
        url: `https://store.test/put`,
        headers: { "content-type": input.contentType },
      })
    },
    put: () => {
      calls.push(`put`)
      return Promise.resolve()
    },
    confirm: ({ id }) => {
      calls.push(`confirm ${id}`)
      return Promise.resolve({ user: { id: 7, pictureId: id } as unknown as User })
    },
    cancel: ({ id }) => {
      calls.push(`cancel ${id}`)
      return Promise.resolve({ id })
    },
    remove: () => {
      calls.push(`remove`)
      return Promise.resolve({ user: { id: 7, pictureId: null } as unknown as User })
    },
    online: () => true,
    preview: () => `blob:preview`,
    release: (url) => calls.push(`release ${url}`),
    setUser: (user) => users.push(user),
    ...overrides,
  }
  return { store: createPictureStore(dependencies), calls, users }
}

describe(`profile picture store`, () => {
  it(`shows the chosen image while it uploads, then saves the person and says so`, async () => {
    const { store, calls, users } = setUp()
    const upload = store.choose(file())
    expect(store.status.value).toBe(`uploading`)
    expect(store.preview.value).toBe(`blob:preview`)
    await upload

    expect(calls).toEqual([
      `sign image/jpeg 1000`,
      `put`,
      `confirm ${PICTURE}`,
      `release blob:preview`,
    ])
    expect(users.map((user) => user.pictureId)).toEqual([PICTURE])
    expect(read(store.announcement.value)).toBe(`Profile picture saved.`)
    expect([store.status.value, store.preview.value, store.error.value]).toEqual([
      `idle`,
      null,
      null,
    ])
  })

  it(`signs a HEIC photo the browser gave no type as HEIC`, async () => {
    const { store, calls } = setUp()
    await store.choose(file(`IMG_0001.HEIC`, ``))
    expect(calls[0]).toBe(`sign image/heic 1000`)
  })

  it(`names a file whose bytes are not an image, and cancels its signed upload`, async () => {
    const { store, calls, users } = setUp({
      confirm: () =>
        Promise.reject(new RealtimeRequestError(`bad_request`, `no`, { code: `FILE_CONTENT` })),
    })
    await store.choose(file())

    expect(read(store.error.value)).toBe(
      `\u2068photo.jpg\u2069 is not really an image, so it was not used. Choose another file.`,
    )
    expect(calls).toContain(`cancel ${PICTURE}`)
    expect(users).toEqual([])
  })

  it(`asks to check the connection when the PUT fails, and cancels the signed upload`, async () => {
    const { store, calls } = setUp({ put: () => Promise.reject(new TypeError(`failed`)) })
    await store.choose(file())

    expect(read(store.error.value)).toBe(
      `Could not upload your picture. Check your connection and try again.`,
    )
    expect(calls).toContain(`cancel ${PICTURE}`)
    expect(store.preview.value).toBe(null)
  })

  it(`refuses to start offline, before anything is signed`, async () => {
    const { store, calls } = setUp({ online: () => false })
    await store.choose(file())

    expect(read(store.error.value)).toBe(
      `You are offline. Upload your picture once you are back online.`,
    )
    expect(calls).toEqual([])
  })

  it(`names the file and the rule when the browser refuses it`, () => {
    const { store } = setUp()
    store.reject({ file: file(`photo.gif`, `image/gif`), reason: `wrong-type` })
    expect(read(store.error.value)).toBe(
      `\u2068photo.gif\u2069 is not a JPEG, PNG, WebP or HEIC image. Choose one of those.`,
    )
    store.reject({ file: file(`photo.jpg`, `image/jpeg`, 12.4 * 1024 * 1024), reason: `too-large` })
    expect(read(store.error.value)).toBe(
      `\u2068photo.jpg\u2069 is 12.4 MB. Choose an image of 10 MB or less.`,
    )
  })

  it(`removes the picture and says so, or says the removal failed`, async () => {
    const removed = setUp()
    await removed.store.remove()
    expect(removed.users.map((user) => user.pictureId)).toEqual([null])
    expect(read(removed.store.announcement.value)).toBe(`Profile picture removed.`)

    const failed = setUp({ remove: () => Promise.reject(new TypeError(`failed`)) })
    await failed.store.remove()
    expect(read(failed.store.error.value)).toBe(
      `Could not remove your picture. Check your connection and try again.`,
    )
    expect(failed.users).toEqual([])
  })
})
