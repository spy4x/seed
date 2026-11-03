---
slug: neun-sprachen-und-rtl-ab-tag-eins
language: de
translationOf: nine-languages-and-right-to-left-from-day-one
title: "SaaS mehrsprachig ab Tag eins: neun Sprachen und Arabisch von rechts nach links"
seoTitle: "SaaS mehrsprachig: neun Sprachen und RTL ab Tag eins"
description: "Wie ein Produkt auf Seed vom ersten Tag an in neun Sprachen läuft, Arabisch von rechts nach links eingeschlossen, und welche Tests verhindern, dass ein fehlender Text oder ein falscher Abstand live geht."
tldr:
  - Die App, das Admin-Panel, die Website und die E-Mails von Seed gibt es in neun Sprachen, Arabisch eingeschlossen, mit rund 3.900 Texten pro Sprache.
  - Ein Test bricht den Build ab, wenn ein Text fehlt, veraltet ist oder einen Platzhalter verloren hat. Ein zweiter lehnt Abstände „links“ oder „rechts“ ab, die sich für Arabisch nicht umdrehen.
  - Die Sprache ist eine Einstellung der Person, auf dem Server gespeichert und unabhängig von Datumsformat, Zeitzone und Uhr.
  - Eine zehnte Sprache ist ein Listeneintrag, eine Datei pro Katalog und ein paar Ladezeilen.
topic: Im Detail
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T20:00:00Z
newsletter: false
---

Wie baust du ein SaaS mehrsprachig, mit Arabisch von rechts nach links, ohne es später neu
schreiben zu müssen? Indem du beim ersten Screen anfängst und Tests aufpassen lässt. Seed läuft
in neun Sprachen: Deutsch, Englisch, Russisch, Spanisch, brasilianisches Portugiesisch, Arabisch,
Französisch, Japanisch und vereinfachtes Chinesisch. Das gilt für die App, das Admin-Panel, die
Website und die E-Mails. Auf Arabisch dreht sich das ganze Layout um.

Dieser Text ist für Gründerinnen, Gründer und Entwickler, die wissen: „Übersetzen wir später“
heißt „übersetzen wir nie“. Ich zeige dir, wo die Texte liegen, was die Tests abfangen und was
Rechts-nach-links wirklich kostet.

## Warum ab Tag eins?

Weil „später“ heißt, jeden Screen zweimal anzufassen. Jeden fest eingebauten Text, jedes von Hand
gebaute Datum, jedes `margin-left` musst du dann suchen und reparieren, in Code, der bis dahin
voller Features ist. Von Anfang an übersetzt, kostet ein neuer Screen ein paar Minuten, kein
Projekt, das keiner anfangen will.

Und es gibt einen einfacheren Grund: Die meisten Menschen im Netz lesen nicht zuerst Englisch.
Ein Produkt in ihrer Sprache hat einen Vorsprung.

## Wo liegen die Texte?

Jedes Wort auf den Screens von Seed steht in einem Katalog: eine TypeScript-Datei pro Bereich und
Sprache, etwa `i18n/app/de.ts` oder `i18n/site/ja.ts`. Es gibt fünf Bereiche: die App, das
Admin-Panel, die Website, die E-Mails und die Fehlermeldungen der API. Englisch ist die Quelle,
alle anderen Dateien haben dieselben Schlüssel.

| Bereich     | Texte pro Sprache |
| ----------- | ----------------: |
| Die App     |             1.503 |
| Admin-Panel |             1.487 |
| Website     |               682 |
| Fehlercodes |               164 |
| E-Mails     |                79 |

Das sind rund 3.900 Texte pro Sprache, gezählt am 2. November 2026. Die Komponenten aus
preact-components bringen zusätzlich ihre eigenen Kataloge mit.

Die App lädt nur deine Sprache, als eigene kleine Datei: Wer Deutsch liest, lädt kein Japanisch
herunter.

## Was verhindert, dass eine Übersetzung veraltet?

Ein Test, `i18n/i18n.test.ts`. Er schlägt fehl, wenn:

