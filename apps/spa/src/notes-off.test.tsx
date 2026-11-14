/**
 * The SPA with the notes example off (`SPA_NOTES=false`, docs/start-a-product.md): every piece that
 * could lead a person to the notes or tags is checked here, so one coming back fails this file.
 * The screens' own tests check what each draws with `notes={false}` (`libs/ui`).
 */
import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import type { User } from "@domain/identity"
import { GroupRole } from "@domain/groups"
import { NOTE_WIDGET_IDS } from "@domain/notes"
import { OVERVIEW_WIDGETS, overviewWidgets } from "@ui/overview-widgets.ts"
import { homePath, NOTE_PATHS, OVERVIEW_PATHS, readNext } from "@ui/progressive.tsx"
import { configureModules, notesOn, offlineNotes, offlineTags } from "./modules.ts"
import { loadRuntimeConfig } from "./runtime-config.ts"
import { AppShell } from "./views/AppShell.tsx"
import { type Landing, landingPath } from "./views/HomeView.tsx"
import { spaShortcutRows } from "./views/shortcuts.ts"
import { SPA_ROUTE_PATHS, spaRoutePaths } from "./views/spa-paths.ts"
import { groupsStore } from "./state/groups.ts"
import { selectionStore } from "./state/selection.ts"
import { newNoteStore } from "./state/new-note.ts"
import type { NotesDependencies } from "./state/notes.ts"
import type { TagsDependencies } from "./state/tags.ts"
import { createOnboardingStore } from "./state/onboarding.ts"
import { onboardingSteps, tourSteps } from "@ui/onboarding-card.tsx"
import { ENGLISH } from "@ui/i18n-testing.ts"
import { paletteCommands } from "@ui/palette-commands.ts"
import { OverviewView } from "./views/OverviewView.tsx"

/** An address of the notes example: the notes, the tags, or a group's old notes links. */
const NOTES_ADDRESS = /^\/(notes|tags)(\/|$)|^\/groups\/[^/]+\/notes/

afterEach(() => {
  configureModules({})
  groupsStore.reset()
})

/** `/config.json` answering `body`. */
function serving(body: string): typeof fetch {
  return (() => Promise.resolve(new Response(body))) as unknown as typeof fetch
}

describe("the notes switch", () => {
  it("is on unless the configuration says false or 0", async () => {
    const read = async (body: string) => {
      configureModules(await loadRuntimeConfig(serving(body)))
      return notesOn()
    }

    expect([await read(`{}`), await read(`{"notes":"true"}`)]).toEqual([true, true])
    expect([await read(`{"notes":"false"}`), await read(`{"notes":"0"}`)]).toEqual([false, false])
  })

  it("gives the notes and tags stores no device copy or queue while it is off", async () => {
    let asked = 0
    let online = 0
    const current = () => {
      asked++
      return null
    }
    const notesServer = {
      fetchPage: () => {
        online++
        return Promise.resolve({ notes: [], nextCursor: null })
      },
    } as unknown as NotesDependencies
    const tagsServer = {
      fetchList: () => {
        online++
        return Promise.resolve([])
      },
    } as unknown as TagsDependencies
    const read = async () => {
      await offlineNotes(notesServer, current).fetchPage(`g-1`, null)
      await offlineTags(tagsServer, current).fetchList(`g-1`)
    }
    await read()
    const askedOn = asked
    configureModules({ notes: false })

    await read()

    expect([askedOn, asked, online]).toEqual([2, 2, 4])
  })
})

describe("the SPA with the notes off", () => {
  it("routes no notes, tags or group notes address, and every address with the notes on", () => {
    expect(spaRoutePaths(true)).toEqual(SPA_ROUTE_PATHS)
    expect(SPA_ROUTE_PATHS.filter((path) => NOTES_ADDRESS.test(path)).length).toBe(8)
    expect(spaRoutePaths(false).filter((path) => NOTES_ADDRESS.test(path))).toEqual([])
    expect(spaRoutePaths(false)).toContain(`/overview`)
  })

  it("lands every signed-in person on the overview, never the notes", () => {
    const owner = { id: `g`, role: GroupRole.OWNER }
    const member = { id: `g`, role: GroupRole.VIEWER }
    const landings: Landing[] = [
      { signedIn: true, guest: false, groups: [owner], selectedGroupId: `g`, billing: null },
      { signedIn: true, guest: true, groups: null, selectedGroupId: null, billing: undefined },
      { signedIn: true, guest: false, groups: [member], selectedGroupId: `g`, billing: undefined },
      { signedIn: true, guest: false, groups: [], selectedGroupId: null, billing: undefined },
    ]

    const off = landings.map((landing) => landingPath({ ...landing, notes: false }))
    const on = landings.map((landing) => landingPath(landing))

    expect(off).toEqual(landings.map(() => OVERVIEW_PATHS.root))
    expect(on).toEqual(landings.map(() => NOTE_PATHS.list))
    expect(homePath(false)).toBe(OVERVIEW_PATHS.root)
  })

  it("sends a refused next to the overview, not the notes", () => {
    const next = new URLSearchParams(`next=%2F%2Fevil.example`)

    expect(readNext(next, homePath(false))).toBe(OVERVIEW_PATHS.root)
    expect(readNext(next)).toBe(NOTE_PATHS.list)
  })

  it("binds no note or tag shortcut: no n, Undo, g n, g t or New note dialog keys", () => {
    const ports = { navigate: () => {}, openShortcuts: () => {}, openNewNote: () => {} }
    const keys = (notes?: boolean) =>
      spaShortcutRows({ ...ports, activityGroupId: `g`, notes }).map((row) => row.keys)

    const gone = [`n`, `mod+z`, `g n`, `g t`, `enter`, `mod+enter`]
    expect(gone.filter((key) => keys().includes(key))).toEqual(gone)
    expect(gone.filter((key) => keys(false).includes(key))).toEqual([])
    expect(keys(false)).toContain(`g o`)
  })

  it("registers no note widget on the overview", () => {
    const notes = new Set<string>(Object.values(NOTE_WIDGET_IDS))

    expect(overviewWidgets().map((widget) => widget.id)).toEqual(
      OVERVIEW_WIDGETS.map((widget) => widget.id),
    )
    expect(overviewWidgets(false).filter((widget) => notes.has(widget.id))).toEqual([])
  })

  it("draws a shell with no notes or tags link and no New note dialog", () => {
    const draw = () =>
      renderToString(
        <Router ssrPath={OVERVIEW_PATHS.root}>
          <AppShell user={{ id: 7, firstName: `Ada`, lastName: `L` } as User} wsStatus="open">
            <p>page</p>
          </AppShell>
        </Router>,
      )
    groupsStore.groups.value = [
      { id: `g`, name: `Home`, role: GroupRole.OWNER } as typeof groupsStore.groups.value[number],
    ]
    selectionStore.groupId.value = `g`
    // Open, as after `n`: a closed dialog draws nothing to find.
    newNoteStore.open.value = true

    const on = draw()
    configureModules({ notes: false })
    const off = draw()
    const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])

    expect(hrefs(on).filter((href) => NOTES_ADDRESS.test(href)).length).toBeGreaterThan(0)
    expect(on).toContain(`data-e2e="new-note-dialog"`)
    expect(hrefs(off).filter((href) => NOTES_ADDRESS.test(href))).toEqual([])
    expect(off).not.toContain(`data-e2e="new-note-dialog"`)
    expect(hrefs(off)).toContain(OVERVIEW_PATHS.root)
    newNoteStore.open.value = false
  })
})

