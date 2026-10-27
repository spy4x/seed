/**
 * The Account section's "Profile picture" row (#228) driven in a browser DOM (happy-dom): which
 * buttons it offers, the removal's confirmation, what it announces and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  PICTURE_BUTTON_ID,
  PictureErrorState,
  PictureRow,
  type PictureRowProps,
} from "./profile-picture.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  // Preact draws into `document`; a dialog reads the page's style to lock its scroll.
  Object.assign(globalThis, {
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<HTMLElement> {
  root ??= document.body.appendChild(document.createElement("div"))
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** The row's props: no picture, nothing running; `overrides` change any of them. */
function row(overrides: Partial<PictureRowProps> = {}): PictureRowProps {
  return {
    name: "Ada Lovelace",
    hasPicture: false,
    status: "idle",
    error: null,
    announcement: "",
    onChoose: () => {},
    onReject: () => {},
    onRemove: () => {},
    ...overrides,
  }
}

const chooser = () => find<HTMLButtonElement>(`#${PICTURE_BUTTON_ID}`)
const removeCount = () => document.querySelectorAll("[data-e2e=profile-picture-remove]").length

describe("profile picture row", () => {
  it("offers Upload and no Remove while there is no picture, and the file's rule", async () => {
    await mount(<PictureRow {...row()} />)
    expect(chooser().textContent).toBe("Upload profile picture")
    expect(removeCount()).toBe(0)
    expect(find("[data-e2e=profile-picture-row]").textContent).toContain(
      "JPEG, PNG, WebP or HEIC, up to 10 MB.",
    )
  })

  it("says the new picture is being prepared, visibly and in its status region", async () => {
    await mount(<PictureRow {...row({ hasPicture: true, state: "preparing" })} />)
    const status = find("[data-e2e=profile-picture-status]")
    expect(status.getAttribute("role")).toBe("status")
    expect(status.textContent).toBe("Preparing your picture…")
    expect(status.className).not.toContain("sr-only")
  })

  it("says a refused picture could not be used, visibly and in its status region", async () => {
    await mount(<PictureRow {...row({ hasPicture: true, state: "refused" })} />)
    const status = find("[data-e2e=profile-picture-status]")
    expect(status.textContent).toBe("We could not use that picture. Choose another.")
    expect(status.className).not.toContain("sr-only")
  })

  it("offers HEIC by its extension too, for a browser that gives it no type", async () => {
    await mount(<PictureRow {...row()} />)
    const input = find<HTMLInputElement>(`input[type=file]`)
    expect(input.accept.split(",")).toEqual(expect.arrayContaining([".heic", ".heif"]))
  })

  it("offers Change and Remove once a picture is saved, and hides Remove while one uploads", async () => {
    await mount(<PictureRow {...row({ hasPicture: true, src: "/api/pictures/x" })} />)
    expect(chooser().textContent).toBe("Change profile picture")
    expect(find("[data-e2e=profile-picture-remove]").textContent).toBe("Remove profile picture")

    await mount(<PictureRow {...row({ hasPicture: true, status: "uploading" })} />)
    expect(removeCount()).toBe(0)
  })

  it("removes only after the person confirms, and not when they cancel", async () => {
    let removed = 0
    await mount(<PictureRow {...row({ hasPicture: true, onRemove: () => removed++ })} />)

    await click("[data-e2e=profile-picture-remove]")
    const dialog = find("[data-e2e=profile-picture-remove-dialog]")
    expect(dialog.textContent).toContain("Remove your profile picture?")
    expect(dialog.textContent).toContain("Your initials show instead, here and in every group.")
    await click("[data-e2e=profile-picture-remove-dialog] [data-e2e=confirm-dialog-cancel]")
    expect(removed).toBe(0)

    await click("[data-e2e=profile-picture-remove]")
    await click("[data-e2e=profile-picture-remove-dialog] [data-e2e=confirm-dialog-confirm]")
    expect(removed).toBe(1)
    expect(document.querySelectorAll("[data-e2e=profile-picture-remove-dialog]").length).toBe(0)
  })

  it("moves focus to Upload when Remove leaves with the picture", async () => {
    await mount(<PictureRow {...row({ hasPicture: true })} />)
    find<HTMLButtonElement>("[data-e2e=profile-picture-remove]").focus()
    await mount(<PictureRow {...row({ hasPicture: false })} />)
    expect(document.activeElement?.id).toBe(PICTURE_BUTTON_ID)
    expect(chooser().textContent).toBe("Upload profile picture")
  })

  it("reads out what happened through its status region", async () => {
    await mount(<PictureRow {...row({ announcement: "Profile picture saved." })} />)
    const status = find("[data-e2e=profile-picture-status]")
    expect(status.getAttribute("role")).toBe("status")
    expect(status.textContent).toBe("Profile picture saved.")
  })

  it("moves focus to a refusal when it appears", async () => {
    await mount(<PictureErrorState error={null} />)
    await mount(<PictureErrorState error="photo.gif is not a JPEG, PNG, WebP or HEIC image." />)
    const error = find("[data-e2e=profile-picture-error]")
    expect(error.textContent).toContain("photo.gif is not a JPEG, PNG, WebP or HEIC image.")
    expect(error.contains(document.activeElement)).toBe(true)
  })
})
