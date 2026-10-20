import { systemEnv } from "@spy4x/server/config"
import { readBillingSetup } from "@server/billing/setup.ts"
import { postgresFakePayments } from "@server/billing/fake-payments.ts"
import { config } from "./config.ts"
import { sql } from "./db.ts"

/**
 * The payment provider this process runs with, read once at start-up: a billing setup that cannot
 * run (`BILLING_PROVIDER=stripe` without its keys) stops the API here, before it serves a request.
 */
export const billingSetup = readBillingSetup(systemEnv, config.isDev ? "dev" : "prod", {
  webhooks: true,
  // Only the development provider reads it: the admin's customer page then matches the seeded data.
  fakePayments: postgresFakePayments(sql),
})
