---
slug: command-palette-ctrl-k-offline-bauen
language: de
translationOf: ctrl-k-command-palette-offline
title: "Wie man eine Command Palette mit Ctrl+K baut, die offline funktioniert"
seoTitle: "Command Palette mit Ctrl+K bauen, die offline funktioniert"
description: "Eine Command Palette mit Ctrl+K sollte die ganze App bedienen, Tippfehler und das falsche Tastaturlayout verzeihen und offline weiterlaufen. So baut Seed sie aus einer einzigen Liste von Befehlen."
tldr:
  - "Eine Command Palette sollte die App bedienen, nicht nur durchsuchen. Seiten, Anlege-Aktionen und Einstellungen sind Befehle, und eine Einstellung ändert sich, sobald Sie Enter drücken."
  - "Wortanfänge abgleichen, einen Tippfehler pro Wort erlauben und die Suche im anderen Tastaturlayout lesen. Dann findet „notse“ Notes und „ntvf“ Theme."
  - "Nie bei „No results“ enden. Anbieten, das Getippte anzulegen, die Kopie auf dem Gerät durchsuchen, wenn der Server nicht erreichbar ist, und abblenden, was eine Verbindung braucht."
  - "Eine reine Liste: Zustand der App hinein, Befehle heraus. Die Tasten kommen aus der einen Kürzelliste der App, sodass Palette und Kürzel-Dialog nie voneinander abweichen."
topic: Im Detail
intro: "Die Ctrl+K-Palette von Seed bedient die ganze App, findet Dinge trotz Tippfehlern und falschem Tastaturlayout und funktioniert auch ohne Netz weiter. Hier steht, was sie kann, und die eine Datei, aus der sie gebaut ist."
relatedFeature: shortcuts
coverAlt: "Eine leere violette Taste leuchtet auf einem Schreibtisch neben einem ausgesteckten Kabel, und vier Papierkarten steigen von ihr auf, mit einem Mond, einer Sonne, einer Seite und einem Haus."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-19T08:00:00Z
newsletter: true
---

Eine Command Palette (Befehlspalette) mit Ctrl+K (Strg+K), die offline funktioniert und die
Menschen immer wieder benutzen, muss drei Dinge können. Sie bedient die App: Jede Seite, jedes „New…“ und jede Einstellung ist ein Befehl.
Sie verzeiht, wie Menschen wirklich tippen: einen Tippfehler, ein halbes Wort, das falsche
Tastaturlayout. Und sie führt nie in eine Sackgasse: Passt nichts, bietet sie an, das Getippte
anzulegen, und ohne Netz durchsucht sie die Kopie auf Ihrem Gerät. In Seed kommt all das aus einer
einzigen Liste von Befehlen in einer Datei.

Dieser Beitrag ist für Entwickler, die Ctrl+K in ihre eigene Web-App einbauen. Ich zeige zuerst,
was die Palette kann, und dann die Datei, aus der sie gebaut ist, mit dem echten Code.

![Die Command Palette von Seed mit „ntvf“ im Suchfeld. Die erste Zeile, hervorgehoben unter der Überschrift Commands, ist Theme, mit ihrem Abschnitt Settings in einer zweiten Zeile und ihrem aktuellen Wert „System“ daneben.](/shots/palette-dark-800.webp)

## Was sollte Ctrl+K außer Suchen können?

Die Beispiele nutzen die App auf Englisch, deshalb stehen alle Namen so da, wie sie auf dem
Bildschirm erscheinen.

Öffnen Sie die Palette und tippen Sie nichts. Sie ist schon nützlich: Ihre letzten fünf Auswahlen
unter Recent (zuletzt benutzt), die Befehle der Seite, auf der Sie gerade sind, Ihre neuesten
Notizen und Create (Anlegen). Die meisten meiner eigenen Besuche in einer Palette heißen „bring mich
zurück zu dem Ding“ oder „mach hier das Naheliegende“, und für beides sollte man nichts tippen
müssen.

Tippen Sie nur `>`, und sie listet alles auf, was die App kann, unter fünf Überschriften: This page,
Go to, Create, Settings und Account. Tippen Sie etwas anderes, stehen die passenden Befehle
gemeinsam unter einer Überschrift Commands (Befehle), jede Zeile mit ihrem Abschnitt, und Create
folgt darunter. Ein paar Entscheidungen, die sich ausgezahlt haben:

- **Einstellungen wirken sofort.** Tippen Sie `light`, drücken Sie Enter: Die Seite wird hell, und
  die Palette bleibt offen. `dark`, Enter, und alles ist wie vorher. Kein Umweg über eine
  Einstellungsseite, nur um zu sehen, ob es Ihnen gefällt.
