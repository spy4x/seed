import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { languages } from "./i18n.ts"
import { createAdminToasts } from "./toasts.ts"

describe(`admin toasts`, () => {
  afterEach(async () => {
    await languages.use(`en`)
  })

  it(`title each toast in the language shown when it appears`, async () => {
    const toasts = createAdminToasts()
    toasts.success({ body: `Saved` })
    await languages.use(`ru`)
    toasts.success({ body: `Сохранено` })
    toasts.error({ body: `Не вышло` })
    expect(toasts.list.value.map((toast) => toast.title)).toEqual([`Success`, `Готово`, `Ошибка`])
  })
})
