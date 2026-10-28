import type { JSX } from "preact"
import { IconCheck, IconChevronDown, IconList, IconPlus } from "@spy4x/preact-icons"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { Link } from "@spy4x/preact-ui/link"
import { RailCell, railFocusRing } from "@spy4x/preact-system/rail"
import type { GroupColor, GroupRole } from "@domain/groups"
import { GroupMark } from "./group-appearance.tsx"
import { NEW_GROUP_PATH, roleName } from "./groups-screen.tsx"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAppText } from "./i18n.ts"
import { type Navigate, SCREEN_PATHS } from "./progressive.tsx"

/** One group of the switcher: its name, and the person's role in it. */
export interface PickerGroup {
  id: string
  name: string
  /** The group's colour and emoji, when it has them. */
  color?: GroupColor | null
  emoji?: string | null
  role: GroupRole
}

/** What `AppFrame` needs to show the switcher. */
export interface GroupPickerData {
  groups: readonly PickerGroup[]
  /** The person's selected group, or `null` before it is known or for a person with no groups. */
  selectedId: string | null
  /** Called with the group the person picked. */
  onSelect: (groupId: string) => void
}

/**
 * The group's mark in the switcher: its own colour and emoji, or its initial on a quiet tile when
 * it has neither, so every group has a mark and the names line up.
 */
