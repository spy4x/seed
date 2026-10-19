import { BillingTrialQuery } from "@domain/billing"
import type { QueryHandler } from "@spy4x/platform/cqrs"
import { createBillingTrialHandler } from "../../features/billing/handlers.ts"
import { billingDependencies } from "../billing-dependencies.ts"

export const billingTrialHandler: QueryHandler<BillingTrialQuery> = createBillingTrialHandler(
  billingDependencies,
)
