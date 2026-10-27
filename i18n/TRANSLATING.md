# Translating

Every word Seed's own screens show lives in a catalog: `i18n/<namespace>/<language>.json`, with
`en.json` as the source. The components of preact-components bring their own catalogs; this folder
holds only Seed's words.

| Namespace | What it holds                                                   | Loaded by      |
| --------- | --------------------------------------------------------------- | -------------- |
| `app`     | The product's screens (the SPA)                                 | the SPA        |
| `admin`   | The operator area                                               | the admin app  |
| `site`    | The public website (#276)                                       | the MPA        |
| `mail`    | E-mails (#277)                                                  | the worker     |
| `errors`  | The API's error codes, keyed by code, shown by both apps (#275) | the SPA, admin |

The languages are `LANGUAGES` in `libs/domain/identity/preferences.ts`. Adding one is an entry
there, a file per namespace here, and in each app a module listing its catalogs
(`apps/spa/src/i18n/<language>.ts`, `apps/admin/src/i18n/<language>.ts`) with a loader line for it
in `apps/spa/src/i18n.ts` and `apps/admin/src/i18n.ts`.

A key is `<Component>.<field>`, such as `Frame.signOut`. Keys are unique across namespaces: one
translator holds them all. Code names every key as a quoted literal, so the check below can tell
when a key is no longer used.

A `{name}` in a message is a value the code fills in: keep every one, spelled the same. `<value>…</value>`
marks a span the code draws, such as a link; keep the tags around the same words. A message that is
an object (`{ "one": …, "other": … }`) is a plural, with one form per plural category of the
language.

## The loop

1. Change the English in `en.json`, and name the key in the code.
2. Run `deno task test`. `i18n/i18n.test.ts` lists every message that is missing, extra, empty, or
   out of date because its English changed, every one whose placeholders, tags or plural forms
   differ from the English, and every English key no code names.
3. Translate what it lists, in every language.
4. Run `deno task i18n:stamp`. It records in `<language>.lock` which English each translation was
   made from.
5. Run `deno task test` again. It passes once every language matches the English.

Stamp only after the translation is done: a stamp tells the test that the translation is current.

## Voice

Short, plain and friendly, as a person would say it, in the voice the components use:

| Language             | File         | Voice                                                         |
| -------------------- | ------------ | ------------------------------------------------------------- |
| German               | `de.json`    | `du`, lower-case. "Versuche es noch einmal."                  |
| Spanish              | `es.json`    | `tú`, neutral Spanish, gender-neutral where it costs nothing. |
| Brazilian Portuguese | `pt-BR.json` | `você`. "Tente de novo."                                      |
| Russian              | `ru.json`    | `вы`, lower-case. "Попробуйте ещё раз."                       |
| Arabic               | `ar.json`    | Modern Standard Arabic, addressing the reader directly.       |

A button says what it does, as a verb. An error says what happened and what to do next. Use the
quotes of the language: „…“ in German, «…» in Spanish, Russian and Arabic, “…” in Brazilian
Portuguese. The operator area (`admin`) speaks of the person whose account it shows in the third
person.

## Terms kept in English

- The product's name (Seed), brand names, and file formats.
- Key names on the keyboard: Enter, Tab, Esc, Shift, Ctrl, Alt, Command.
- Offsets such as `GMT+2`.

## Length

The English length is the budget. Navigation entries (`Frame.overview` and its siblings) sit under
an icon in a 72 px rail: one word, about 12 characters. Buttons: about 1.5 times the English. Hints,
errors and announcements: no limit; say it fully.
