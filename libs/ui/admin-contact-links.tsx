// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconEllipsisVertical, IconPlus } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import {
  CONTACT_KIND_NAMES,
  contactHref,
  contactValueProblem,
  normalizeContactValue,
} from "@spy4x/platform/universal/contact"
import {
  CONTACT_KINDS,
  CONTACT_LABEL_MAX_LENGTH,
  type ContactKind,
  type ContactLinkRecord,
} from "@domain/contact-links"
import { ListCard, ListEmpty, MENU_TRIGGER_CLASSES } from "./notes-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** The contact-links module's pages in the admin app. */
export const ADMIN_CONTACT_LINKS_PATHS = {
  list: `/contact-links`,
  create: `/contact-links/new`,
  link: (id: string) => `/contact-links/${encodeURIComponent(id)}`,
} as const

/** The page's subtitle: what the links are for. */
export const ADMIN_CONTACT_LINKS_SUBTITLE =
  `Where people reach you. The website's footer lists them in this order.`

/** The list's message when it could not be read, whatever the cause. */
export const ADMIN_CONTACT_LINKS_ERROR = `Contact links could not be loaded. Try again in a moment.`

/** What one kind's value field asks for, and an example of it. */
const VALUE_FIELDS: Record<ContactKind, { label: string; example: string; inputMode: string }> = {
  telegram: { label: `Username`, example: `my_shop`, inputMode: `text` },
  zalo: { label: `Phone number`, example: `0912345678`, inputMode: `tel` },
  whatsapp: { label: `Phone number`, example: `84912345678`, inputMode: `tel` },
  instagram: { label: `Username`, example: `my.shop`, inputMode: `text` },
  facebook: { label: `Page username`, example: `myshop`, inputMode: `text` },
  phone: { label: `Phone number`, example: `+84912345678`, inputMode: `tel` },
  email: { label: `Email address`, example: `hello@example.com`, inputMode: `email` },
  url: { label: `Address`, example: `https://example.com`, inputMode: `url` },
}

/** The words a link shows: its label, else its value. */
export function contactLinkText(link: Pick<ContactLinkRecord, `value` | `label`>): string {
  return link.label ?? link.value
}

export interface AdminContactLinksScreenProps {
  /** Every link in order, or `null` while it loads or when it failed. */
  links: readonly ContactLinkRecord[] | null
  /** Set when the list could not be read, or a move or removal was refused. */
  error: string | null
  /** A move or removal is on its way; the menus wait for it. */
  busy: boolean
  onRetry: () => void
  /** Moves a link one place up (-1) or down (1). */
  onMove: (id: string, by: -1 | 1) => void
  onRemove: (link: ContactLinkRecord) => void
  navigate?: Navigate
}

/**
 * The contact links (#465): every channel the website names, in the footer's order. "Add link" is
 * the page's one action; a link's text opens its editor, and its menu moves it up or down or
 * removes it behind a confirmation. Focus stays on the moved row's menu, or after a removal goes
 * to the next row's, else the page's action.
 */
