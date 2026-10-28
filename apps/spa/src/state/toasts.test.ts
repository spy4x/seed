import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { languages } from "../i18n.ts"
import { toasts } from "./toasts.ts"

describe(`the app's toasts`, () => {
  afterEach(async () => {
    toasts.clear()
    await languages.use(`en`)
  })

  it(`title each toast in the language shown when it appears`, async () => {
    toasts.success({ body: `Saved` })
    await languages.use(`de`)
    toasts.success({ body: `Gespeichert` })
    toasts.error({ body: `Fehlgeschlagen` })
    expect(toasts.list.value.map((toast) => toast.title)).toEqual([`Success`, `Erledigt`, `Fehler`])
  })
})