- **Tasten stehen neben den Befehlen.** New note zeigt seine Taste, N, direkt in der Zeile. Ein
  Kürzel aus zwei Tasten, etwa G, dann N für die Seite Notes, steht im Dialog Keyboard shortcuts,
  der dieselbe Liste von Befehlen liest. Der Spickzettel ist eingebaut.
- **`>` heißt: nur Befehle.** Beginnen Sie die Suche mit `>` und tippen Sie weiter: Notizen und
  Gruppen bleiben aus dem Weg.
- **Enter wartet auf die Antwort.** Die Palette gibt pro Suchanfrage eine Antwort, Notizen
  eingeschlossen. Drücken Sie Enter, bevor der Server geantwortet hat, wartet sie, sodass Sie nie
  die Zeile öffnen, die vor einer halben Sekunde zufällig ganz oben stand.

Ein Suchfeld, das nur Notizen findet, ist eine halbe Palette. Die andere Hälfte ist der Grund,
warum Menschen die Hände auf der Tastatur lassen.

## Wie findet sie Dinge trotz Tippfehlern und falschem Tastaturlayout?

Tippen Sie `notse`, und die erste Zeile ist die Seite Notes. Tippen Sie `ntvf`, und Sie bekommen
Theme, wie auf dem Bild oben. Das Zweite sieht aus, als wäre eine Katze über die Tastatur gelaufen.
Es ist „тема“, das russische Wort für Theme, getippt, während noch das englische Layout aktiv war.
Meine Tastatur hat zwei Layouts, und ich bin oft genug im falschen, dass `ntvf` inzwischen ein
Testfall ist.

Der Matcher folgt ein paar einfachen Regeln:

1. Groß- und Kleinschreibung und Akzente zählen nicht.
2. Die Wörter dürfen in beliebiger Reihenfolge kommen, und jedes getippte Wort muss nur ein Wort im
   Namen des Befehls oder in einem seiner anderen Namen beginnen. `no all` reicht für „all notes“.
3. Ein Wort ab vier Buchstaben darf einen Tippfehler enthalten: einen Buchstaben zu viel, zu wenig
   oder einen falschen, oder zwei vertauschte Buchstaben.
4. Die Suche wird auch so gelesen, als wäre das andere Tastaturlayout aktiv, und über Alphabete
   hinweg, sodass lateinische Buchstaben ein russisches Wort finden können und umgekehrt. Derzeit
   heißt das: das englische und das russische Layout. Jedes andere Paar braucht eine eigene
   Tastenzuordnung.

Passen mehrere Zeilen, gewinnt der sauberere Treffer: zuerst ein exakter Name, dann ein Name, der
mit der Suche beginnt, dann passende Wörter, dann ein Alias, dann das andere Layout und zuletzt ein
Tippfehler. Die Nachsicht bei Tippfehlern schiebt also nie eine richtige Antwort nach unten.

Jeder Befehl trägt außerdem die Wörter, die Menschen ausprobieren, auf Englisch und Russisch. Notes
reagiert auf „all notes“ und „заметки“, Activity auf „history“, „log“ und „audit“. Niemand erinnert
sich, wie Sie die Seite genannt haben. Man erinnert sich, wie man sie selbst genannt hätte.

Die übliche Alternative ist ein Fuzzy-Matcher, der beliebige Buchstaben akzeptiert, solange sie in
der richtigen Reihenfolge vorkommen. Für eine Dateiauswahl ist er die bessere Wahl: Dort soll `gtn`
die Datei `go-to-notes.ts` finden. Für eine Liste von Befehlen ist er zu großzügig. Ein paar
Buchstaben können Zeilen treffen, die mit dem Gemeinten nichts zu tun haben, und dass `ntvf` ein
Wort ist, weiß er trotzdem nicht. Wortanfänge plus ein Tippfehler sind strenger, und das passt zu
kurzen Namen, die Menschen vergeben haben.

