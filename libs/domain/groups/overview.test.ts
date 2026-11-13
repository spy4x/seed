import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { canRead } from "./+lib.ts"
import { operatorWidgets, type WidgetDefinition } from "./overview.ts"

const widget = (id: string, operatorView: WidgetDefinition["operatorView"]): WidgetDefinition => ({
  id,
  titleKey: `Test.title`,
  size: `stat`,
  canView: canRead,
  operation: `test.widget`,
  operatorView,
})

it(`gives the operator only the counts widgets, in their order`, () => {
  const widgets = [widget(`a`, `counts`), widget(`b`, `never`), widget(`c`, `counts`)]
  expect(operatorWidgets(widgets).map((shown) => shown.id)).toEqual([`a`, `c`])
})

it(`refuses, in the type check, a widget definition that does not say what the operator sees`, () => {
  // `deno task ts:check` fails on this file when `operatorView` stops being required: the
  // directive below then has no error to expect.
  // @ts-expect-error operatorView is required
  const missing: WidgetDefinition = {
    id: `x`,
    titleKey: `Test.title`,
    size: `stat`,
    canView: canRead,
    operation: `test.widget`,
  }
  expect(missing.operatorView).toBe(undefined)
})
