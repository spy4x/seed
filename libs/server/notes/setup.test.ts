import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { NOTES_OFF, NOTES_ON, readNotesSetup } from "./setup.ts"

/** An environment holding `values` only. */
const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

it(`keeps the notes on while NOTES is unset, empty or anything but false`, () => {
  expect(readNotesSetup(env({}))).toEqual(NOTES_ON)
  expect(readNotesSetup(env({ NOTES: `` }))).toEqual(NOTES_ON)
  expect(readNotesSetup(env({ NOTES: `true` }))).toEqual(NOTES_ON)
  expect(readNotesSetup(env({ NOTES: `0` }))).toEqual(NOTES_ON)
})

it(`turns the notes off with NOTES=false, spaces around it allowed`, () => {
  expect(readNotesSetup(env({ NOTES: `false` }))).toEqual(NOTES_OFF)
  expect(readNotesSetup(env({ NOTES: ` false ` }))).toEqual(NOTES_OFF)
})
