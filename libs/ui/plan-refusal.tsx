// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Notice } from "@spy4x/preact-ui/notice"
import type { FeatureKey, LimitKey, PlanRefusal } from "@domain/billing"
import { GROUP_PATHS, type Navigate } from "./progressive.tsx"

/**
 * What a refusal says, per entitlement: a title, and what the plan allows. `who` is what the title
 * calls the group: its name, or "This group".
 */
const REFUSAL_TEXT: Record<
  FeatureKey | LimitKey,
  (limit: number | null, who: string) => {
    title: string
    message: string
  }
> = {
  maxNotes: (limit, who) => ({
    title: `${who} has reached its note limit`,
    message: `Its plan holds up to ${limit} notes. Every note it has stays readable and editable.`,
  }),
  maxMembers: (limit, who) => ({
    title: `${who} has reached its member limit`,
    message: `Its plan allows up to ${limit} members.`,
  }),
  maxAttachments: (limit, who) => ({
    title: `${who} has reached its file limit`,
    message:
      `Its plan holds up to ${limit} files across all notes. Remove a file from any note to make room.`,
  }),
  storageBytes: (_limit, who) => ({
    title: `${who} has used all its storage`,
    message: "Its plan has no room for more files.",
  }),
  memberRoles: () => ({
    title: "Promoting members needs a paid plan",
    message:
      "On this group's plan, a member can be given a lower role or removed, but not promoted.",
  }),
}

export interface PlanRefusalNoticeProps {
  groupId: string
  /** The refusal the API sent with its 402, or the socket with its `forbidden`. */
  refusal: PlanRefusal
  /** The group's name, for the title ("Family has reached its note limit"). Left out: "This group". */
  groupName?: string
  navigate?: Navigate
}

/**
 * Why the group's plan refused an action, shown where the action was. The owner gets an "Open Plan
 * and billing" link to the group's Plan and billing tab; anyone else is told to ask the owner, as
 * only the owner can change the plan. Focus moves to the notice, so a keyboard or screen reader user hears it.
 */
export function PlanRefusalNotice(
  { groupId, refusal, groupName, navigate }: PlanRefusalNoticeProps,
): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [refusal])
  const text = REFUSAL_TEXT[refusal.entitlement](refusal.limit, groupName ?? "This group")
  return (
    <div
      ref={box}
      tabIndex={-1}
      data-e2e="plan-refusal"
      data-entitlement={refusal.entitlement}
    >
      <Notice
        tone="warning"
        title={text.title}
        action={refusal.canUpgrade && (
          <Button href={GROUP_PATHS.billing(groupId)} navigate={navigate} size="sm">
            Open Plan and billing
          </Button>
        )}
      >
        {refusal.canUpgrade ? text.message : (
          <span data-e2e="plan-refusal-ask-owner">
            {text.message} Ask the group's owner to upgrade the plan.
          </span>
        )}
      </Notice>
    </div>
  )
}
