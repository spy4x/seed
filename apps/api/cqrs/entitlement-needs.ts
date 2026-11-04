import {
  canManageMember,
  canMutateNotes,
  GroupInvitationCreateCommand,
  GroupMemberRoleCommand,
  GroupMoveAllCommand,
  invitableRoles,
} from "@domain/groups"
import { NoteCreateCommand, NoteMoveCommand, NoteRestoreCommand } from "@domain/notes"
import { type EntitlementNeeds, needsFeature, needsRoom } from "./entitlement-gate.ts"

/**
 * Every command a plan can refuse, in one list (`docs/billing-plans.md`, "What each plan allows"). A command not
 * listed here is never refused for its plan, and no query is.
 */
export const ENTITLEMENT_NEEDS: EntitlementNeeds = new Map([
  needsRoom(
    NoteCreateCommand,
    "maxNotes",
    (command) => command.data.groupId,
    (actor) => canMutateNotes(actor),
  ),
  // A restored note is live again and counts, so a full group cannot restore one. A viewer is not
  // judged, so the handler answers "not an editor" (403) before the plan answers 402.
  needsRoom(
    NoteRestoreCommand,
    "maxNotes",
    (command) => command.data.groupId,
    (actor) => canMutateNotes(actor),
  ),
  // A move adds its notes to the target group: the gate checks room for one there, and the write
  // counts all of them. A person who cannot write in the source is not judged, so the handler
  // answers "not an editor" (403) before a full target's plan answers 402.
  needsRoom(
    NoteMoveCommand,
    "maxNotes",
    (command) => command.data.toGroupId,
    async (actor, command, _roleOf, roleIn) => {
      if (!canMutateNotes(actor)) return false
      const source = await roleIn(command.data.groupId, command.data.actor.userId)
      return source !== null && canMutateNotes(source)
    },
  ),
  // Moving a whole group adds every one of its notes to the target group, and how many is not known
  // here. The gate is judged to refuse nothing (`judges` is `false`) but still reads the target's
  // cap into `allowance`; the write counts the notes it moves under the group's lock and refuses
  // the move that would pass it, so a group with nothing to move is never refused for a full
  // target.
  needsRoom(GroupMoveAllCommand, "maxNotes", (command) => command.data.toGroupId, () => false),
  // Pending invitations take no seat: the cap counts members, here and again when one accepts.
  needsRoom(
    GroupInvitationCreateCommand,
    "maxMembers",
    (command) => command.data.groupId,
    (actor, command) => invitableRoles(actor).includes(command.data.role),
  ),
  needsFeature(
    GroupMemberRoleCommand,
    "memberRoles",
    (command) => command.data.groupId,
    // Only a promotion needs the feature, so a group back on the free plan can still demote an
    // admin it made on Pro. A change the handler refuses on every plan (a member who has left, a
    // change the actor may not make) goes on to the handler and gets its own answer.
    async (actor, command, roleOf) => {
      const target = await roleOf(command.data.userId)
      return target !== null && canManageMember(actor, target, command.data.role) &&
        command.data.role > target
    },
  ),
])
