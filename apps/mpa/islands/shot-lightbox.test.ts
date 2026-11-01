import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { shotSrcset } from "../components/shot.tsx"
import { widestSrc } from "./shot-lightbox.tsx"

/** A `<picture>`'s image as the browser has it: the dark `<source>` beside the light `<img>`. */
function pictureImage(name: string): HTMLImageElement {
  const source = { srcset: shotSrcset(name, `dark`, `desktop`) }
  const image = {
    srcset: shotSrcset(name, `light`, `desktop`),
    parentElement: { querySelector: () => source },
  }
  return image as unknown as HTMLImageElement
}

describe(`widestSrc`, () => {
  it(`opens the widest file of the theme the page shows`, () => {
    expect(widestSrc(pictureImage(`notes`), false)).toBe(`/shots/notes-light-1280.webp`)
    expect(widestSrc(pictureImage(`notes`), true)).toBe(`/shots/notes-dark-1280.webp`)
  })

  it(`falls back to the image's own files when the picture has no dark source`, () => {
    const image = { srcset: `/a-800.webp 800w, /a-400.webp 400w`, parentElement: null }
    expect(widestSrc(image as unknown as HTMLImageElement, true)).toBe(`/a-800.webp`)
  })

  it(`leaves an image without a srcset alone`, () => {
    const image = { srcset: ``, parentElement: null }
    expect(widestSrc(image as unknown as HTMLImageElement, false)).toBeUndefined()
  })
})