function SwitcherMark({ group }: { group: PickerGroup }): JSX.Element {
  if (group.color || group.emoji) {
    return <GroupMark color={group.color} emoji={group.emoji} size="sm" />
  }
  return (
    <span
      class="flex size-5 shrink-0 items-center justify-center rounded-md border border-subtle bg-canvas text-xs font-semibold text-muted"
      aria-hidden="true"
    >
      {group.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

/** The switcher's accessible name: `Group: Home`, or the visible `Choose a group` without one. */
export function switcherLabel(t: Translator<string>, selected: PickerGroup | null): string {
  return selected ? t.t(`GroupPicker.label`, { name: selected.name }) : t.t(`GroupPicker.choose`)
}

/** The switcher's tooltip: the group's name and the person's role there, `Home · Owner`. */
export function switcherTip(t: Translator<string>, selected: PickerGroup | null): string {
  return selected
    ? t.t(`GroupPicker.tip`, { name: selected.name, role: roleName(t, selected.role) })
    : t.t(`GroupPicker.choose`)
}

/**
 * The current group in the rail's top zone: a 40 px tile with the group's mark or initial, never
 * filled with the accent, that opens a short menu of the person's groups. The current one is
 * checked (`menuitemradio`), each names the person's role there, and the menu ends with links to
 * all groups and to a new one. The tile is named `Group: Home`; its tooltip, the rail's own
 * (`RailCell`), says `Home · Owner`, and its focus ring is the rail's too. `Rail` places that
 * tooltip, so `AppFrame` returns this cell straight from its `switcher` render prop. On a phone
 * the sheet lists the groups instead ({@link GroupSheet}).
 */
export function GroupPicker(
  { groups, selectedId, onSelect, navigate }: GroupPickerData & { navigate?: Navigate },
): JSX.Element {
  const t = useAppText()
  const selected = groups.find((group) => group.id === selectedId) ?? null
  const tile =
    "flex size-10 items-center justify-center rounded-[var(--radius-primary,0.5rem)] border border-subtle bg-canvas text-sm font-semibold text-muted"
  return (
    <RailCell tip={switcherTip(t, selected)}>
      <Dropdown
        trigger={
          <span class={tile} aria-hidden="true">
            {selected
              ? (selected.color || selected.emoji
                ? <GroupMark color={selected.color} emoji={selected.emoji} />
                : selected.name.trim().charAt(0).toUpperCase())
              : <IconChevronDown class="size-5" />}
          </span>
        }
        triggerLabel={switcherLabel(t, selected)}
        triggerDataE2E="group-picker"
        triggerClasses={`flex size-12 cursor-pointer items-center justify-center rounded-[var(--radius-primary,0.5rem)] hover:bg-canvas ${railFocusRing}`}
        containerClasses="relative flex text-left"
        panelClasses="z-30 w-60 max-w-[calc(100vw-5rem)] left-[calc(100%+1.25rem)] top-0 mt-0"
        horizontal="left"
        vertical="down"
        menuLabel={t.t(`GroupPicker.menu`)}
      >
        {groups.map((group) => (
          <DropdownItem
            key={group.id}
            checked={group.id === selectedId}
            onClick={() => group.id !== selectedId && onSelect(group.id)}
            dataE2E={`group-picker-${group.id}`}
          >
            <SwitcherMark group={group} />
            <span class="min-w-0 flex-1 truncate" translate={false}>{group.name}</span>
            {/* A space, so a screen reader says "Home Owner", not "HomeOwner"; flex drops it. */}
            {" "}
            <span class="shrink-0 text-xs text-muted">{roleName(t, group.role)}</span>
          </DropdownItem>
        ))}
        {groups.length > 0 && <div role="separator" class="my-1 border-t border-subtle" />}
        <DropdownItem href={SCREEN_PATHS.groups} navigate={navigate} dataE2E="group-picker-all">
          {t.t(`GroupPicker.all`)}
        </DropdownItem>
        <DropdownItem href={NEW_GROUP_PATH} navigate={navigate} dataE2E="group-picker-new">
          {t.t(`GroupPicker.new`)}
        </DropdownItem>
      </Dropdown>
    </RailCell>
  )
}

const sheetRow =
  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-canvas"

/** "All groups" and "New group": rows like the sheet's own (Profile, Sign out), with an icon. */
const sheetLink = `${sheetRow} ${railFocusRing} font-medium text-muted hover:text-foreground`

/**
 * The groups in the phone's Account sheet: one row per group, the current one checked, then "All
 * groups" and "New group". Choosing a group selects it and closes the sheet, as a menu closes when
 * an item is chosen; the two links close it by leaving the page.
 */
export function GroupSheet(
  { groups, selectedId, onSelect, navigate }: GroupPickerData & { navigate?: Navigate },
): JSX.Element {
  const t = useAppText()
  return (
    <div class="flex flex-col gap-1" role="group" aria-labelledby="group-sheet-heading">
      <h3 id="group-sheet-heading" class="px-3 pt-1 text-xs font-medium text-muted">
        {t.t(`GroupPicker.sheetHeading`)}
      </h3>
      <ul class="flex flex-col gap-1">
        {groups.map((group) => {
          const current = group.id === selectedId
          return (
            <li key={group.id}>
              <button
                type="button"
                class={sheetRow}
                aria-current={current ? "true" : undefined}
                onClick={(event) => {
                  if (!current) onSelect(group.id)
                  event.currentTarget.closest("dialog")?.close()
                }}
                data-e2e={`group-sheet-${group.id}`}
              >
                <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                  {current && <IconCheck class="size-4 text-accent" />}
                </span>
                <SwitcherMark group={group} />
                <span class="min-w-0 flex-1 truncate font-medium" translate={false}>
                  {group.name}
                </span>{" "}
                <span class="shrink-0 text-xs text-muted">{roleName(t, group.role)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <ul class="flex flex-col gap-1">
        <li>
          <Link
            href={SCREEN_PATHS.groups}
            navigate={navigate}
            class={sheetLink}
            data-e2e="group-sheet-all"
          >
            <IconList class="size-6 shrink-0" aria-hidden="true" />
            {t.t(`GroupPicker.all`)}
          </Link>
        </li>
        <li>
          <Link
            href={NEW_GROUP_PATH}
            navigate={navigate}
            class={sheetLink}
            data-e2e="group-sheet-new"
          >
            <IconPlus class="size-6 shrink-0" aria-hidden="true" />
            {t.t(`GroupPicker.new`)}
          </Link>
        </li>
      </ul>
    </div>
  )
}
