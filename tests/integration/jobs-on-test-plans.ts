import { JOBS } from "@server/jobs/registry.ts"
import { TEST_PLANS } from "../../libs/domain/billing/test-plans.ts"

/**
 * The worker's jobs, each run on the test catalog, whose Pro is billed per member, so the seat
 * jobs keep their meaning whatever plans the product sells. Pass it as `createOutboxProcessor`'s
 * `jobs`.
 */
export const JOBS_ON_TEST_PLANS = JOBS.map((job) => ({
  ...job,
  handler: (deps: Parameters<typeof job.handler>[0]) => job.handler({ ...deps, plans: TEST_PLANS }),
}))
