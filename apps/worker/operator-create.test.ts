import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { UserRole } from "@domain/identity"
import {
  askNewPassword,
  createOperator,
  OPERATOR_CREATE_USAGE,
  operatorCreateMessage,
  type OperatorCreatePorts,
  parseOperatorCreateArgs,
  readSecret,
  type SecretInput,
} from "./operator-create.ts"

const PASSWORD = `correct horse battery`

/** People by address, with their role, and what the ports were asked to do. */
function fakeDatabase(people: Record<string, UserRole> = {}, password: string | null = PASSWORD) {
  const ids = new Map(Object.keys(people).map((address, index) => [address, index + 1]))
  const calls: string[] = []
  const ports: OperatorCreatePorts = {
    raise: (address) => {
      calls.push(`raise ${address}`)
      const previous = people[address]
      if (previous === undefined) return Promise.resolve(null)
      people[address] = UserRole.ADMIN
      return Promise.resolve({ id: ids.get(address)!, previous })
    },
    askPassword: () => {
      calls.push(`ask`)
      return Promise.resolve(password)
    },
    create: (address, given) => {
      calls.push(`create ${address} ${given === password ? `with the typed password` : given}`)
      ids.set(address, ids.size + 1)
      people[address] = UserRole.VIEWER
      return Promise.resolve()
    },
  }
  return { ports, people, calls }
}

/** A terminal or a pipe that hands over `chunks` one read at a time. */
function fakeInput(chunks: string[], terminal: boolean) {
  const raw: boolean[] = []
  const queue = chunks.map((chunk) => new TextEncoder().encode(chunk))
  const input: SecretInput = {
    isTerminal: () => terminal,
    setRaw: (on) => void raw.push(on),
    read: (buffer) => {
      const next = queue.shift()
      if (!next) return Promise.resolve(null)
      buffer.set(next)
      return Promise.resolve(next.length)
    },
  }
  return { input, raw }
}

describe(`operator:create arguments`, () => {
  it(`takes one address and normalises it as sign-up does`, () => {
    expect(parseOperatorCreateArgs([` Seller@Example.COM `])).toBe(`seller@example.com`)
  })

  it(`refuses a password given as a second argument, no address and a wrong one`, () => {
    expect(parseOperatorCreateArgs([`seller@example.com`, PASSWORD])).toBe(null)
    expect(parseOperatorCreateArgs([])).toBe(null)
    expect(parseOperatorCreateArgs([`seller`])).toBe(null)
    expect(OPERATOR_CREATE_USAGE).toContain(`never an argument`)
  })
})

describe(`createOperator`, () => {
  it(`creates an unknown address with the typed password and makes it an administrator`, async () => {
    const { ports, people, calls } = fakeDatabase()
    const result = await createOperator(`seller@example.com`, ports)

    expect(result).toEqual({ outcome: 1, id: 1 })
    expect(people[`seller@example.com`]).toBe(UserRole.ADMIN)
    expect(calls).toEqual([
      `raise seller@example.com`,
      `ask`,
      `create seller@example.com with the typed password`,
      `raise seller@example.com`,
    ])
  })

  it(`changes nothing on a second run and asks for no password`, async () => {
    const { ports, calls } = fakeDatabase()
    await createOperator(`seller@example.com`, ports)
    calls.length = 0

    expect(await createOperator(`seller@example.com`, ports)).toEqual({ outcome: 3, id: 1 })
    expect(calls).toEqual([`raise seller@example.com`])
  })

  it(`raises an existing person to administrator without asking for or changing a password`, async () => {
    const { ports, people, calls } = fakeDatabase({ "ops@example.com": UserRole.OPERATOR })

    expect(await createOperator(`ops@example.com`, ports)).toEqual({ outcome: 2, id: 1 })
    expect(people[`ops@example.com`]).toBe(UserRole.ADMIN)
    expect(calls).toEqual([`raise ops@example.com`])
  })

  it(`creates nothing for a password sign-up would refuse, or none at all`, async () => {
    for (const password of [`short`, `x`.repeat(51), null]) {
      const { ports, people, calls } = fakeDatabase({}, password)
      const result = await createOperator(`seller@example.com`, ports)

      expect(`error` in result).toBe(true)
      expect(people).toEqual({})
      expect(calls).toEqual([`raise seller@example.com`, `ask`])
    }
  })

  it(`prints the address and the user, never the password`, async () => {
    const before: Record<string, UserRole>[] = [{}, { "seller@example.com": UserRole.VIEWER }]
    for (const people of before) {
      const { ports } = fakeDatabase({ ...people })
      const result = await createOperator(`seller@example.com`, ports)
      const message = operatorCreateMessage(`seller@example.com`, result)

      expect(message).toContain(`seller@example.com`)
      expect(message).toContain(`administrator`)
      expect(message).not.toContain(PASSWORD)
    }
  })
})

describe(`readSecret`, () => {
  it(`turns echo off on a terminal and writes only the prompt and a line break`, async () => {
    const { input, raw } = fakeInput([`corr`, `ect horse battery\r`], true)
    const written: string[] = []

    expect(await readSecret(input, (text) => written.push(text), `Password: `)).toBe(PASSWORD)
    expect(raw).toEqual([true, false])
    expect(written).toEqual([`Password: `, `\n`])
  })

  it(`takes Backspace, and answers null to Ctrl+C with echo back on`, async () => {
    const typo = fakeInput([`pass\u007fs-word\n`], true)
    expect(await readSecret(typo.input, () => {}, ``)).toBe(`pass-word`)

    const cancelled = fakeInput([`secret\u0003`], true)
    expect(await readSecret(cancelled.input, () => {}, ``)).toBe(null)
    expect(cancelled.raw).toEqual([true, false])
  })

  it(`reads the first line from a pipe without touching the terminal`, async () => {
    const { input, raw } = fakeInput([`${PASSWORD}\nsomething else\n`], false)

    expect(await readSecret(input, () => {}, ``)).toBe(PASSWORD)
    expect(raw).toEqual([])
  })
})

describe(`askNewPassword`, () => {
  it(`asks twice on a terminal and gives no password when the two differ`, async () => {
    const same = fakeInput([`${PASSWORD}\r`, `${PASSWORD}\r`], true)
    expect(await askNewPassword(same.input, () => {})).toBe(PASSWORD)

    const differ = fakeInput([`${PASSWORD}\r`, `correct horse battery staple\r`], true)
    const written: string[] = []
    expect(await askNewPassword(differ.input, (text) => written.push(text))).toBe(null)
    expect(written.join(``)).not.toContain(PASSWORD)
  })

  it(`asks once from a pipe`, async () => {
    const { input } = fakeInput([`${PASSWORD}\n`], false)
    expect(await askNewPassword(input, () => {})).toBe(PASSWORD)
  })
})
