/**
 * The frames and the preferences in every language (#216), in a browser DOM (happy-dom).
 *
 * - The `en-XA` pseudo-language wraps every catalog message in `⟦ ⟧`: rendered in it, a screen
 *   shows no English outside those marks except data (a name, an address, a date). English left
 *   in the code, past the catalog, fails here.
 * - A new translator switches the words at once, with no reload: what the app does when the person
 *   picks another language.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { type ComponentChildren, render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { IconUsers } from "@spy4x/preact-icons"
import {
  type Catalog,
  createTranslator,
  pseudoLocalize,
  type Translator,
} from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import uiEn from "@spy4x/preact-ui/i18n/en"
import systemEn from "@spy4x/preact-system/i18n/en"
import uiDe from "@spy4x/preact-ui/i18n/de"
import systemDe from "@spy4x/preact-system/i18n/de"
import uiAr from "@spy4x/preact-ui/i18n/ar"
import systemAr from "@spy4x/preact-system/i18n/ar"
import appEn from "@i18n/app/en.json" with { type: "json" }
import appDe from "@i18n/app/de.json" with { type: "json" }
import appAr from "@i18n/app/ar.json" with { type: "json" }
import adminEn from "@i18n/admin/en.json" with { type: "json" }
import adminDe from "@i18n/admin/de.json" with { type: "json" }
import adminAr from "@i18n/admin/ar.json" with { type: "json" }
import { DEFAULT_PREFERENCES } from "@domain/identity"
import { AppFrame, PublicFrame } from "./frame.tsx"
import { AdminFrame, AdminShell } from "./admin-frame.tsx"
import {
  AdminPreferencesGroup,
  AppearanceSection,
  type PreferencesProps,
  RegionSection,
} from "./preferences.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    HTMLElement: window.HTMLElement,
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<void> {
  root ??= document.body.appendChild(document.createElement("div"))
  await act(() => render(node, root!))
}

/** The library's catalogs and Seed's, English first, as the apps build them. */
function translator(language: string, translations?: Catalog[]): Translator<string> {
  const english = [uiEn, systemEn, appEn, adminEn] as Catalog[]
  return createTranslator({
    language,
    catalogs: english.map((source, index) => ({ source, translation: translations?.[index] })),
  })
}

const PSEUDO = translator(
  `en-XA`,
  [uiEn, systemEn, appEn, adminEn].map((catalog) => pseudoLocalize(catalog as Catalog)),
)
const GERMAN = translator(`de`, [uiDe, systemDe, appDe, adminDe] as Catalog[])
const ARABIC = translator(`ar`, [uiAr, systemAr, appAr, adminAr] as Catalog[])

const NOW = new Date(Date.UTC(2026, 9, 17, 12, 5))
const FORMAT = createFormatters({ locale: `en-GB`, timeZone: `Europe/Berlin`, hourCycle: `h23` })

/** The language setting every frame and the preferences offer: German chosen. */
const language = {
  languages: [`en`, `ru`, `de`, `ar`],
  current: `de`,
  automatic: `ru`,
  onSelect: () => {},
}

const preferences: PreferencesProps = {
  value: { ...DEFAULT_PREFERENCES, timeZone: `Asia/Tokyo` },
  device: { locale: `en-GB`, timeZone: `Europe/Berlin` },
  systemTheme: `dark`,
  otherZone: `Europe/Berlin`,
  conflict: { version: 3, value: { ...DEFAULT_PREFERENCES, timeZone: `Asia/Tokyo` } },
  version: 2,
  pending: false,
  error: `network`,
  announcement: `changed`,
  now: NOW,
  onTheme: () => {},
  onSave: () => {},
  onUseDeviceZone: () => {},
  onKeepZone: () => {},
  language,
}