export function AdminContactLinksScreen(props: AdminContactLinksScreenProps): JSX.Element {
  const { links, navigate } = props
  const [removing, setRemoving] = useState<ContactLinkRecord | null>(null)
  const [focusOn, setFocusOn] = useState<{ id: string; index: number } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusOn || props.busy || !links) return
    const menus = page.current?.querySelectorAll<HTMLElement>(`[data-e2e=contact-link-menu]`)
    const at = links.findIndex((link) => link.id === focusOn.id)
    const target = at >= 0 ? menus?.[at] : menus?.[focusOn.index] ?? menus?.[focusOn.index - 1] ??
      page.current?.querySelector<HTMLElement>(`[data-e2e=contact-link-new]`)
    target?.focus()
    setFocusOn(null)
  }, [focusOn, links, props.busy])

  return (
    <div ref={page} class="flex flex-col gap-8">
      <PageHeader
        title="Contact links"
        subtitle={ADMIN_CONTACT_LINKS_SUBTITLE}
        titleDataE2E="contact-links-title"
        action={
          <PageAction
            label="Add link"
            Icon={IconPlus}
            href={ADMIN_CONTACT_LINKS_PATHS.create}
            navigate={navigate}
            dataE2E="contact-link-new"
          />
        }
      />
      <Stack>
        {props.error && (
          <div class="flex flex-col items-center gap-3" data-e2e="contact-links-error">
            <ErrorState message={links ? props.error : ADMIN_CONTACT_LINKS_ERROR} />
            {!links && <Button variant="secondary" onClick={props.onRetry}>Try again</Button>}
          </div>
        )}
        {links === null
          ? !props.error && (
            <div role="status" aria-label="Loading contact links">
              <LoadingSkeleton rows={3} />
            </div>
          )
          : links.length === 0
          ? (
            <ListEmpty
              title="No contact links yet"
              description="Add Telegram, Zalo, a phone number or an email address. The website's footer lists them."
              action={
                <Button href={ADMIN_CONTACT_LINKS_PATHS.create} navigate={navigate}>
                  Add link
                </Button>
              }
            />
          )
          : (
            <ListCard dataE2E="contact-link-list">
              {links.map((link, index) => (
                <li
                  key={link.id}
                  class="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
                  data-e2e="contact-link-row"
                >
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={ADMIN_CONTACT_LINKS_PATHS.link(link.id)}
                      navigate={navigate}
                      class="pc-link line-clamp-2 font-medium wrap-anywhere"
                      data-e2e="contact-link-edit"
                    >
                      {contactLinkText(link)}
                    </Link>
                    <span class="text-sm text-muted wrap-anywhere">
                      {CONTACT_KIND_NAMES[link.kind]}
                      {link.label !== null && ` · ${link.value}`}
                    </span>
                  </div>
                  <div class="relative -my-2 -mr-2 shrink-0">
                    <Dropdown
                      trigger={<IconEllipsisVertical class="size-5" />}
                      triggerLabel={`Actions for ${contactLinkText(link)}`}
                      triggerClasses={MENU_TRIGGER_CLASSES}
                      triggerDataE2E="contact-link-menu"
                    >
                      <DropdownItem
                        href={ADMIN_CONTACT_LINKS_PATHS.link(link.id)}
                        navigate={navigate}
                      >
                        Edit link
                      </DropdownItem>
                      {index > 0 && (
                        <DropdownItem
                          disabled={props.busy}
                          dataE2E="contact-link-up"
                          onClick={() => {
                            setFocusOn({ id: link.id, index })
                            props.onMove(link.id, -1)
                          }}
                        >
                          Move up
                        </DropdownItem>
                      )}
                      {index < links.length - 1 && (
                        <DropdownItem
                          disabled={props.busy}
                          dataE2E="contact-link-down"
                          onClick={() => {
                            setFocusOn({ id: link.id, index })
                            props.onMove(link.id, 1)
                          }}
                        >
                          Move down
                        </DropdownItem>
                      )}
                      <DropdownItem
                        danger
                        disabled={props.busy}
                        dataE2E="contact-link-remove"
                        onClick={() => setRemoving(link)}
                      >
                        Remove link
                      </DropdownItem>
                    </Dropdown>
                  </div>
                </li>
              ))}
            </ListCard>
          )}
      </Stack>
      {removing && links && (
        <RemoveDialog
          link={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setRemoving(null)
            setFocusOn({ id: removing.id, index: links.findIndex((l) => l.id === removing.id) })
            props.onRemove(removing)
          }}
        />
      )}
    </div>
  )
}

