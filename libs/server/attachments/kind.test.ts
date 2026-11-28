import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type AttachmentKind, attachmentKind, attachmentKindList } from "./kind.ts"
import { attachmentKinds } from "./registry.ts"
import { NOTES_OFF, NOTES_ON } from "../notes/setup.ts"

const receipt: AttachmentKind = {
  name: `receipt`,
  prefix: `receipt`,
  recordField: `transactionId`,
  table: `transaction_receipts`,
  records: { table: `transactions`, key: `transaction_id`, title: `description` },
  assertCanRead: () => {},
  assertCanWrite: () => {},
  recordNotFound: () => new Error(`Transaction not found`),
}

describe(`attachmentKind`, () => {
  it(`accepts plain lower case names`, () => {
    expect(attachmentKind(receipt)).toBe(receipt)
  })

  it(`refuses a table, column, name, prefix or field that is not a plain identifier`, () => {
    for (
      const bad of [
        { ...receipt, table: `receipts; DROP TABLE users` },
        { ...receipt, table: `"receipts"` },
        { ...receipt, records: { ...receipt.records, key: `Transaction_id` } },
        { ...receipt, records: { ...receipt.records, title: `title || secret` } },
        { ...receipt, records: { ...receipt.records, table: `` } },
        { ...receipt, name: `a`.repeat(33) },
        { ...receipt, prefix: `receipt.sign` },
        { ...receipt, recordField: `transaction-id` },
      ]
    ) {
      expect(() => attachmentKind(bad)).toThrow()
    }
  })

  it(`refuses two kinds that share a name, a prefix or a table`, () => {
    expect(() => attachmentKindList([receipt, { ...receipt, prefix: `invoice` }])).toThrow()
    expect(() => attachmentKindList([receipt, { ...receipt, name: `invoice` }])).toThrow()
    expect(() => attachmentKindList([receipt, { ...receipt, name: `invoice`, prefix: `invoice` }]))
      .toThrow(`table`)
  })
})

describe(`attachmentKinds`, () => {
  it(`serves the notes' kind under attachment.* only while the notes are on`, () => {
    expect(attachmentKinds(NOTES_ON).map((kind) => [kind.name, kind.prefix])).toEqual([
      [`note`, `attachment`],
    ])
    expect(attachmentKinds(NOTES_OFF)).toEqual([])
  })
})