- in einer Sprache ein Text fehlt oder einer übrig ist, den es auf Englisch nicht mehr gibt;
- sich das Englisch geändert hat, nachdem übersetzt wurde (jede Sprache hat eine Lock-Datei, die
  festhält, aus welchem Englisch übersetzt wurde);
- eine Übersetzung einen Platzhalter wie `{count}` oder ein Tag um einen Link verloren oder falsch
  geschrieben hat;
- einem Plural eine Form fehlt, die die Sprache braucht. Arabisch hat sechs davon;
- kein Code einen englischen Text mehr verwendet.

So geht kein Button mit der Aufschrift `Notes.create` live und kein deutscher Screen, der dem
englischen eine Woche hinterherhinkt.

## Was kostet Rechts-nach-links wirklich?

Weniger als befürchtet, solange das Layout nie „links“ oder „rechts“ sagt. Die Styles von Seed
nutzen logische Seiten: „Anfang“ und „Ende“. Auf einer Seite von links nach rechts ist der Anfang
links, auf Arabisch rechts. Das Umdrehen erledigt der Browser.

Ein Test macht daraus eine Regel: `tests/spacing.test.ts` geht durch alle Apps und schlägt bei
jeder Abstandsklasse fehl, die eine physische Seite nennt. Die Seite setzt `dir` nach der Sprache,
die Website auf dem Server und die App in dem Moment, in dem du umschaltest.

Zwei weitere Details, die spät wehtun, wenn du sie auslässt:

- **Namen in Sätzen.** „Anna hat dich in die Gruppe Team eingeladen“ mischt auf Arabisch zwei
  Richtungen, und ein lateinischer Name kann die Satzzeichen auf die falsche Seite ziehen.
  Werte von Nutzern stehen in `<bdi>`, das ihre Richtung vom restlichen Text trennt.
- **Datum, Zahlen und Uhrzeit.** Jedes Datum auf jedem Screen läuft durch einen einzigen
  Formatierer. Ein weiterer Test, `tests/no-direct-date-format.test.ts`, schlägt bei jedem
  direkten Aufruf von `toLocaleString()` fehl.

## Sprache, Regionalformat und Uhr sind drei Einstellungen

Die Sprache wird mit dem Profil auf dem Server gespeichert, also gilt sie auf allen Geräten und in
jeder E-Mail. Regionalformat, Zeitzone und 12- oder 24-Stunden-Uhr sind eigene Einstellungen. Eine
Engländerin in Berlin will englische Texte und `03.11.2026`. Ein Wiener in Bangkok will Deutsch und
die Uhrzeit von Bangkok. Wer das alles an eine Einstellung bindet, zeigt der Hälfte seiner Nutzer
das falsche Datum.

Auf der Website steht die Sprache in der Adresse (`/de/pricing`, `/ar/pricing`), ohne Weiterleitung
nach Browser oder IP, und jede Seite sagt Suchmaschinen, welche Sprachversionen es gibt.

## Wer übersetzt?

KI-Agenten, nach einem schriftlichen Leitfaden, `i18n/TRANSLATING.md`. Er legt den Ton jeder
Sprache fest (auf Deutsch wird geduzt), ein Glossar, damit jedes Ding überall denselben Namen hat,
und die Regel, die Situation zu übersetzen, nicht die Wörter. Ein zweiter Agent übersetzt jede
neue Übersetzung zurück ins Englische und vergleicht den Sinn. Ein professionelles
Übersetzungsbüro ist das nicht, und ich tue auch nicht so. Aber es ist viel besser als ein Screen,
den niemand lesen kann.

## Eine zehnte Sprache hinzufügen

Ein Eintrag in der Liste der Sprachen, eine Katalogdatei pro Bereich und ein paar Zeilen in jeder
App, die sie laden. Danach listen die Tests jeden Text auf, der der neuen Sprache noch fehlt, und
bleiben rot, bis sie vollständig ist.

## Probier es aus

Öffne die [Demo](https://app.seedsaas.com), geh in dein Profil und stell die Sprache auf Arabisch.
Sieh zu, wie sich die ganze App umdreht, und stell dann zurück auf Deutsch. Diesen Artikel gibt es
auch in allen neun Sprachen, und der [Code](https://github.com/spy4x/seed) steht unter MIT-Lizenz.