function RemoveDialog(
  { link, onCancel, onConfirm }: {
    link: ContactLinkRecord
    onCancel: () => void
    onConfirm: () => void
  },
): JSX.Element {
  return (
    <ConfirmDialog
      title={`Remove "${contactLinkText(link)}"?`}
      message={`The website stops showing this ${
        CONTACT_KIND_NAMES[link.kind]
      } link within a minute.`}
      confirmLabel="Remove link"
      cancelLabel="Cancel"
      tone="danger"
      dataE2E="contact-link-remove-dialog"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

/** What the editor's fields show. */
export interface ContactLinkFormValue {
  kind: ContactKind
  value: string
  label: string
}

/** The editor's errors: under the value, under the label, and for the form as a whole. */
export interface ContactLinkFormErrors {
  value?: string
  label?: string
  form?: string
}

export interface AdminContactLinkEditorScreenProps {
  /** The link as saved, or `null` on the create page. */
  link: ContactLinkRecord | null
  /** The link is still being read. */
  loading: boolean
  /** There is no link with this id. */
  notFound: boolean
  value: ContactLinkFormValue
  onChange: (value: ContactLinkFormValue) => void
  errors: ContactLinkFormErrors
  saving: boolean
  onSave: () => void
  /** Removes the link, after the operator confirms. */
  onRemove: () => void
  navigate?: Navigate
}

const BACK = { href: ADMIN_CONTACT_LINKS_PATHS.list, label: `Back to contact links` }

/**
 * One contact link on a page of its own, at `/contact-links/new` and `/contact-links/:id`: its
 * kind, its value and an optional label. The value's label and example follow the kind, and once
 * the value is valid the page names the link it opens. A refused field gets focus.
 */
export function AdminContactLinkEditorScreen(
  props: AdminContactLinkEditorScreenProps,
): JSX.Element {
  const { link, value, errors, navigate } = props
  const valueInput = useRef<HTMLInputElement>(null)
  const labelInput = useRef<HTMLInputElement>(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (errors.value) valueInput.current?.focus()
    else if (errors.label) labelInput.current?.focus()
  }, [errors.value, errors.label])

  if (props.notFound || (props.loading && !link)) {
    return (
      <Stack gap="xl">
        <PageHeader back={BACK} navigate={navigate} title="Contact link" />
        {props.notFound
          ? (
            <div data-e2e="contact-link-not-found">
              <ListEmpty
                title="This link does not exist"
                description="It may have been removed."
                action={
                  <Button href={BACK.href} navigate={navigate} variant="outline">
                    Back to contact links
                  </Button>
                }
              />
            </div>
          )
          : (
            <div role="status" aria-label="Loading the link">
              <LoadingSkeleton rows={2} class="max-w-md" />
            </div>
          )}
      </Stack>
    )
  }

  const field = VALUE_FIELDS[value.kind]
  const normalized = normalizeContactValue(value.kind, value.value)
  const opens = normalized !== `` && contactValueProblem(value.kind, normalized) === null
    ? contactHref(value.kind, normalized)
    : null
  return (
    <Stack gap="xl">
      <PageHeader
        back={BACK}
        navigate={navigate}
        title={link ? contactLinkText(link) : `New contact link`}
        titleDataE2E="contact-link-title"
        menu={link && (
          <DropdownItem
            danger
            onClick={() => setAsking(true)}
            dataE2E="contact-link-editor-remove"
          >
            Remove link
          </DropdownItem>
        )}
      />
      <ScreenForm pending={props.saving} onSubmit={props.onSave}>
        <Stack class="max-w-md">
          <Field id="contact-link-kind" label="Channel">
            <Select
              name="kind"
              data-e2e="contact-link-kind"
              value={value.kind}
              options={CONTACT_KINDS.map((kind) => ({
                value: kind,
                label: CONTACT_KIND_NAMES[kind],
              }))}
              onChange={(event) =>
                props.onChange({ ...value, kind: event.currentTarget.value as ContactKind })}
            />
          </Field>
          <Field
            id="contact-link-value"
            label={field.label}
            hint={opens ? `Opens ${opens}` : `Such as ${field.example}`}
            error={errors.value}
            required
          >
            <Input
              ref={valueInput}
              name="value"
              data-e2e="contact-link-value"
              autocomplete="off"
              inputMode={field.inputMode}
              value={value.value}
              onInput={(event) => props.onChange({ ...value, value: event.currentTarget.value })}
              required
            />
          </Field>
          <Field
            id="contact-link-label"
            label="Label (optional)"
            hint={`Shown instead of the value, such as "Order on ${
              CONTACT_KIND_NAMES[value.kind]
            }".`}
            error={errors.label}
          >
            <Input
              ref={labelInput}
              name="label"
              data-e2e="contact-link-label"
              autocomplete="off"
              maxLength={CONTACT_LABEL_MAX_LENGTH}
              value={value.label}
              onInput={(event) => props.onChange({ ...value, label: event.currentTarget.value })}
            />
          </Field>
          <ErrorState message={errors.form ?? null} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              href={BACK.href}
              navigate={navigate}
              variant="ghost"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              data-e2e="contact-link-save"
              busy={props.saving}
              busyLabel="Saving…"
            >
              {link ? `Save link` : `Add link`}
            </Button>
          </div>
        </Stack>
      </ScreenForm>
      {asking && link && (
        <RemoveDialog
          link={link}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false)
            props.onRemove()
          }}
        />
      )}
    </Stack>
  )
}
