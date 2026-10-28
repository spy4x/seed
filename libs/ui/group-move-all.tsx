import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { Field } from "@spy4x/preact-ui/field"
import { Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import type { PlanRefusal } from "@domain/billing"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import type { MoveTarget } from "./notes-screen.tsx"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import { useAppText } from "./i18n.ts"

/** What a finished move tells the person: how many notes and tags went, and where. */
export interface MoveAllResult {
  /** Notes moved. */
  count: number
  /** Tags moved; left out or 0, the message names notes only. */
  tags?: number
  toName: string
}

export interface GroupMoveAllFormProps {
  groupName: string
  /** The groups the person may write to, other than this one. Never empty when the form shows. */
  targets: readonly MoveTarget[]
  /** A move is in flight. */
  moving?: boolean
  /** Why the move was refused, or `null`. */
  error?: string | null
  /**
   * The target's plan refused the move: shown as the plan notice, naming that group, in place of
   * `error`. It belongs to the target that was picked then: `onTargetChange` clears it.
   */
  refusal?: PlanRefusal | null
  /** Follows the notice's "Open Plan and billing" link without a page load. */
  navigate?: Navigate
  /** The finished move, or `null` while there is none. */
  result?: MoveAllResult | null
  /** The person picked another target: the refusal belonged to the one before. */
  onTargetChange?: () => void
  /** Moves everything to the chosen group. */
  onMove?: (toGroupId: string) => void
  /** Closes the dialog the form sits in. */
  onCancel?: () => void
  /**
   * Opens the delete confirmation for this group. Left out when the group cannot be deleted by this
   * person now, so the result offers only "Keep the group".
   */
  onDelete?: () => void
}

/**
 * Moving all of a group's data to another group, in a dialog. The person picks the group and
 * confirms. Afterwards the dialog says how many notes moved and offers to delete the emptied group,
 * or to keep it. Pure: the app owns the request.
 */
export function GroupMoveAllForm(
  {
    groupName,
    targets,
    moving = false,
    error = null,
    refusal = null,
    navigate,
    result = null,
    onTargetChange,
    onMove,
    onCancel,
    onDelete,
  }: GroupMoveAllFormProps,
): JSX.Element {
  const t = useAppText()
  const [toGroupId, setToGroupId] = useState(targets[0]?.id ?? ``)
  // The refusal belongs to the group the form last submitted to; it is shown only while that
  // group is still picked, under that group's name and pricing link.
  const [submittedTo, setSubmittedTo] = useState<string | null>(null)
  if (result) {
    return <Done groupName={groupName} result={result} onCancel={onCancel} onDelete={onDelete} />
  }
  return (
    <ScreenForm
      pending={moving}
      onSubmit={() => {
        if (!toGroupId) return
        setSubmittedTo(toGroupId)
        onMove?.(toGroupId)
      }}
    >
      <Stack gap="lg">
        <p class="text-sm text-muted" data-e2e="group-move-all-explanation">
          <Rich
            parts={t.parts(`GroupMoveAll.explanation`, { name: groupName })}
            tags={{ value: (name) => <bdi translate={false}>{name}</bdi> }}
          />
        </p>
        <Field id="group-move-all-to" label={t.t(`GroupMoveAll.to`)}>
          <Select
            name="toGroupId"
            data-e2e="group-move-all-to"
            value={toGroupId}
            onChange={(event) => {
              setToGroupId(event.currentTarget.value)
              onTargetChange?.()
            }}
            options={targets.map((target) => ({ value: target.id, label: target.name }))}
          />
        </Field>
        {refusal
          ? submittedTo === toGroupId && (
            <PlanRefusalNotice
              groupId={toGroupId}
              groupName={targets.find((target) => target.id === toGroupId)?.name}
              refusal={refusal}
              navigate={navigate}
            />
          )
          : <ErrorState focusOnAppear message={error} dataE2E="group-move-all-error" />}
        <DialogActions>
          <Button
            type="button"
            variant="ghost"
            class="min-h-11 sm:min-h-9"
            onClick={onCancel}
            data-e2e="group-move-all-cancel"
          >
            {t.t(`GroupMoveAll.cancel`)}
          </Button>
          <Button
            type="submit"
            class="min-h-11 sm:min-h-9"
            busy={moving}
            busyLabel={t.t(`GroupMoveAll.moving`)}
            data-e2e="group-move-all-submit"
          >
            {t.t(`GroupMoveAll.submit`)}
          </Button>
        </DialogActions>
      </Stack>
    </ScreenForm>
  )
}

/** What a finished move says; focus lands on "Keep the group", the safe way on. */
function Done(
  { groupName, result, onCancel, onDelete }: {
    groupName: string
    result: MoveAllResult
    onCancel?: () => void
    onDelete?: () => void
  },
): JSX.Element {
  const t = useAppText()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[data-e2e=group-move-all-keep]")?.focus()
  }, [])
  const notes = t.t(`GroupMoveAll.notes`, { count: result.count })
  const names = { from: groupName, to: result.toName }
  return (
    <div ref={box}>
      <Stack gap="lg">
        <p class="text-sm" role="status" data-e2e="group-move-all-done">
          <Rich
            parts={result.tags
              ? t.parts(`GroupMoveAll.doneWithTags`, {
                ...names,
                notes,
                tags: t.t(`GroupMoveAll.tags`, { count: result.tags }),
              })
              : t.parts(`GroupMoveAll.done`, { ...names, notes })}
            tags={{ value: (name) => <bdi translate={false}>{name}</bdi> }}
          />
        </p>
        <DialogActions>
          <Button
            type="button"
            variant="ghost"
            class="min-h-11 sm:min-h-9"
            onClick={onCancel}
            data-e2e="group-move-all-keep"
          >
            {t.t(`GroupMoveAll.keep`)}
          </Button>
          {onDelete && (
            <Button
              type="button"
              variant="danger"
              class="min-h-11 sm:min-h-9"
              onClick={onDelete}
              data-e2e="group-move-all-delete"
            >
              {t.t(`GroupMoveAll.delete`, { name: groupName })}
            </Button>
          )}
        </DialogActions>
      </Stack>
    </div>
  )
}
