/**
 * The admin app's group screens (#426), driven in a browser DOM (happy-dom): what the search and
 * the sort send, what the group's page offers to whom, what each confirmed action sends, and that
 * the person page links to their groups.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import {
  ADMIN_GROUP_NO_FILTER,
  type AdminGroupDetail,
  type AdminGroupFiles,
  type AdminGroupMember,
  type AdminGroupRow,
  GroupRole,
} from "@domain/groups"
import { type AdminUserDetail, DEFAULT_PREFERENCES, UserRole } from "@domain/identity"
import { AdminGroupsListScreen, type AdminGroupsListScreenProps } from "./admin-groups-list.tsx"
import {
  activityTone,
  AdminGroupScreen,
  type AdminGroupScreenProps,
  transferCandidates,
} from "./admin-groups-detail.tsx"
import { AdminUserScreen, type AdminUserScreenProps } from "./admin-user-screen.tsx"

const window = new Window({ url: `http://admin.localhost/` })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ``
  root = null
})

/** Renders `node`, into the same root when one is mounted already, as a prop change would. */
/** The operator's format, pinned, so dates read the same whatever the machine's locale. */
const FORMAT = createFormatters({ locale: `en-GB`, timeZone: `UTC`, hourCycle: null })

async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement(`div`)
    document.body.append(root)
  }
  await act(() =>
    render(<FormatContext.Provider value={FORMAT}>{node}</FormatContext.Provider>, root!)
  )
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function has(selector: string): boolean {
  return document.querySelector(selector) !== null
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent(`click`, { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** Presses the button whose text is `text` inside `scope`. */
async function press(scope: string, text: string): Promise<void> {
  const button = [...find(scope).querySelectorAll(`button`)]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`no button "${text}" in ${scope}`)
  await act(() => {
    button.dispatchEvent(
      new window.MouseEvent(`click`, { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest(`form`)!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent(`submit`, { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function focused(): string | null | undefined {
  const element = document.activeElement
  return element?.getAttribute(`data-e2e`) ?? element?.tagName
}

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`
const INVITATION_ID = `0199c3a0-0000-7000-8000-000000000002`

const family: AdminGroupRow = {
  id: GROUP_ID,
  name: `Family`,
  emoji: null,
  color: null,
  owner: { id: 42, name: `Ada Lovelace`, email: `ada@example.com` },
  memberCount: 3,
  noteCount: 12,
  planId: `free`,
  createdAt: `2026-10-01T10:00:00.000Z`,
  lastActivityAt: `2026-10-14T10:00:00.000Z`,
  deletedAt: null,
}

function listProps(calls: unknown[][], props: Partial<AdminGroupsListScreenProps> = {}) {
  return {
    filter: ADMIN_GROUP_NO_FILTER,
    list: { groups: [family], total: 30, page: 1, pageSize: 25 },
    pending: false,
    error: null,
    onSearch: (filter) => void calls.push([`search`, filter]),
    onPage: (page) => void calls.push([`page`, page]),
    ...props,
  } satisfies AdminGroupsListScreenProps
}

describe(`the admin group list`, () => {
  it(`sends the typed words back on page 1, keeping the status and the sort`, async () => {
    const calls: unknown[][] = []
    const filter = {
      ...ADMIN_GROUP_NO_FILTER,
      status: `active` as const,
      sort: [{ key: `name` as const, direction: `asc` as const }],
      page: 3,
    }
    await mount(<AdminGroupsListScreen {...listProps(calls, { filter })} />)

    find<HTMLInputElement>(`[data-e2e=admin-groups-search]`).value = `  ada  `
    await submit(`[data-e2e=admin-groups-submit]`)
    expect(calls).toEqual([[`search`, { ...filter, query: `ada`, page: 1 }]])
  })

  it(`filters by a pressed status chip at once and drops it when pressed again`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupsListScreen {...listProps(calls)} />)
    await press(`[data-e2e=admin-groups-status]`, `In trash`)
    await mount(
      <AdminGroupsListScreen
        {...listProps(calls, { filter: { ...ADMIN_GROUP_NO_FILTER, status: `deleted` } })}
      />,
    )
    await press(`[data-e2e=admin-groups-status]`, `In trash`)
    expect(calls).toEqual([
      [`search`, { ...ADMIN_GROUP_NO_FILTER, status: `deleted`, page: 1 }],
      [`search`, { ...ADMIN_GROUP_NO_FILTER, status: `any`, page: 1 }],
    ])
  })

  it(`sorts by a pressed column alone while the list is in its default order`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupsListScreen {...listProps(calls)} />)
    await press(`[data-e2e=admin-groups-list] thead`, `Members`)
    expect(calls).toEqual([[`search`, {
      ...ADMIN_GROUP_NO_FILTER,
      sort: [{ key: `memberCount`, direction: `asc` }],
      page: 1,
    }]])
  })

  it(`links each group to its page, with its owner and counts, and marks one in the trash`, async () => {
    const trashed = { ...family, id: INVITATION_ID, deletedAt: `2026-10-15T10:00:00.000Z` }
    await mount(
      <AdminGroupsListScreen
        {...listProps([], { list: { groups: [family, trashed], total: 2, page: 1, pageSize: 25 } })}
      />,
    )
    expect(find(`[data-e2e=admin-group-${GROUP_ID}]`).getAttribute(`href`)).toBe(
      `/groups/${GROUP_ID}`,
    )
    const rows = document.querySelectorAll(`[data-e2e=admin-groups-list] tbody tr`)
    expect(rows[0].textContent).toContain(`Ada Lovelace`)
    expect(rows[0].textContent).toContain(`12`)
    expect(rows[0].querySelector(`[data-e2e=admin-group-deleted]`) === null).toBe(true)
    expect(rows[1].querySelector(`[data-e2e=admin-group-deleted]`) !== null).toBe(true)
  })

  it(`keeps a long owner name on one line, with the full name in its tooltip`, async () => {
    const long = `${`a`.repeat(60)}@example.com`
    const nameless = { ...family, owner: { id: 7, name: ``, email: long } }
    await mount(
      <AdminGroupsListScreen
        {...listProps([], { list: { groups: [nameless], total: 1, page: 1, pageSize: 25 } })}
      />,
    )
    const owner = find(`[data-e2e=admin-groups-owner]`)
    expect(owner.textContent).toBe(long)
    expect(owner.getAttribute(`title`)).toBe(long)
    expect(owner.classList.contains(`truncate`)).toBe(true)
  })

  it(`names each owner in full as text in the group's cell for a phone, with no tooltip`, async () => {
    const long = `${`a`.repeat(60)}@example.com`
    const nameless = { ...family, id: INVITATION_ID, owner: { id: 7, name: ``, email: long } }
    await mount(
      <AdminGroupsListScreen
        {...listProps([], {
          list: { groups: [family, nameless], total: 2, page: 1, pageSize: 25 },
        })}
      />,
    )
    const cells = [...document.querySelectorAll(`[data-e2e=admin-groups-list] tbody tr`)]
      .map((row) => row.querySelector(`td`)!.querySelector(`[data-e2e=admin-groups-owner-phone]`)!)
    // Shown only below 640px, where the owner column is hidden.
    expect(cells.map((cell) => cell.classList.contains(`sm:hidden`))).toEqual([true, true])
    expect(cells.map((cell) => [...cell.children].map((line) => line.textContent))).toEqual([
      [`Owner: Ada Lovelace`, `ada@example.com`],
      // An owner with no name is named by their address, once.
      [`Owner: ${long}`],
    ])
    expect(cells.some((cell) => cell.querySelector(`[title]`) !== null)).toBe(false)
    expect(cells.some((cell) => cell.querySelector(`.truncate`) !== null)).toBe(false)
  })

  it(`moves focus to the count after a page change, not on the first page`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupsListScreen {...listProps(calls)} />)
    expect(focused()).not.toBe(`admin-groups-count`)
    await mount(
      <AdminGroupsListScreen
        {...listProps(calls, { list: { groups: [family], total: 30, page: 2, pageSize: 25 } })}
      />,
    )
    expect(focused()).toBe(`admin-groups-count`)
  })

  it(`shows a loading state, the API's message when it fails, and an empty one`, async () => {
    await mount(<AdminGroupsListScreen {...listProps([], { list: null })} />)
    expect(has(`[role=status][aria-label='Loading groups']`)).toBe(true)

    await mount(<AdminGroupsListScreen {...listProps([], { list: null, error: `It is down` })} />)
    expect(has(`[role=status][aria-label='Loading groups']`)).toBe(false)
    expect(document.body.textContent).toContain(`It is down`)

    await mount(
      <AdminGroupsListScreen
        {...listProps([], { list: { groups: [], total: 0, page: 1, pageSize: 25 } })}
      />,
    )
    expect(document.body.textContent).toContain(`No group matches`)
  })
})

const owner: AdminGroupMember = {
  id: 42,
  name: `Ada Lovelace`,
  email: `ada@example.com`,
  role: GroupRole.OWNER,
  userRole: UserRole.VIEWER,
  blocked: false,
  joinedAt: `2026-10-01T10:00:00.000Z`,
}
const editor: AdminGroupMember = {
  ...owner,
  id: 43,
  name: `Grace Hopper`,
  email: `grace@example.com`,
  role: GroupRole.EDITOR,
}
const colleague: AdminGroupMember = {
  ...owner,
  id: 44,
  name: `Alan Turing`,
  email: `alan@example.com`,
  role: GroupRole.ADMIN,
  userRole: UserRole.OPERATOR,
}

const detail: AdminGroupDetail = {
  group: family,
  counts: {
    notes: 12,
    deletedNotes: 2,
    tags: 4,
    pendingInvitations: 1,
    files: 2,
    fileBytes: 2_500_000,
  },
  billing: null,
  members: [owner, colleague, editor],
  invitations: [
    {
      id: INVITATION_ID,
      role: GroupRole.EDITOR,
      email: `bob@example.com`,
      uses: 0,
      maxUses: 1,
      state: `pending`,
      createdBy: { id: 42, name: `Ada Lovelace`, email: `ada@example.com` },
      createdAt: `2026-10-10T10:00:00.000Z`,
      expiresAt: `2026-10-20T10:00:00.000Z`,
    },
    {
      id: `0199c3a0-0000-7000-8000-000000000003`,
      role: GroupRole.VIEWER,
      email: null,
      uses: 1,
      maxUses: 1,
      state: `used`,
      createdBy: null,
      createdAt: `2026-10-09T10:00:00.000Z`,
      expiresAt: `2026-10-19T10:00:00.000Z`,
    },
  ],
  activity: [{
    id: `0199c3a0-0000-7000-8000-000000000004`,
    kind: `group.member_removed`,
    at: `2026-10-14T10:00:00.000Z`,
    actor: { userId: 7, name: `Olga Operator` },
    target: { userId: 45, name: `Bob Builder` },
    details: { role: GroupRole.EDITOR },
    byOperator: true,
  }],
  imported: null,
}

const operator = { id: 7, role: UserRole.OPERATOR }
const supervisor = { id: 7, role: UserRole.SUPERVISOR }

const FILE_ID = `0199c3a0-0000-7000-8000-000000000005`
const IMAGE_ID = `0199c3a0-0000-7000-8000-000000000006`
const LONG_TITLE = `Receipts from the whole summer trip to Lisbon and Porto, scanned`
const files: AdminGroupFiles = {
  files: [
    {
      id: FILE_ID,
      name: `receipt.pdf`,
      contentType: `application/pdf`,
      size: 1_500_000,
      uploader: { id: 43, name: `Grace Hopper`, email: `grace@example.com` },
      createdAt: `2026-10-12T10:00:00.000Z`,
      noteTitle: LONG_TITLE,
      noteDeleted: false,
    },
    {
      id: IMAGE_ID,
      name: `IMG_0001.png`,
      contentType: `image/png`,
      size: 1_000_000,
      uploader: null,
      createdAt: `2026-10-11T10:00:00.000Z`,
      noteTitle: ``,
      noteDeleted: true,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
  query: ``,
  usage: { files: 2, bytes: 2_500_000, maxFiles: 100, maxBytes: 200 * 1024 * 1024 },
}

function groupProps(calls: unknown[][], props: Partial<AdminGroupScreenProps> = {}) {
  return {
    detail,
    error: null,
    files,
    filesError: null,
    fileFilter: { query: ``, page: 1 },
    onFileFilter: (filter) => void calls.push([`filter`, filter]),
    onRetryFiles: () => void calls.push([`retry`]),
    onDownloadFile: (file) => void calls.push([`download`, file.id]),
    fileNotice: null,
    operator,
    tab: `members`,
    onTab: (tab) => void calls.push([`tab`, tab]),
    dialog: null,
    onOpenDialog: (dialog) => void calls.push([`open`, dialog]),
    onCloseDialog: () => void calls.push([`close`]),
    actionError: null,
    pending: false,
    onAction: (action) => void calls.push([`action`, action]),
    ...props,
  } satisfies AdminGroupScreenProps
}

describe(`one group in the admin app`, () => {
  it(`shows the group, its owner and its counts in a header card, and no content`, async () => {
    await mount(<AdminGroupScreen {...groupProps([])} />)

    expect(find(`[data-e2e=admin-group-title]`).textContent).toBe(`Family`)
    expect(find(`[data-e2e=admin-group-owner]`).getAttribute(`href`)).toBe(`/users/42`)
    const counts = find(`[data-e2e=admin-group-counts]`).textContent
    expect(counts).toContain(`12`)
    expect(counts).toContain(`2 in trash`)
    expect(find(`[data-e2e=admin-group-status]`).textContent).toBe(`Active`)
  })

  it(`says when a group was made from an export file and who imported it, and nothing for one created empty`, async () => {
    await mount(<AdminGroupScreen {...groupProps([])} />)
    expect(has(`[data-e2e=admin-group-imported]`)).toBe(false)
    await act(() => render(null, root!))
    const imported = {
      ...detail,
      imported: {
        at: `2026-10-21T09:00:00.000Z`,
        by: { id: 45, name: `Bob Builder`, email: `bob@example.com` },
      },
    }
    await mount(<AdminGroupScreen {...groupProps([], { detail: imported })} />)
    const fact = find(`[data-e2e=admin-group-imported]`)
    expect(fact.closest(`[data-e2e=admin-group-counts]`)).not.toBe(null)
    expect(fact.textContent).toContain(`by Bob Builder`)
    expect(fact.querySelector(`a`)?.getAttribute(`href`)).toBe(`/users/45`)
  })

  it(`links a group with a subscription to its customer in Billing, and a free one nowhere`, async () => {
    await mount(<AdminGroupScreen {...groupProps([])} />)
    expect(has(`[data-e2e=admin-group-billing]`)).toBe(false)
    await act(() => render(null, root!))
    const paying = {
      ...detail,
      billing: {
        planId: `pro`,
        status: 2,
        currentPeriodEnd: `2026-11-04T00:00:00.000Z`,
        cancelAtPeriodEnd: false,
      },
    }
    await mount(<AdminGroupScreen {...groupProps([], { detail: paying })} />)
    expect(find(`[data-e2e=admin-group-billing]`).getAttribute(`href`))
      .toBe(`/billing/${family.id}`)
  })

  it(`draws the counts as plain facts, with no bordered box but badges inside the header card`, async () => {
    await mount(<AdminGroupScreen {...groupProps([])} />)
    const card = find(`[data-e2e=admin-group-card]`)
    const boxed = [...card.querySelectorAll(`*`)].map((element) => element.className).filter((
      name,
    ) =>
      /(^| )border( |$)/.test(name) && /rounded-(?!full)/.test(name) && !/inline-flex/.test(name)
    )

    expect(boxed).toEqual([])
    expect(find(`[data-e2e=admin-group-counts]`).tagName).toBe(`DL`)
  })

  it(`shows members with their roles, invitations with their states, and the activity`, async () => {
    const shown = async (tab: string, selector: string) => {
      await mount(<AdminGroupScreen {...groupProps([], { tab })} />)
      return find(`[role=tabpanel] ${selector}`)
    }
    const members = await shown(`members`, `[data-e2e=admin-group-members]`)
    expect(members.querySelector(`[data-e2e=admin-group-member-42]`)!.textContent).toContain(
      `Owner`,
    )
    expect(members.querySelector(`[data-e2e=admin-group-member-43]`)!.textContent).toContain(
      `Editor`,
    )
    expect(members.querySelector(`a[href='/users/43']`) !== null).toBe(true)

    const invitations = await shown(`invitations`, `[data-e2e=admin-group-invitations]`)
    const states = [...invitations.querySelectorAll(`[data-e2e=admin-group-invitation-state]`)]
      .map((state) => state.textContent)
    expect(states).toEqual([`Pending`, `Used`])
    expect(invitations.textContent).toContain(`Link anyone can use`)

    const activity = await shown(`activity`, `[data-e2e=admin-group-activity]`)
    expect(activity.textContent).toContain(`Bob Builder`)
    expect(activity.textContent).toContain(`By an operator`)
  })

  it(`names each file with its kind, size, uploader, date and note, and a thumbnail for an image`, async () => {
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files` })} />)
    const list = find(`[role=tabpanel] [data-e2e=admin-group-files] ul[aria-label=Files]`)
    const [pdf, image] = [...list.querySelectorAll(`li`)]
    const pdfButton = pdf.querySelector(`button`)!
    expect(pdfButton.getAttribute(`aria-label`)).toBe(`Download receipt.pdf`)
    expect(pdf.textContent).toContain(
      `PDF · 1.4 MB · Grace Hopper · 12 Oct 2026 · ` +
        `in “Receipts from the whole summer trip to Lisbon an…”`,
    )
    expect(pdf.querySelector(`img`)).toBe(null)
    expect(image.querySelector(`button`)!.getAttribute(`aria-label`)).toBe(`Open IMG_0001.png`)
    expect(image.textContent).toContain(`A deleted account`)
    expect(image.textContent).toContain(`in an untitled note (in trash)`)
    expect(image.querySelector(`img`)!.getAttribute(`src`)).toBe(
      `/api/admin/groups/${GROUP_ID}/files/${IMAGE_ID}/thumbnail`,
    )
    expect(find(`[data-e2e=admin-group-files-count]`).textContent).toBe(`2 files`)
    expect(find(`[data-e2e=admin-group-files-usage]`).textContent).toBe(
      `2 of 100 files · 2.4 MB of 200 MB`,
    )
    expect(find(`[data-e2e=admin-group-counts]`).textContent).toContain(`Files2 · 2.4 MB`)
  })

  it(`searches by the typed name, trimmed, on page 1`, async () => {
    const calls: unknown[][] = []
    const filter = { query: `old`, page: 3 }
    await mount(<AdminGroupScreen {...groupProps(calls, { tab: `files`, fileFilter: filter })} />)
    const field = find<HTMLInputElement>(`[role=search] input[type=search]`)
    expect(find(`label[for=${field.id}]`).textContent).toBe(`File name`)
    expect(field.value).toBe(`old`)
    field.value = `  receipt `
    await submit(`[data-e2e=admin-group-files-submit]`)
    expect(calls).toEqual([[`filter`, { query: `receipt`, page: 1 }]])
  })

  it(`says how many files match a search, and that none do with a way out`, async () => {
    const one = { ...files, files: [files.files[0]], total: 1, query: `receipt` }
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files`, files: one })} />)
    expect(find(`[role=status][data-e2e=admin-group-files-count]`).textContent).toBe(
      `1 file matches “receipt”`,
    )
    const none = { ...files, files: [], total: 0, query: `xyz` }
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files`, files: none })} />)
    expect(find(`[data-e2e=admin-group-files-count]`).textContent).toBe(`No files match “xyz”`)
    const empty = find(`[data-e2e=admin-group-files]`).textContent
    expect(empty).toContain(`No files match`)
    expect(empty).toContain(`Try part of the name, or clear the search.`)
    expect(has(`[role=search]`)).toBe(true)
  })

  it(`pages the files, keeping the search, and moves focus to the count after a page change`, async () => {
    const calls: unknown[][] = []
    const many = { ...files, total: 60, query: `img` }
    await mount(<AdminGroupScreen {...groupProps(calls, { tab: `files`, files: many })} />)
    expect(focused()).not.toBe(`admin-group-files-count`)
    find(`nav[aria-label='Pages of files']`)
    await press(`nav[aria-label='Pages of files']`, `Next`)
    expect(calls).toEqual([[`filter`, { query: `img`, page: 2 }]])
    await mount(
      <AdminGroupScreen {...groupProps(calls, { tab: `files`, files: { ...many, page: 2 } })} />,
    )
    expect(focused()).toBe(`admin-group-files-count`)
  })

  it(`draws no pages when one page holds every file`, async () => {
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files` })} />)
    expect(has(`nav[aria-label='Pages of files']`)).toBe(false)
  })

  it(`shows only "No files yet." and the room in a group with no file: nothing to search`, async () => {
    const empty = {
      ...files,
      files: [],
      total: 0,
      usage: { files: 0, bytes: 0, maxFiles: null, maxBytes: null },
    }
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files`, files: empty })} />)
    expect(find(`[data-e2e=admin-group-files]`).textContent).toContain(`No files yet.`)
    expect(has(`[role=search]`)).toBe(false)
    expect(has(`[data-e2e=admin-group-files-count]`)).toBe(false)
    expect(find(`[data-e2e=admin-group-files-usage]`).textContent).toBe(`0 files · 0 B`)
  })

  it(`downloads a file from its row and from its menu`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupScreen {...groupProps(calls, { tab: `files` })} />)
    await click(`button[aria-label='Download receipt.pdf']`)
    await click(`button[aria-label='Actions for IMG_0001.png']`)
    await press(`[data-e2e=admin-group-files] li:nth-child(2)`, `Download`)
    expect(calls).toEqual([[`download`, FILE_ID], [`download`, IMAGE_ID]])
  })

  it(`removes a file from its menu, names it in the dialog, and offers no removal in the trash`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupScreen {...groupProps(calls, { tab: `files` })} />)
    await click(`button[aria-label='Actions for receipt.pdf']`)
    await press(`[data-e2e=admin-group-files] li:nth-child(1)`, `Remove file`)
    await mount(
      <AdminGroupScreen
        {...groupProps(calls, { tab: `files`, dialog: { kind: `removeFile`, fileId: FILE_ID } })}
      />,
    )
    const dialog = find(`[data-e2e=admin-group-dialog]`).textContent
    expect(dialog).toContain(`Remove “receipt.pdf”?`)
    expect(dialog).toContain(`The members of Family will no longer see it.`)
    await submit(`[data-e2e=admin-group-action-submit]`)
    expect(calls).toEqual([
      [`open`, { kind: `removeFile`, fileId: FILE_ID }],
      [`action`, { kind: `removeFile`, fileId: FILE_ID }],
    ])

    await act(() => render(null, root!))
    const trashed = { ...detail, group: { ...family, deletedAt: `2026-10-15T10:00:00.000Z` } }
    await mount(<AdminGroupScreen {...groupProps([], { detail: trashed, tab: `files` })} />)
    await click(`button[aria-label='Actions for receipt.pdf']`)
    const menu = find(`[data-e2e=admin-group-files] li:nth-child(1)`).textContent
    expect(menu).toContain(`Download`)
    expect(menu).not.toContain(`Remove file`)
  })

  it(`moves focus to the next file's menu once a removed file leaves the list`, async () => {
    const removing = { dialog: { kind: `removeFile`, fileId: FILE_ID } as const, pending: true }
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files`, ...removing })} />)
    const rest = { ...files, files: [files.files[1]], total: 1 }
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files`, files: rest })} />)
    expect(document.activeElement?.getAttribute(`aria-label`)).toBe(`Actions for IMG_0001.png`)
  })

  it(`moves focus to the search field when a removal leaves no file that matches`, async () => {
    const removing = { dialog: { kind: `removeFile`, fileId: FILE_ID } as const, pending: true }
    const filter = { query: `receipt`, page: 1 }
    const found = { ...files, files: [files.files[0]], total: 1, query: `receipt` }
    await mount(
      <AdminGroupScreen
        {...groupProps([], { tab: `files`, files: found, fileFilter: filter, ...removing })}
      />,
    )
    const none = { ...found, files: [], total: 0 }
    await mount(
      <AdminGroupScreen {...groupProps([], { tab: `files`, files: none, fileFilter: filter })} />,
    )
    expect(document.activeElement?.id).toBe(`admin-group-files-q`)
  })

  it(`moves focus to the empty state when a removal takes the group's last file`, async () => {
    const removing = { dialog: { kind: `removeFile`, fileId: FILE_ID } as const, pending: true }
    const last = { ...files, files: [files.files[0]], total: 1 }
    await mount(
      <AdminGroupScreen {...groupProps([], { tab: `files`, files: last, ...removing })} />,
    )
    const gone = { ...last, files: [], total: 0, usage: { ...last.usage, files: 0 } }
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files`, files: gone })} />)
    const focused = document.activeElement
    expect(focused?.getAttribute(`tabindex`)).toBe(`-1`)
    expect(focused?.querySelector(`[data-e2e=admin-group-files]`)?.textContent).toContain(
      `No files yet.`,
    )
  })

  it(`keeps the search while the files load, and offers a retry when they fail`, async () => {
    const calls: unknown[][] = []
    const filter = { query: `receipt`, page: 1 }
    await mount(
      <AdminGroupScreen
        {...groupProps(calls, { tab: `files`, files: null, fileFilter: filter })}
      />,
    )
    expect(has(`[role=status][aria-label='Loading the files']`)).toBe(true)
    expect(find<HTMLInputElement>(`[role=search] input`).value).toBe(`receipt`)
    expect(find(`[data-e2e=admin-group-files-submit]`).textContent).toContain(`Searching…`)
    await mount(
      <AdminGroupScreen
        {...groupProps(calls, { tab: `files`, files: null, filesError: `Network down` })}
      />,
    )
    expect(find(`[data-e2e=admin-group-files-error]`).textContent).toContain(
      `Could not load the files. Check your connection, then try again.`,
    )
    expect(has(`[role=search]`)).toBe(true)
    await press(`[data-e2e=admin-group-files-error]`, `Try again`)
    expect(calls).toEqual([[`retry`]])
  })

  it(`shows why a download failed above the list`, async () => {
    const notice = `This file is gone. Someone may have removed it already.`
    await mount(<AdminGroupScreen {...groupProps([], { tab: `files`, fileNotice: notice })} />)
    expect(find(`[data-e2e=admin-group-file-notice]`).textContent).toContain(notice)
  })

  it(`colours what removes access as a warning and what adds it as good news`, () => {
    expect(activityTone(`group.member_removed`)).toBe(`warning`)
    expect(activityTone(`group.invitation_revoked`)).toBe(`warning`)
    expect(activityTone(`group.invitation_accepted`)).toBe(`success`)
    expect(activityTone(`group.renamed`)).toBe(`neutral`)
  })

  it(`asks the app to open a tab when it is pressed`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupScreen {...groupProps(calls)} />)
    await press(`[role=tablist]`, `Activity`)
    expect(calls).toEqual([[`tab`, `activity`]])
  })

  it(`offers removal only for a lower-ranked member who is not the owner`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupScreen {...groupProps(calls)} />)

    const menu = (id: number) =>
      find(`[data-e2e=admin-group-member-${id}]`).querySelector(
        `[data-e2e=admin-group-member-menu]`,
      )
    expect(menu(42) === null).toBe(true)
    expect(menu(44) === null).toBe(true)
    expect(menu(43) !== null).toBe(true)
    await click(`[data-e2e=admin-group-member-43] [data-e2e=admin-group-remove-open]`)
    expect(calls).toEqual([[`open`, { kind: `remove`, userId: 43 }]])
  })

  it(`offers revoking a pending invitation only, and opens its dialog`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupScreen {...groupProps(calls, { tab: `invitations` })} />)

    expect(document.querySelectorAll(`[data-e2e=admin-group-revoke-open]`).length).toBe(1)
    await click(`[data-e2e=admin-group-revoke-open]`)
    expect(calls).toEqual([[`open`, { kind: `revoke`, invitationId: INVITATION_ID }]])
  })

  it(`offers no action on a group in the trash`, async () => {
    const trashed = { ...detail, group: { ...family, deletedAt: `2026-10-15T10:00:00.000Z` } }
    await mount(<AdminGroupScreen {...groupProps([], { detail: trashed, operator: supervisor })} />)
    expect(has(`[data-e2e=admin-group-remove-open]`)).toBe(false)
    expect(has(`[data-e2e=admin-group-transfer-open]`)).toBe(false)
    expect(has(`[data-e2e=admin-group-deleted-notice]`)).toBe(true)

    await mount(
      <AdminGroupScreen
        {...groupProps([], { detail: trashed, operator: supervisor, tab: `invitations` })}
      />,
    )
    expect(has(`[data-e2e=admin-group-revoke-open]`)).toBe(false)
  })

  it(`offers the transfer to a supervisor, not to an operator`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminGroupScreen {...groupProps(calls)} />)
    expect(has(`[data-e2e=admin-group-transfer-open]`)).toBe(false)

    await mount(<AdminGroupScreen {...groupProps(calls, { operator: supervisor })} />)
    await click(`[data-e2e=admin-group-transfer-open]`)
    expect(calls).toEqual([[`open`, { kind: `transfer` }]])
  })

  it(`hands the group only to a member the operator outranks, never to the owner or to themselves`, () => {
    const self = { ...editor, id: 7, userRole: UserRole.SUPERVISOR }
    expect(transferCandidates(supervisor, [owner, colleague, editor, self]).map((m) => m.id))
      .toEqual([44, 43])
    expect(transferCandidates(operator, [owner, colleague, editor]).map((m) => m.id))
      .toEqual([43])
  })

  it(`confirms a removal and a revocation without asking for a password`, async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminGroupScreen {...groupProps(calls, { dialog: { kind: `remove`, userId: 43 } })} />,
    )
    expect(find(`[data-e2e=admin-group-dialog]`).textContent).toContain(`Remove Grace Hopper?`)
    expect(has(`[data-e2e=admin-group-dialog] input`)).toBe(false)
    await submit(`[data-e2e=admin-group-action-submit]`)

    await mount(
      <AdminGroupScreen
        {...groupProps(calls, { dialog: { kind: `revoke`, invitationId: INVITATION_ID } })}
      />,
    )
    await submit(`[data-e2e=admin-group-action-submit]`)
    expect(calls).toEqual([
      [`action`, { kind: `remove`, userId: 43 }],
      [`action`, { kind: `revoke`, invitationId: INVITATION_ID }],
    ])
  })

  it(`sends the picked member as the new owner, and nothing before one is picked`, async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminGroupScreen
        {...groupProps(calls, { operator: supervisor, dialog: { kind: `transfer` } })}
      />,
    )
    await submit(`[data-e2e=admin-group-action-submit]`)
    expect(calls).toEqual([])

    const choice = find<HTMLInputElement>(`[data-e2e=admin-group-dialog] input[value='44']`)
    choice.checked = true
    await submit(`[data-e2e=admin-group-action-submit]`)
    expect(calls).toEqual([[`action`, { kind: `transfer`, userId: 44 }]])
  })

  it(`shows why the API refused the action inside its dialog`, async () => {
    const message = `This is the only group of that person`
    await mount(
      <AdminGroupScreen
        {...groupProps([], { dialog: { kind: `remove`, userId: 43 }, actionError: message })}
      />,
    )
    expect(find(`[data-e2e=admin-group-dialog]`).textContent).toContain(message)
  })

  it(`shows a loading state until the group comes, and the API's message when it fails`, async () => {
    await mount(<AdminGroupScreen {...groupProps([], { detail: null })} />)
    expect(has(`[role=status][aria-label='Loading the group']`)).toBe(true)

    await mount(<AdminGroupScreen {...groupProps([], { detail: null, error: `No such group` })} />)
    expect(find(`[data-e2e=admin-group-error]`).textContent).toContain(`No such group`)
  })
})

