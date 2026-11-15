import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { PictureState, pictureUrl } from "@domain/identity"
import { shellUser } from "./shell-user.ts"

const ada = { firstName: `Ada`, lastName: `Lovelace`, pictureId: `p1` }

describe("the shell's account entry", () => {
  it("shows the picture once it is ready, or when its state is unknown", () => {
    const ready = shellUser({ ...ada, pictureState: PictureState.Ready }, false, null)
    expect(ready.avatarUrl).toBe(pictureUrl(`p1`))
    expect(shellUser(ada, false, null).avatarUrl).toBe(pictureUrl(`p1`))
  })

  it("shows initials while the picture is prepared or after it was refused", () => {
    const preparing = { ...ada, pictureState: PictureState.Preparing }
    const refused = { ...ada, pictureState: PictureState.Refused }
    expect(shellUser(preparing, false, null).avatarUrl).toBeUndefined()
    expect(shellUser(refused, false, null).avatarUrl).toBeUndefined()
  })

  it("names a guest with no name Guest, and keeps a named guest's and a member's names", () => {
    const nameless = { firstName: ``, lastName: ``, pictureId: null }
    expect(shellUser(nameless, true, null).firstName).toBe(`Guest`)
    expect(shellUser(nameless, false, null).firstName).toBe(``)
    expect(shellUser(ada, false, null).firstName).toBe(`Ada`)
    expect(shellUser(ada, true, `ada@example.com`)).toEqual({
      firstName: `Ada`,
      lastName: `Lovelace`,
      email: `ada@example.com`,
      avatarUrl: pictureUrl(`p1`),
    })
  })
})
