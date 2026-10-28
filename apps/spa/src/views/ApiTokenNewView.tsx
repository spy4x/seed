import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { API_TOKEN_OFFLINE, ApiTokenNewScreen } from "@ui/api-token-new-screen.tsx"
import { profilePath } from "@ui/progressive.tsx"
import { siteOrigin } from "../state/demo.ts"
import { apiDocsHref } from "./api-docs-href.ts"
import { apiTokensHttp, type ApiTokensStore, createApiTokensStore } from "../state/api-tokens.ts"
import { groupsStore } from "../state/groups.ts"
import { isSpaPath } from "./spa-paths.ts"
import { GuestRefusalDialog } from "@ui/guest-profile.tsx"
import { isGuestSession } from "../state/guest.ts"

const network = createOnlineStatus()

/**
 * Wires `/tokens/new` to a token store of its own, made when the page opens and dropped when it
 * closes: the new token's secret lives only there, never in the address, the history, a log or a
 * store that outlives the page. Done forgets the secret before it goes back to the profile. Leaving
 * earlier asks first: with the form filled in, "Discard your changes?"; with the secret on screen,
 * "Leave without copying?".
 */
export function ApiTokenNewView(
  { store: given }: { store?: ApiTokensStore } = {},
) {
  const [, navigate] = useLocation()
  const [store] = useState(() => given ?? createApiTokensStore(apiTokensHttp))
  useEffect(() => network.watch(), [])
  // The form opens empty; once the groups are known, for the first of them.
  const groups = groupsStore.groups.value
  const known = !(groupsStore.loading.value && groups.length === 0)
  const firstGroup = groups[0]?.id ?? ""
  useEffect(() => store.startCreate(firstGroup), [])
  useEffect(() => {
    if (firstGroup && store.values.value.groupId === "") store.setValue("groupId", firstGroup)
  }, [firstGroup])

  const offline = !network.online.value
  // A submit while offline sends nothing and says why under the form, in the notice's words.
  const [refusedOffline, setRefusedOffline] = useState(false)
  const created = store.created.value
  const values = store.values.value
  const filledIn = values.name.trim() !== "" || values.password !== ""
  const errors = store.errors.value

  const done = () => {
    store.dismissSecret()
    navigate(profilePath("api-tokens"))
  }

  // A guest has no password to confirm a token with (#224): the refusal shows at once.
  if (isGuestSession()) {
    return (
      <GuestRefusalDialog
        action="api-token"
        navigate={navigate}
        onClose={() => navigate(profilePath("api-tokens"), { replace: true })}
      />
    )
  }

  return (
    <>
      <ApiTokenNewScreen
        groups={known ? groups.map((group) => ({ id: group.id, name: group.name })) : null}
        values={values}
        onValueChange={store.setValue}
        errors={{
          name: errors.name,
          password: errors.password,
          form: refusedOffline && offline ? API_TOKEN_OFFLINE : errors.form,
        }}
        pending={store.pending.value.create}
        created={created}
        offline={offline}
        onCreate={() => {
          setRefusedOffline(offline)
          if (offline) return
          // The page itself says the token exists: its heading becomes "Copy your token".
          void store.create()
        }}
        onDone={done}
        navigate={navigate}
        docsHref={apiDocsHref(siteOrigin.value)}
      />
      <UnsavedGuard
        when={created !== null || filledIn}
        owns={(url) => isSpaPath(url.pathname)}
        navigate={navigate}
        labels={created
          ? {
            title: "Leave without copying?",
            message: "You will not be able to see this token again.",
            leave: "Leave",
            stay: "Stay",
          }
          : {
            title: "Discard your changes?",
            message: "This token is not created yet.",
            leave: "Discard changes",
            stay: "Keep editing",
          }}
        onDiscard={() => store.dismissSecret()}
      />
    </>
  )
}
