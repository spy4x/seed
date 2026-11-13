/**
 * The product's own kinds of group activity, such as a finance product's change of main currency.
 * Seed ships this list empty and never adds to it: a product replaces this file with its own list
 * and adds `libs/domain/groups/product-activity.ts` to `.seed/skip`, so taking Seed's later changes
 * never conflicts here. The shape of an entry, `ProductActivityKind`, stays in `activity.ts`. The
 * same file names the product's own things an event can point at, `ProductEntityType`.
 * [Connect a feature to the app](../../../docs/aggregate-extras.md) shows an example entry.
 *
 * @module
 */

import type { ProductActivityKind } from "./activity.ts"

/** The kinds the group activity panel, `describeActivity` and the admin audit log know besides Seed's. */
export const PRODUCT_ACTIVITY_KINDS: readonly ProductActivityKind[] = []

/**
 * The product's own things an audit event can point at besides Seed's, such as `"account"`. Seed
 * adds none.
 */
export type ProductEntityType = never
