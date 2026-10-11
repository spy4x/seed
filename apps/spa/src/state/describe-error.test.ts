import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { describeError } from "./describe-error.ts"

describe("describeError", () => {
  it("tells the server's message when the server answered", () => {
    const error = new RealtimeRequestError("conflict", "That name is taken")

    expect(describeError(error, "Could not save")).toBe("That name is taken")
  })

  it("falls back for an error that is not a server answer", () => {
    expect(describeError(new Error("socket closed"), "Could not save")).toBe("Could not save")
    expect(describeError("boom", "Could not save")).toBe("Could not save")
  })
})
