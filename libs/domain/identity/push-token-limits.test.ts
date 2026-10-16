/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { validate } from "@spy4x/validation"
import {
  PUSH_SUBSCRIPTION_LIMITS,
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
} from "@spy4x/platform/model"
import { userPushTokenSchemaBase } from "@domain/identity"

type Field = keyof typeof PUSH_SUBSCRIPTION_LIMITS
const FIELDS = Object.keys(PUSH_SUBSCRIPTION_LIMITS) as Field[]

const ENDPOINT = "https://push.example/"

/** A subscribe request whose `field` is `length` characters long; the endpoint stays https. */
function request(field: Field, length: number) {
  const value = (name: Field) => (name === field ? "x".repeat(length) : "x")
  return {
    deviceId: value("deviceId"),
    subscription: {
      endpoint: field === "endpoint" ? ENDPOINT.padEnd(length, "x") : ENDPOINT,
      keys: { auth: value("auth"), p256dh: value("p256dh") },
    },
  }
}

for (const field of FIELDS) {
  const limit = PUSH_SUBSCRIPTION_LIMITS[field]

  Deno.test(`push limits: the subscribe request accepts ${limit} characters in ${field}`, () => {
    expect(validate(pushSubscribeRequestSchema, request(field, limit)).error).toBeNull()
  })

  Deno.test(`push limits: the subscribe request refuses ${limit + 1} characters in ${field}`, () => {
    const { error } = validate(pushSubscribeRequestSchema, request(field, limit + 1))
    expect(error?.description).toContain(field)
    expect(error?.description).toContain(`at most ${limit} characters`)
  })

  Deno.test(`push limits: the row schema holds ${limit} characters in ${field} and no more`, () => {
    expect(validate(userPushTokenSchemaBase, { [field]: "x".repeat(limit) }).error).toBeNull()
    expect(validate(userPushTokenSchemaBase, { [field]: "x".repeat(limit + 1) }).error).not
      .toBeNull()
  })
}

Deno.test("push limits: the unsubscribe request holds a device id of the same length", () => {
  const limit = PUSH_SUBSCRIPTION_LIMITS.deviceId
  expect(validate(pushUnsubscribeRequestSchema, { deviceId: "x".repeat(limit) }).error).toBeNull()
  expect(validate(pushUnsubscribeRequestSchema, { deviceId: "x".repeat(limit + 1) }).error).not
    .toBeNull()
})
