# Laying out a screen

How the SPA's screens arrange preact-components' primitives. The primitives themselves come from
spy4x/preact-components; this page is about placement, spacing and what stays out of sight. The
`libs/ui` contract in `AGENTS.md` still applies to every screen.

The rules came from the owner's review of the first screens: every form was open, every rare
action sat on the page at all times, cards nested inside cards and the spacing was uneven. The
screens were redesigned against these rules in October 2026.

## Principles

1. **One primary action per screen, visible.** Everything else is secondary (a quieter button) or
   supplementary (in an overflow menu, a dialog or a disclosure). Ask of each control: how often
   does a person need it? Daily → on the page. Monthly → one click away. Once or never → in a
   menu, or under a "Danger zone" disclosure at the bottom.
2. **Forms open when asked.** A "create" or "edit" form is closed until the person presses the
   button for it: a `Modal` for a short form (new group, invite someone, change password), or
   `InlineEdit` for one value (rename a group). A name is two fields, so the profile edits it in a
   `Modal`. The note editor is the exception: it is a page of its own, and that is fine.
3. **Hide what cannot happen.** Do not render a section that only explains why its action is
   unavailable ("You own this group, so you cannot leave it", "Nobody else is in this group yet").
   Leave the action out. When a person would otherwise not know the action exists, keep it as a
   disabled item in the overflow menu with a one-line reason beside it, such as "Delete group" with
   "It is your only group". Never put a disabled button on the page itself.
4. **Confirm destructive actions** with `ConfirmDialog` (delete, leave, remove a member, revoke). An
   action that needs the password again (transfer ownership, delete the account) uses a `Modal` with
   a password form and a danger-styled submit button instead. Never put a red button on the page
   next to everyday actions.
5. **Less chrome.** No card inside a card, no card around a single line, no dashed box inside a
   card. A list on its own is a list; a signed-in page's heading is its `PageHeader`, never a
   `CardHeader`. Use `Card` for a genuine group of related content, `Section` for a titled part of a
   page, `EmptyState` for an empty list (with its one action), `Stack`, `Cluster` and `Grid` for
   spacing. Space siblings with their `gap` rather than margins. Any spacing class must be a step on
   the theme's scale, which `tests/spacing.test.ts` enforces.
6. **One centred column.** Every signed-in page sits in one column of 48 rem, owned by `AppFrame`
   through `Page` (`max-w-3xl py-6 sm:py-8`); 64 rem (`max-w-5xl`) only for a data table, through
   `AppFrame`'s `wide`; signed-out pages 28 rem (`max-w-md`, `PublicFrame`). Screens never set
   their own width. Inputs never stretch across a wide column.
7. **One page header on every signed-in page** (`PageHeader` from `@spy4x/preact-ui/page-header`): the page
   title (h1) on the left; the primary action and, if needed, one overflow `Dropdown` ("More
   actions", a three-dots icon button with that accessible name) on the right. On a phone the title
   stays on one line, truncating if it must, and the actions stay beside it as icon buttons with
   accessible names — never stacked awkwardly under a two-line title. The signed-out screens
   (sign-in, sign-up, password reset, the newsletter) are a centred card with the `h1` inside its
   header instead.
8. **Mobile first.** Design the 375 px layout first; touch targets at least 44 px; nothing scrolls
   sideways. The desktop layout is the same content with more room, not a different screen.
9. **Status only when it matters.** "Online" in the header and "WS: open" on the profile are debug
   output. Show the connection only when it is not live (offline, reconnecting). Keep the
   `data-e2e="shell-ws-status"` element and its text for the e2e tests, visually hidden when online
   (a screen-reader-only span is fine: `toHaveText` reads text content).
10. **Badges carry meaning.** A green "Selected" pill on the current group is noise; show the
    current group by the picker and by a quiet check mark, not a loud badge.
11. **The header is the banner:** the brand (leading to Notes), the group switcher, then the bell
    and the account menu on the right. It is passed through `RailShell`'s `header`, so it sits
    outside `<main>` and the skip link jumps past it; it is never rendered inside `<main>`. The
    group switcher is a button showing the current group that opens a short menu of checked items
    (`DropdownItem checked`), not a text field. The account menu says who is signed in (name and
    address), then Profile, Notifications, the theme (System, Light, Dark) and Sign out.
12. **The rail holds the daily destinations,** at most five so the phone bar needs no "More": Notes,
    Tags, Activity, Groups, Profile. Activity is the selected group's log and is left out when there
    is no selected group or the person may not read its log. Notifications stay on the bell and in
    the account menu.

## Spacing rhythm

All on the theme scale (`tests/spacing.test.ts`):

- page padding `py-6 sm:py-8` (from `AppFrame`);
- `gap-8` between the page header and each top-level `Section` (`Page`'s own gap);
- `gap-4` inside a `Section`, between its title row and its content;
- `gap-2` inside a list or a card, or `divide-y` rows with `px-4 py-3 sm:px-6`.

The e-mail banner and any other notice above the page sit at the top of the same column, never in
a width of their own.

## Lists, chips and empty states

- **Lists** (notes, groups, members, tags, notifications, activity): one `Card` with
  `divide-y divide-subtle`; each row a full-width link or button, `min-h-14 px-4 py-3 sm:px-6`. The
  title is `font-medium` and wraps to two lines (`line-clamp-2`), never cut to one line on a phone;
  a meta line `text-sm text-muted` under it holds the time, tags and author. Row actions go in a
  per-row menu at the right. From `sm` the time may move to the right of the title.
- **Settings:** `SettingGroup` + `SettingList` + `SettingRow`, one treatment per page.
- **Chips** (a tag filter): `ToggleChips`, at least 44 px tall on a phone. A row of chips scrolls
  sideways on a phone (`overflow-x-auto`, `flex-nowrap`) rather than wrapping into many lines.
- **Empty states:** `EmptyState` inside the section's own `Card`, never a dashed box beside solid
  cards: one sentence on what goes here and one primary action.
- **Links inside rows** look like links (`text-accent underline-offset-2 hover:underline`), or the
  whole row is the link.
- **Primary buttons** are `w-full sm:w-auto` and sit at the right of a form's footer from `sm`.

## Build

The SPA's Tailwind build must see `libs/ui`, or every class only a screen uses silently disappears
(`libs/ui/sources.css` says why). The `requireComponentCss` guard in `apps/spa/vite.config.ts`
fails a build whose CSS lacks a class only `libs/ui` uses.

## Primitives to use

`Modal`, `ConfirmDialog`, `Dropdown` + `DropdownItem`, `InlineEdit`, `EmptyState`, `Notice`,
`Page`, `Section`, `Stack`, `Cluster`, `Grid`, `Card*`, `Badge`, `Avatar`, `AvatarGroup`, `Tabs`,
`Tooltip`, `CopyButton`, `Toastr`, `RailShell`, `Shell`. Read each one's signature on
`https://jsr.io/@spy4x/preact-ui/doc` (or `preact-system`) before using it. If a primitive falls
short, the fix belongs in `spy4x/preact-components`, not in a local copy: file an issue there and
work around it minimally until it ships.

Take screenshots of a changed screen at 1280 px and 375 px wide before you call it done, and look
at the phone one first.
