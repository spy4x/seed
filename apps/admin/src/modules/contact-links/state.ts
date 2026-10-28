import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AdminContactLinksResponse,
  ContactLinkError,
  type ContactLinkRecord,
  parseContactLinkFields,
} from "@domain/contact-links"
import type { ContactLinkFormErrors, ContactLinkFormValue } from "@ui/admin-contact-links.tsx"
import { type AdminFetch, post } from "../../state.ts"
import { adminText } from "../../i18n.ts"

const BLANK: ContactLinkFormValue = { kind: `telegram`, value: ``, label: `` }

/** The editor: which link it has open (`null` for a new one) and what its fields hold. */
export interface ContactLinkEditorState {
  id: string | null
  value: ContactLinkFormValue
  errors: ContactLinkFormErrors
  saving: boolean
}

function formOf(link: ContactLinkRecord): ContactLinkFormValue {
  return { kind: link.kind, value: link.value, label: link.label ?? `` }
}

/**
 * The contact-links module's state (#465): the list, the editor and the moves and removals. Every
 * call goes through the app's `request`, which signs the app out on a 401. A save checks the fields
 * in the page's words first, with the same rules the API applies, so a wrong value is named under
 * its field; a refusal of the API's own shows under the form. After every write the list is read
 * again.
 */
export function createContactLinksState(
  request: AdminFetch,
  toasts: ToastStore,
  newId: () => string = uuidV7,
) {
  const links = signal<ContactLinkRecord[] | null>(null)
  const error = signal<string | null>(null)
  const busy = signal(false)
  const editor = signal<ContactLinkEditorState>({
    id: null,
    value: BLANK,
    errors: {},
    saving: false,
  })

  const state = {
    links,
    error,
    busy,
    editor,

    async load(): Promise<void> {
      const result = await request<AdminContactLinksResponse>(`/api/admin/contact-links`)
      if (result.ok) {
        links.value = result.data.links
        error.value = null
      } else error.value = result.error.message
    },

    /** The link with `id` from the list, once the list is read. */
    find(id: string): ContactLinkRecord | null {
      return links.value?.find((link) => link.id === id) ?? null
    },

    /** Opens the editor on `id`, or on a new link when it is `null`. */
    open(id: string | null): void {
      const link = id === null ? null : state.find(id)
      editor.value = {
        id,
        value: link ? formOf(link) : BLANK,
        errors: {},
        saving: false,
      }
    },

    edit(value: ContactLinkFormValue): void {
      editor.value = { ...editor.value, value }
    },

    /** Whether the fields hold something not saved, for the guard that asks before leaving. */
    unsaved(): boolean {
      const { id, value, saving } = editor.value
      if (saving) return false
      const link = id === null ? null : state.find(id)
      const saved = link ? formOf(link) : BLANK
      return value.kind !== saved.kind || value.value !== saved.value ||
        value.label !== saved.label
    },

    /** Adds or saves the link. Answers whether it went through. */
    async save(): Promise<boolean> {
      const open = editor.value
      if (open.saving) return false
      try {
        parseContactLinkFields(open.value)
      } catch (refusal) {
        if (!(refusal instanceof ContactLinkError) || refusal.field === `kind`) throw refusal
        editor.value = { ...open, errors: { [refusal.field ?? `form`]: refusal.message } }
        return false
      }
      editor.value = { ...open, errors: {}, saving: true }
      const link = open.id === null ? null : state.find(open.id)
      const id = link?.id ?? newId()
      const body = { kind: open.value.kind, value: open.value.value, label: open.value.label }
      const result = link
        ? await request(`/api/admin/contact-links/${id}`, post({ ...body, version: link.version }))
        : await request(`/api/admin/contact-links`, post({ id, ...body }))
      if (!result.ok) {
        editor.value = { ...editor.value, saving: false, errors: { form: result.error.message } }
        return false
      }
      await state.load()
      // The fields now show the link as saved, so nothing is left unsaved.
      state.open(id)
      toasts.success({
        body: adminText().t(link ? `AdminContactLinks.doneSaved` : `AdminContactLinks.doneAdded`),
        dataE2E: `contact-links-toast`,
      })
      return true
    },

    /** Moves the link one place up or down. */
    async move(id: string, by: -1 | 1): Promise<void> {
      const list = links.value
      const from = list?.findIndex((link) => link.id === id) ?? -1
      if (!list || from < 0 || busy.value) return
      const to = from + by
      if (to < 0 || to >= list.length) return
      const ids = list.map((link) => link.id)
      ;[ids[from], ids[to]] = [ids[to], ids[from]]
      await state.write(`/api/admin/contact-links/order`, { ids })
    },

    /** Removes the link. Answers whether it went through. */
    remove(link: ContactLinkRecord): Promise<boolean> {
      return state.write(`/api/admin/contact-links/${link.id}/delete`, { version: link.version }, {
        toast: adminText().t(`AdminContactLinks.doneRemoved`),
      })
    },

    /** One move or removal, then the list again; a refusal shows above the list. */
    async write(path: string, body: unknown, options: { toast?: string } = {}): Promise<boolean> {
      if (busy.value) return false
      busy.value = true
      const result = await request(path, post(body))
      if (result.ok && options.toast) {
        toasts.success({ body: options.toast, dataE2E: `contact-links-toast` })
      }
      await state.load()
      if (!result.ok) error.value = result.error.message
      busy.value = false
      return result.ok
    },
  }
  return state
}

export type ContactLinksState = ReturnType<typeof createContactLinksState>
