import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createFormatters } from "@spy4x/time/format"
import { createOperatorFormat, OWN_PREFERENCES_PATH } from "./preferences.ts"
import type { AdminApiResult, AdminFetch } from "./state.ts"

const AT = Date.UTC(2026, 9, 17, 12, 5)
const tokyo = {
  version: 2,
  value: {
    theme: `dark`,
    language: `ar`,
    locale: `en-GB`,
    timeZone: `Asia/Tokyo`,
    hourCycle: `h23`,
  },
}

/** An API that answers the operator's own preferences with `answer`, and records each path. */
function api(answer: () => Promise<unknown>) {
  const paths: string[] = []
  const request = ((path: string) => {
    paths.push(path)
    return answer()
  }) as AdminFetch
  return { paths, request }
}

const ok = (data: unknown) =>
  Promise.resolve({ ok: true, status: 200, data } as AdminApiResult<unknown>)

it(`writes every date in the operator's own zone once their preferences load`, async () => {
  const { paths, request } = api(() => ok(tokyo))
  const own = createOperatorFormat(request)

  await own.load()

  expect(paths).toEqual([OWN_PREFERENCES_PATH])
  expect(own.format.value.timeZone).toBe(`Asia/Tokyo`)
  expect(own.format.value.time(AT)).toBe(`21:05`)
})

it(`keeps the device's format when the read fails, and goes back to it on sign-out`, async () => {
  const device = createFormatters().timeZone
  const failing = createOperatorFormat(api(() => Promise.reject(new Error(`offline`))).request)
  await failing.load()
  expect(failing.format.value.timeZone).toBe(device)

  const own = createOperatorFormat(api(() => ok(tokyo)).request)
  await own.load()
  own.reset()
  expect(own.format.value.timeZone).toBe(device)
})

it(`drops an answer that arrives after the operator signed out`, async () => {
  let answer: (value: unknown) => void = () => {}
  const own = createOperatorFormat(
    api(() => new Promise((resolve) => (answer = resolve))).request,
  )
  const loading = own.load()
  own.reset()
  answer({ ok: true, status: 200, data: tokyo })
  await loading

  expect(own.format.value.timeZone).toBe(createFormatters().timeZone)
})

it(`takes the operator's chosen language with their preferences, and forgets it on sign-out`, async () => {
  const own = createOperatorFormat(api(() => ok(tokyo)).request)
  expect(own.language.value).toBeNull()
  await own.load()
  expect(own.language.value).toBe(`ar`)
  own.reset()
  expect(own.language.value).toBeNull()
})

it(`takes no language from a record off the schema`, async () => {
  const own = createOperatorFormat(
    api(() => ok({ version: 2, value: { ...tokyo.value, language: `../x` } })).request,
  )
  await own.load()
  expect(own.language.value).toBeNull()
})
