import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { InvitationScreen, MyInvitationsSection } from "@ui/group-invitations.tsx"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { type InvitationRef, invitationsStore } from "../state/invitations.ts"
import { selectionStore } from "../state/selection.ts"

type InvitationsStore = typeof invitationsStore

/**
 * After an accept: the server already selected the joined group, so the app reads the groups and
 * the selection again and opens the notes.
 */
async function joined(
  store: InvitationsStore,
  ref: InvitationRef,
  navigate: (path: string) => void,
): Promise<boolean> {
  const result = await store.accept(ref)
  if (!result) return false
  await Promise.all([groupsStore.refreshFromUser(), selectionStore.refresh().catch(() => {})])
  navigate(NOTE_PATHS.list)
  return true
}

/** The page an invitation link opens. The sign-in gate sends a signed-out visitor to sign up first. */
export function InvitationView({ token }: { token: string }) {
  const [, navigate] = useLocation()
  const store = invitationsStore
  useEffect(() => {
    // The token is in this page's address: a link followed from here must not send it on.
    const meta = document.createElement("meta")
    meta.name = "referrer"
    meta.content = "no-referrer"
    document.head.append(meta)
    void store.loadPreview(token)
    return () => meta.remove()
  }, [token])
  const failed = store.answerError.value?.ref === token ? store.answerError.value : null
  return (
    <InvitationScreen
      invitation={store.preview.value}
      loading={store.previewLoading.value}
      error={store.previewError.value}
      answering={store.answering.value === token}
      answerError={failed && !failed.plan ? failed.message : null}
      answerRefusal={failed?.plan ?? null}
      navigate={navigate}
      onAccept={() => void joined(store, { token }, navigate)}
      onDecline={() =>
        void store.decline({ token }).then((done) => done && navigate(SCREEN_PATHS.groups))}
    />
  )
}

/**
 * The invitations sent to the person's proved address, on the groups page. `store` is the app's
 * own unless a test hands in one with a fake API.
 */
export function MyInvitationsView({ store = invitationsStore }: { store?: InvitationsStore }) {
  const [, navigate] = useLocation()
  useEffect(() => void store.loadMine(), [])
  const failed = store.answerError.value
  return (
    <MyInvitationsSection
      invitations={store.mine.value}
      answeringId={store.answering.value}
      answerError={failed &&
        { invitationId: failed.ref, message: failed.message, plan: failed.plan }}
      navigate={navigate}
      onAccept={(invitationId) => void joined(store, { invitationId }, navigate)}
      onDecline={(invitationId) => void store.decline({ invitationId })}
    />
  )
}