/** Every frame and the preferences, in one page: what the pseudo-language must cover. */
function Everything({ t }: { t: Translator<string> }): VNode {
  const shortcuts = {
    rows: [],
    open: false,
    onOpen: () => {},
    onClose: () => {},
    singleKeys: true,
    onSingleKeys: () => {},
    inMenu: true,
  }
  const page = (children: ComponentChildren) => <div data-e2e="page">{children}</div>
  return (
    <I18nContext.Provider value={t}>
      <FormatContext.Provider value={FORMAT}>
        <AppFrame
          user={{ firstName: ``, lastName: ``, email: null }}
          currentPath="/notes"
          onSignOut={() => {}}
          search={<span />}
          shortcuts={shortcuts}
          language={language}
        >
          {page(
            <>
              <RegionSection {...preferences} />
              <AppearanceSection {...preferences} />
            </>,
          )}
        </AppFrame>
        <PublicFrame canSignOut onSignOut={() => {}} language={language}>
          {page(null)}
        </PublicFrame>
        <AdminShell
          navItems={[{ name: `⟦Users⟧`, href: `/users`, Icon: IconUsers }]}
          currentPath="/users"
          operator={{ name: `Ada Lovelace`, email: `ada@example.com` }}
          onSignOut={() => {}}
          shortcuts={shortcuts}
          language={language}
        >
          {page(
            <AdminPreferencesGroup
              now={NOW}
              preferences={{
                value: { ...DEFAULT_PREFERENCES, language: `de`, hourCycle: `h12` },
                version: 1,
                updatedAt: null,
                firstTimeZone: `Asia/Tokyo`,
                firstLocale: `de-DE`,
              }}
            />,
          )}
        </AdminShell>
        <AdminFrame operatorName="Ada Lovelace" canSignOut onSignOut={() => {}}>
          {page(null)}
        </AdminFrame>
      </FormatContext.Provider>
    </I18nContext.Provider>
  )
}

/** What a person reads: every text node, and the names and hints in attributes. */
function readable(): string[] {
  const texts: string[] = []
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // A picker's options are data (region and zone names from `Intl`), not the screen's words.
    if (node.parentElement?.closest(`script, style, [role="listbox"]`)) continue
    texts.push(node.textContent ?? ``)
  }
  for (const element of document.body.querySelectorAll(`*`)) {
    for (const name of [`aria-label`, `placeholder`, `title`]) {
      const value = element.getAttribute(name)
      if (value) texts.push(value)
    }
  }
  return texts.map((text) => text.trim()).filter(Boolean)
}

/**
 * Data the screens show as it is: the product's name, a key's name, a person's name, dates, zones
 * and formats.
 */
const DATA = [
  `Seed`,
  `Ctrl`,
  `Ada Lovelace`,
  `AL`,
  `ada@example.com`,
  FORMAT.dateTime(NOW, `full`),
  `Tokyo`,
  `Berlin`,
  `Asia`,
  `Europe`,
  `GMT`,
  `German (Germany)`,
  `British English`,
  `English (United Kingdom)`,
  `German (Deutsch)`,
  `Deutsch`,
  `German`,
]

describe(`the frames and the preferences`, () => {
  it(`show no English outside the catalogs: an en-XA render is all pseudo-language or data`, async () => {
    await mount(<Everything t={PSEUDO} />)

    const english = readable().filter((text) => {
      // A message split around a value spans several nodes: `⟦… ` before it, ` …⟧` after.
      let rest = text.replaceAll(/⟦[^⟧]*(⟧|$)/g, ``).replace(/^[^⟦]*⟧/, ``)
      for (const data of DATA) rest = rest.replaceAll(data, ``)
      return /[A-Za-z]{2,}/.test(rest)
    })
    expect(english).toEqual([])
    // The render did reach every part: each one's pseudo-text is on the page.
    const page = document.body.textContent ?? ``
    for (
      const key of [
        `Frame.signOut`,
        `Preferences.formatsHint`,
        `Preferences.changeLanguage`,
        `AdminPreferences.language`,
      ]
    ) {
      expect(page).toContain(PSEUDO.t(key))
    }
  })

  it(`switch to German and to Arabic at once when the translator changes`, async () => {
    await mount(<Everything t={translator(`en`)} />)
    expect(document.body.textContent).toContain(
      `How dates, times and numbers look. This does not change the language.`,
    )

    await mount(<Everything t={GERMAN} />)
    let page = document.body.textContent ?? ``
    expect(page).toContain(`Abmelden`)
    expect(page).toContain(`Wie Datum, Uhrzeit und Zahlen aussehen.`)
    expect(page).toContain(`Sprache und Region`)
    expect(page).not.toContain(`Sign out`)

    await mount(<Everything t={ARABIC} />)
    page = document.body.textContent ?? ``
    expect(page).toContain(`تسجيل الخروج`)
    expect(page).toContain(`التنسيقات`)
    expect(page).not.toContain(`Abmelden`)
  })
})