describe(`the person page's groups`, () => {
  it(`links each of the person's groups to its page in the admin app`, async () => {
    const person: AdminUserDetail = {
      user: {
        id: 42,
        firstName: `Ada`,
        lastName: `Lovelace`,
        email: `ada@example.com`,
        role: UserRole.VIEWER,
        blockedAt: null,
        createdAt: `2026-10-01T10:00:00.000Z`,
        lastSeenAt: null,
      },
      methods: [],
      sessions: [],
      groups: [{ id: GROUP_ID, name: `Family`, role: GroupRole.OWNER }],
      audits: [],
      trialUsedAt: null,
      preferences: {
        value: DEFAULT_PREFERENCES,
        version: 0,
        updatedAt: null,
        firstTimeZone: null,
      },
    }
    const props: AdminUserScreenProps = {
      detail: person,
      error: null,
      operator,
      tab: `groups`,
      onTab: () => {},
      dialog: null,
      onOpenDialog: () => {},
      onCloseDialog: () => {},
      actionError: null,
      pending: false,
      onAction: () => {},
    }
    await mount(<AdminUserScreen {...props} />)
    expect(find(`[data-e2e=admin-user-group-${GROUP_ID}]`).getAttribute(`href`)).toBe(
      `/groups/${GROUP_ID}`,
    )
  })
})
