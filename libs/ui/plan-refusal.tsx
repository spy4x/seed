import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Notice } from "@spy4x/preact-ui/notice"
import type { FeatureKey, LimitKey, PlanRefusal } from "@domain/billing"
import { GROUP_PATHS, type Navigate } from "./progressive.tsx"
import { useAppText } from "./i18n.ts"

/**
 * What a refusal says, per entitlement, by key in the `app` catalog: the title when the group's name
 * is known (`named`) and when it is not (`unnamed`), and what the plan allows. A message with a limit
 * is a plural on it.
 */
const REFUSAL_KEYS: Record<
  FeatureKey | LimitKey,
  { named: string; unnamed: string; message: string }
> = {
  maxNotes: {
    named: `PlanRefusalNotice.notesTitle`,
    unnamed: `PlanRefusalNotice.notesTitleUnnamed`,
    message: `PlanRefusalNotice.notesText`,
  },
  maxMembers: {
    named: `PlanRefusalNotice.membersTitle`,
    unnamed: `PlanRefusalNotice.membersTitleUnnamed`,
    message: `PlanRefusalNotice.membersText`,
  },
  maxAttachments: {
    named: `PlanRefusalNotice.filesTitle`,
    unnamed: `PlanRefusalNotice.filesTitleUnnamed`,
    message: `PlanRefusalNotice.filesText`,
  },
  storageBytes: {
    named: `PlanRefusalNotice.storageTitle`,
    unnamed: `PlanRefusalNotice.storageTitleUnnamed`,
    message: `PlanRefusalNotice.storageText`,
  },
  memberRoles: {
    named: `PlanRefusalNotice.rolesTitle`,
    unnamed: `PlanRefusalNotice.rolesTitle`,
    message: `PlanRefusalNotice.rolesText`,
  },
}

/** A value inside a plain-text sentence, isolated from its direction: what `<bdi>` does in markup. */
const isolate = (text: string) => `\u2068${text}\u2069`

export interface PlanRefusalNoticeProps {
  groupId: string
  /** The refusal the API sent with its 402, or the socket with its `forbidden`. */
  refusal: PlanRefusal
  /**
   * The group's name, for the title ("Family has reached its note limit"). Left out, the title says
   * "This group".
   */
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
  const t = useAppText()
  const keys = REFUSAL_KEYS[refusal.entitlement]
  const title = groupName === undefined
    ? t.t(keys.unnamed)
    : t.t(keys.named, { group: isolate(groupName) })
  const message = t.t(keys.message, { count: refusal.limit ?? 0 })
  return (
    <div
      ref={box}
      tabIndex={-1}
      data-e2e="plan-refusal"
      data-entitlement={refusal.entitlement}
    >
      <Notice
        tone="warning"
        title={title}
        action={refusal.canUpgrade && (
          <Button href={GROUP_PATHS.billing(groupId)} navigate={navigate} size="sm">
            {t.t(`PlanRefusalNotice.openBilling`)}
          </Button>
        )}
      >
        {refusal.canUpgrade ? message : (
          <span data-e2e="plan-refusal-ask-owner">
            {message} {t.t(`PlanRefusalNotice.askOwner`)}
          </span>
        )}
      </Notice>
    </div>
  )
}
