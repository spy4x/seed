import { useEffect } from "preact/hooks"
import { UnsentChangesDialog } from "@spy4x/preact-system/unsent-changes-dialog"
import type { UnsentWait } from "../modules.ts"

/**
 * The question a sign-out asks while writes wait in the offline queue: send them first, sign out
 * anyway, or stay. The wait shows in the same dialog; once nothing is left to send, `onSignOut`
 * runs by itself. Once only writes that need a choice are left, "Review changes" calls `onReview`
 * with their group, whose notes page shows the chooser.
 */
export function UnsentSignOut(
  { wait, onSignOut, onCancel, onReview }: {
    wait: UnsentWait
    onSignOut: () => void
    onCancel: () => void
    onReview: (groupId: string | null) => void
  },
) {
  const view = wait.view.value
  const empty = view.unsent === 0
  useEffect(() => {
    // Everything went out (here, or from another tab): the sign-out the person asked for goes on.
    if (empty) onSignOut()
  }, [empty])
  if (empty) return null
  return (
    <UnsentChangesDialog
      unsent={view.unsent}
      conflicts={view.conflicts}
      sent={view.sent}
      state={view.state}
      // Nothing is being sent while the device is offline; "Sending…" would say otherwise.
      labels={view.state === "offline" ? { sendBusy: "Waiting…" } : undefined}
      onSend={() => wait.send()}
      onSignOut={onSignOut}
      onCancel={onCancel}
      onReview={() => onReview(view.reviewGroupId)}
    />
  )
}