Ein Tippfehler pro Wort ist die Grenze. Zwei Tippfehler in einem Wort finden nichts: Es ist ein
Matcher, kein Gedankenleser. Der Matcher steckt in einer gemeinsamen Bibliothek unter MIT-Lizenz,
[`@spy4x/platform`](https://jsr.io/@spy4x/platform), die Sie auch ohne den Rest von Seed
importieren können. Er bereitet die Namen jedes Befehls einmal vor, sodass ein Tastendruck nur noch
die Sortierung kostet.

## Was zeigt sie, wenn nichts passt?

„No results“ (keine Treffer) heißt bei einer Palette nichts anderes als: Geh weg. Die von Seed sagt
das nie, denn was auch immer Sie getippt haben, ist ein völlig brauchbarer Titel für das nächste
Ding.

Tippen Sie `Palette demo`. So heißt nichts, also bietet der Abschnitt Create
`New note: “Palette demo”` an. Enter öffnet das Formular für eine neue Notiz, mit ausgefülltem
Titel. Ctrl+Enter überspringt das Formular: Die Notiz wird angelegt und geöffnet.

Diese Zeilen werden aus der Suche gebaut, nie mit ihr abgeglichen, deshalb bekommt sie jeder Text:

```ts
export function quickCreateRows(context: PaletteContext, query: string): PaletteOption[] {
  const { t, currentGroup } = context
  const title = query.trim()
  if (title === "") return []
  const writable = currentGroup?.canWrite && context.notes !== false ? currentGroup : null
  const row = (entity: QuickCreateEntity, key: string): PaletteOption => ({
    id: `quick-create-${entity}`,
    label: t.t(`Search.withText`, { label: t.t(key), text: isolate(quoted(title)) }),
    group: t.t(`Search.create`),
    choice: { kind: "quick-create", entity, title },
  })
  // …eine Notiz und ein Tag, wenn die Person hier schreiben darf, und eine Gruppe
}
```

Wer hier nur lesen darf, bekommt keine Zeile „New note“. Die Palette bietet nur an,
was auch die Buttons auf der Seite anbieten würden.

## Wie bleibt sie offline benutzbar?

Ohne Netz kann zweierlei schiefgehen: Die Suche hat niemanden, den sie fragen kann, und manche
Befehle haben niemanden, der sie ausführt. Die Palette behandelt beides getrennt.

**Die Suche weicht aufs Gerät aus.** Die App von Seed hält ohnehin eine Kopie Ihrer Notizen in der
lokalen Datenbank des Browsers (das ist
[die Offline-first-Schicht](/blog/offline-first-preact-signals-local-database-sync), auf Englisch).
Die Palette fragt zuerst den Server, und ist er nicht erreichbar, durchsucht sie stattdessen diese
Kopie:

```ts
return async (query, signal) => {
  if (query === "") return { notes: await recentNotes(sources), onDevice: !sources.canCall() }
  if (sources.canCall()) {
    try {
      const answer = await sources.server(query, signal)
      return { notes: answer.notes.map(fromWire), onDevice: false }
    } catch (error) {
      if (signal.aborted || !(isUnreachable(error) || isProxyAnswer(error))) throw error
    }
  }
  return { notes: await notesOnDevice(sources, indexOf, query), onDevice: true }
}
```

Das ist
[`apps/spa/src/state/search.ts`](https://github.com/spy4x/seed/blob/main/apps/spa/src/state/search.ts).
Drei Details darin zählen:

- Die Überschrift wird zu „Notes on this device“ (Notizen auf diesem Gerät), damit Sie wissen,
  dass die Antwort älter sein kann als die des Servers.
- Nur ein unerreichbarer Server löst den Rückfall aus. Eine Ablehnung, etwa durch das Rate Limit,
  erscheint als Fehler. Sie hinter lokalen Ergebnissen zu verstecken, wäre höfliches Lügen.
- Auf dem Gerät können noch Notizen einer Gruppe liegen, die Sie verlassen haben. Die Suche schaut
  nur in die Gruppen, zu denen Sie jetzt gehören.

Die lokale Suche ist ein kleiner Index auf dem Gerät, eine andere Engine als der Matcher der
Befehle, und sie verzeiht dieselben Ausrutscher. Schalten Sie in der Demo das Netz ab, tippen Sie
`pallette` mit zwei l, und die Notiz „Palette demo“, die Sie oben mit Ctrl+Enter angelegt haben,
wird gefunden. Ebenso `зфдуееу`, dasselbe Wort auf dem
russischen Layout getippt.

**Befehle, die den Server brauchen, bleiben in der Liste.** Offline könnten „New group“ oder
„Delete my account“ still aus der Liste verschwinden. Dann würden Sie sich fragen, ob es die
Funktion überhaupt gibt. Stattdessen bleiben sie, wo sie waren, abgeblendet, mit „Needs a
connection“ (braucht eine Verbindung) daneben:

```ts
const SERVER_ONLY = new Set(
  [
    `import-notes`,
    `new-group`,
    `keep`,
    `download-data`,
    `change-picture`,
    `delete-account`,
    `turn-off-two-factor`,
    `end-other-sessions`,
  ].map((id) => `action-${id}`),
)

function needsServer(context: PaletteContext, option: PaletteOption): PaletteOption {
  return {
    ...option,
    disabledReason: context.online ? undefined : context.t.t(`Search.needsConnection`),
  }
}
```

New note und New tag stehen nicht auf dieser Liste. Sie funktionieren offline: Der Schreibvorgang
wartet in einer Warteschlange und geht raus, sobald die Verbindung wieder da ist.

## Wie ist sie gebaut? Eine Liste von Befehlen

Die ganze Registry ist
[`libs/ui/palette-commands.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.ts).
Sie ist eine reine Funktion: Der Zustand der App geht hinein (wer Sie sind, welche Gruppe, online
oder nicht), eine Liste von Optionen kommt heraus. Kein Store, kein `fetch`, kein Router. Ein
Befehl ist ein Eintrag:

```ts
{
  id: "notes",
  key: `Frame.notes`,
  href: (context) => context.notes === false ? null : NOTE_PATHS.list,
  aliases: [`notes list`, `all notes`, `заметки`, `список заметок`],
},
```

Der Übersetzungsschlüssel des Labels, wohin der Befehl führt, die Wörter, die ihn finden. `href`
gibt `null` zurück, wenn die Person dort nicht hin darf, und der Befehl fällt weg.

Achten Sie darauf, was der Eintrag nicht hat: seine Tasten. G, dann N steht nirgends in dieser
Datei. Die App hat eine einzige Liste von Kürzeln, und die Palette schlägt die Tasten dort über
denselben Übersetzungsschlüssel nach:

```ts
function kbdOf(shortcuts: readonly ShortcutRow[], key: string): string | undefined {
  return shortcuts.find((row) => row.description === key)?.keys
}
```

Deshalb können die Palette und der Dialog Keyboard shortcuts nicht voneinander abweichen. Die andere
Variante, mit den Tasten an zwei Stellen eingetragen, funktioniert bis zu dem Tag, an dem sich eine
davon ändert. Der Dialog liest dieselbe Registry außerdem zurück und listet jeden Befehl mit den
Wörtern, die ihn finden.

Jede Option trägt eine Auswahl (`choice`), ein kleines Objekt wie
`{ kind: "quick-create", entity, title }`. Die App führt sie über dieselbe Funktion aus, die auch
ihre Buttons aufrufen. So wächst der Palette nie eine zweite Umsetzung von „Notiz anlegen“, die
sich mit der Zeit von der echten entfernt.

Weil sie rein ist, lässt sie sich billig testen: kein Browser, nur Zustand hinein und Zeilen
heraus. Die Tests lesen sich wie die Liste der Funktionen, etwa „put Go to Notes first for notse
and заметки“ und „keep each command the server must run listed offline, dimmed with why, and dim
none online“. Sie stehen in
[`palette-commands.test.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.test.ts).

Das Admin-Panel hat dieselbe Palette. Seine Befehle sind eine zweite Liste von 268 Zeilen, alles
andere wird geteilt.

## Wie fügt ein Produkt eigene Datensätze hinzu?

Seed ist eine Vorlage, also muss die Palette Dinge finden, von denen ich nie gehört habe: Ihre
Rechnungen, Kontakte, Projekte. Ein Produkt übergibt sie als Datensätze:

```ts
export interface PaletteRecord {
  /** Unique within its source. */
  id: string
  /** What the palette lists and matches, in the person's language. */
  label: string
  /** The row's second line, such as an amount or a date. It is shown, not matched. */
  detail?: string
  /** Other words that find it, such as a number or an old name. */
  aliases?: readonly string[]
  /** The page a pick opens, as a page command does. */
  href: string
}
```

Eine Quelle ist eine Überschrift plus eine Funktion, die die Datensätze zurückgibt, die das Gerät
gerade hält
([`search-palette.tsx`](https://github.com/spy4x/seed/blob/main/libs/ui/search-palette.tsx)).
Abgeglichen werden sie auf dem Gerät, vom selben Matcher wie die Befehle, sodass eine Rechnung die
Nachsicht bei Tippfehlern und Layouts gratis bekommt, online oder nicht. Ein Haken: Die Funktion
wird bei jedem Tastendruck aufgerufen, sie muss also aus dem Speicher antworten und sollte dieselben
Objekte zurückgeben, solange sich nichts geändert hat. Der Matcher bereitet jedes Objekt einmal vor
und verwendet diese Arbeit wieder.

## Versuchen Sie, sie kaputtzumachen

Öffnen Sie die [Live-Demo](https://app.seedsaas.com/try) und drücken Sie „Try it now“. Sie
bekommen ein Gastkonto mit Beispielnotizen. Dann:

1. Drücken Sie Ctrl+K (⌘K auf dem Mac) und tippen Sie `notse`, dann `ntvf`.
2. Tippen Sie `light`, drücken Sie Enter, dann `dark`, Enter.
3. Tippen Sie einen Titel, den noch niemand benutzt hat, und drücken Sie Ctrl+Enter.
4. Schalten Sie das Netz in den Entwicklertools Ihres Browsers ab und suchen Sie diese Notiz mit
   einem Tippfehler darin.

Alles steht unter MIT-Lizenz im [Repository](https://github.com/spy4x/seed), und die Tasten stehen
auf der [Seite zu den Tastenkürzeln](/de/features/shortcuts). Finden Sie einen Tippfehler, den sie
hätte verzeihen sollen und nicht verziehen hat, dann ist das ein Test, den ich noch nicht
geschrieben habe.
