import type { Command, CommandConstructor, CqrsMiddleware } from "@spy4x/platform/cqrs"
import {
  assertFeature,
  assertRoomFor,
  type EntitlementNeed,
  entitlementsOf,
  type FeatureKey,
  type LimitKey,
  type Plan,
} from "@domain/billing"
import type { GroupRole } from "@domain/groups"

/** A command that counts against a cap: the gate tells its handler the cap it found. */
export interface MeteredCommand {
  allowance?: number | null
}

/** What one command needs from its group's plan, and who the gate judges. */
interface CommandNeed<T> {
  /** The group the command acts on. */
  groupOf(command: T): string
  need: EntitlementNeed
  /**
   * Whether the gate judges this command against the plan. It answers `false` for a command the
   * handler refuses on any plan (a stranger, a viewer asking for an editor's command, a change of
   * a role nobody may make, a member who has left) or that no plan limits (a demotion), so the
   * handler gives its own answer, the same on every plan. `roleOf` reads another member's role in
   * the command's group.
   */
  judges: Judge<T>
}

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any>

/** See {@link CommandNeed.judges}. */
export type Judge<T> = (
  actor: GroupRole,
  command: T,
  roleOf: (userId: number) => Promise<GroupRole | null>,
  /** Any member's role in any group: for a command that also names a second group. */
  roleIn: (groupId: string, userId: number) => Promise<GroupRole | null>,
) => boolean | Promise<boolean>

/** The commands the gate checks, one entry each. Build entries with {@link needsFeature} and {@link needsRoom}. */
export type EntitlementNeeds = ReadonlyMap<CommandConstructor<AnyCommand>, CommandNeed<AnyCommand>>

/** An entry for a command that needs a feature of the plan. */
export function needsFeature<T extends AnyCommand>(
  commandClass: CommandConstructor<T>,
  feature: FeatureKey,
  groupOf: (command: T) => string,
  judges: Judge<T>,
): [CommandConstructor<AnyCommand>, CommandNeed<AnyCommand>] {
  return [commandClass, { groupOf, need: { feature }, judges } as CommandNeed<AnyCommand>]
}

/** An entry for a command that adds one to a capped count. Its handler reads `allowance`. */
export function needsRoom<T extends AnyCommand & MeteredCommand>(
  commandClass: CommandConstructor<T>,
  limit: LimitKey,
  groupOf: (command: T) => string,
  judges: Judge<T>,
): [CommandConstructor<AnyCommand>, CommandNeed<AnyCommand>] {
  return [commandClass, { groupOf, need: { limit }, judges } as CommandNeed<AnyCommand>]
}

export interface EntitlementGateDependencies {
  /** `false` when the deployment takes no payments: every group may do everything. */
  billingEnabled: boolean
  /** The plan the group is on now (`effectivePlanId`). */
  planOf(groupId: string): Promise<string>
  /** The actor's role in the group, or `null` for a stranger. */
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
  /** How much of each capped count the group uses now. A cap a command names must be here. */
  usage: Partial<Record<LimitKey, (groupId: string) => Promise<number>>>
  /** The plan catalog the caps are read from: `PLANS` unless a test passes its own. */
  plans?: readonly Plan[]
}

function actorIdOf(command: AnyCommand): number | null {
  const actor = (command.data as { actor?: { userId?: unknown } } | null)?.actor
  return typeof actor?.userId === "number" ? actor.userId : null
}

/**
 * The one place a plan refuses a command. Each command that needs something from its group's plan
 * is listed in `needs`; the gate reads the group's plan and refuses the command with a `PlanError`
 * before its handler runs. Every other command, and every query, passes untouched, so a group
 * over its caps after a downgrade still reads all it has.
 *
 * A capped command also gets the cap as `allowance`: the gate's count runs outside the write's
 * transaction, so two requests can both pass it for the last free slot, and the write counts
 * again under the group's lock and refuses the second one.
 */
export function createEntitlementGate(
  dependencies: EntitlementGateDependencies,
  needs: EntitlementNeeds,
): CqrsMiddleware {
  for (const { need } of needs.values()) {
    if ("limit" in need && !dependencies.usage[need.limit]) {
      throw new Error(`The entitlement gate has no usage count for "${need.limit}"`)
    }
  }
  return async (message, next) => {
    const entry = needs.get(message.constructor as CommandConstructor<AnyCommand>)
    if (!entry) return await next()
    const command = message as AnyCommand & MeteredCommand
    if (!dependencies.billingEnabled) {
      if ("limit" in entry.need) command.allowance = null
      return await next()
    }
    const groupId = entry.groupOf(command)
    const actorId = actorIdOf(command)
    const role = actorId === null ? null : await dependencies.roleOf(groupId, actorId)
    const judged = role !== null &&
      await entry.judges(
        role,
        command,
        (userId) => dependencies.roleOf(groupId, userId),
        dependencies.roleOf,
      )
    const entitlements = entitlementsOf(
      await dependencies.planOf(groupId),
      true,
      dependencies.plans,
    )
    if ("limit" in entry.need) {
      const max = entitlements.limits[entry.need.limit]
      command.allowance = max
      if (role === null || !judged || max === null) return await next()
      const count = dependencies.usage[entry.need.limit] as (groupId: string) => Promise<number>
      assertRoomFor(entry.need.limit, max, await count(groupId), role)
      return await next()
    }
    if (role !== null && judged) {
      assertFeature(entitlements, entry.need.feature, role)
    }
    return await next()
  }
}
