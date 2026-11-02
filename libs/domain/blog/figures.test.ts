import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { blogFigureIds, checkBlogFigure, closestName } from "./figures.ts"

const FIGURES = new Map([
  // A default, so the schema's output differs from what the post wrote.
  [`CostCalculator`, { props: type({ members: `number.integer = 4`, "+": `reject` }) }],
  [`Chart`, { props: type({ year: `number` }) }],
])

describe(`checkBlogFigure`, () => {
  it(`gives a known tag the props its schema returns`, () => {
    const check = checkBlogFigure(
      { tag: `CostCalculator`, props: {}, line: 3 },
      FIGURES,
    )

    expect(check).toEqual({ ok: true, props: { members: 4 } })
  })

  it(`refuses an unknown tag with its line, the closest name and every name`, () => {
    const check = checkBlogFigure({ tag: `CostCalc`, props: {}, line: 14 }, FIGURES)

    expect(check).toEqual({
      ok: false,
      problem: {
        line: 14,
        code: `unknown`,
        tag: `CostCalc`,
        detail: ``,
        suggestion: `CostCalculator`,
        names: [`Chart`, `CostCalculator`],
      },
    })
  })

  it(`refuses props the schema rejects, with the schema's reason`, () => {
    const check = checkBlogFigure(
      { tag: `CostCalculator`, props: { members: 4, users: 9 }, line: 5 },
      FIGURES,
    )

    expect(check.ok).toBe(false)
    expect(!check.ok && check.problem).toMatchObject({
      line: 5,
      code: `props`,
      tag: `CostCalculator`,
    })
    expect(!check.ok && check.problem.detail).toContain(`users`)
  })

  it(`never resolves a name that only an object's prototype has`, () => {
    const check = checkBlogFigure({ tag: `constructor`, props: {}, line: 1 }, FIGURES)

    expect(check.ok).toBe(false)
  })
})

describe(`closestName`, () => {
  const names = [`Chart`, `CostCalculator`, `Timeline`]

  it(`suggests the name a shortened tag starts`, () => {
    expect(closestName(`CostCalc`, names)).toBe(`CostCalculator`)
  })

  it(`suggests a name two letters away or written in another case`, () => {
    expect(closestName(`Timelien`, names)).toBe(`Timeline`)
    expect(closestName(`chart`, names)).toBe(`Chart`)
  })

  it(`suggests nothing when no name is close`, () => {
    expect(closestName(`Quiz`, names)).toBeUndefined()
  })
})

describe(`blogFigureIds`, () => {
  it(`names each figure after its tag in kebab case, numbered on repeat`, () => {
    expect(blogFigureIds([`CostCalculator`, `Chart`, `CostCalculator`, `CostCalculator`])).toEqual([
      `cost-calculator`,
      `chart`,
      `cost-calculator-2`,
      `cost-calculator-3`,
    ])
  })

  it(`skips an id a heading already has`, () => {
    expect(blogFigureIds([`Chart`, `Chart`], [`chart`])).toEqual([`chart-2`, `chart-3`])
  })
})