describe("the first steps with the notes off", () => {
  /** A new person's steps: none done. */
  const NONE = {
    emailVerified: false,
    noteCreated: false,
    memberInvited: false,
    notificationsOn: false,
    twoFactorOn: false,
  }

  /** A store whose fake server says the person is new: nothing done, nothing dismissed. */
  async function newPerson() {
    const fresh = { steps: NONE, dismissed: false, tourSeen: false }
    const store = createOnboardingStore({
      query: () => Promise.resolve(fresh) as Promise<never>,
      command: () => Promise.resolve(fresh) as Promise<never>,
    })
    await store.open()
    return store
  }

  /** The overview of group `g`, owned by the person, with the first steps from `onboarding`. */
  function overview(onboarding: ReturnType<typeof createOnboardingStore>): string {
    groupsStore.groups.value = [
      { id: `g`, name: `Home`, role: GroupRole.OWNER } as typeof groupsStore.groups.value[number],
    ]
    selectionStore.groupId.value = `g`
    return renderToString(
      <Router ssrPath={OVERVIEW_PATHS.group(`g`)}>
        <OverviewView groupId="g" onboarding={onboarding} />
      </Router>,
    )
  }

  it("draws them on the overview, with no note step, and leaves the overview alone with the notes on", async () => {
    const onboarding = await newPerson()

    const on = overview(onboarding)
    configureModules({ notes: false })
    const off = overview(onboarding)

    expect(on).not.toContain(`data-e2e="onboarding"`)
    // Under the page header and above the page's content, as above the notes list.
    const at = (e2e: string) => off.indexOf(`data-e2e="${e2e}"`)
    expect(at(`page-header`)).toBeLessThan(at(`onboarding`))
    expect(at(`onboarding`)).toBeLessThan(at(`overview-no-widgets`))
    expect(off).not.toContain(ENGLISH.t(`OnboardingCard.noteTitle`))
    expect(off).not.toContain(ENGLISH.t(`OnboardingCard.inviteText`))
    expect(off).toContain(ENGLISH.t(`OnboardingCard.inviteTextPlain`))
  })

  it("offers no step or tour stop that leads to the notes", () => {
    const steps = onboardingSteps(ENGLISH, NONE, `g`, undefined, false, false)
    const guest = onboardingSteps(ENGLISH, NONE, `g`, undefined, true, false)
    const hrefs = [...steps, ...guest].map((step) => step.action?.href ?? ``)
    const targets = tourSteps(ENGLISH, false).map((step) => String(step.target))

    expect(steps.map((step) => step.id)).not.toContain(`note`)
    expect(guest.map((step) => step.id)).toEqual([`keep`])
    expect(hrefs.filter((href) => NOTES_ADDRESS.test(href))).toEqual([])
    expect(targets.filter((target) => target.includes(`"${NOTE_PATHS.list}"`))).toEqual([])
    expect(tourSteps(ENGLISH).map((step) => step.target)).toContain(
      `[data-e2e="rail-shell-rail"] a[href="${NOTE_PATHS.list}"]`,
    )
  })
})

describe("the data export with the notes off", () => {
  it("says in the search palette that the file holds the profile and groups, not notes", () => {
    const detail = (notes?: boolean) =>
      paletteCommands({
        t: ENGLISH,
        locale: `en`,
        currentGroup: null,
        online: true,
        theme: () => `system`,
        shortcuts: [],
        activityGroupId: null,
        pageCommands: [],
        guest: false,
        benchmark: false,
        canInstall: false,
        notes,
      }, () => {}).find((option) => option.id === `action-download-data`)?.detail

    expect(detail()).toBe(`A ZIP of your profile, groups and notes`)
    expect(detail(false)).toBe(`A ZIP of your profile and groups`)
  })
})
