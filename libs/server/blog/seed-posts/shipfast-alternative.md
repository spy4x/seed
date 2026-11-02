---
slug: shipfast-alternative
language: de
translationOf: shipfast-alternatives
title: "ShipFast-Alternative gesucht? 7 SaaS-Boilerplates im Vergleich"
seoTitle: "ShipFast-Alternative: 7 SaaS-Boilerplates im Vergleich"
description: Welche ShipFast-Alternative passt? Sieben SaaS-Boilerplates nach Preis, Lizenz, Stack, Teams und Hosting verglichen, mit Blick auf DSGVO und Quellen zu jeder Angabe.
tldr:
  - ShipFast kostet einmalig 199 bis 299 Dollar und passt gut für Produkte, die eine Einzelperson bezahlt.
  - Kostenlos und unter MIT-Lizenz gibt es Seed, Open SaaS, ShipFree und den Next.js SaaS Starter.
  - Verkaufen Sie an Teams, nehmen Sie eine Vorlage mit Gruppen, Rollen und Abrechnung pro Mitglied.
  - Wer Daten in der EU halten will, fährt mit einem eigenen Server einfacher als mit fünf externen Diensten.
topic: Fragen
author: Anton Shubin
publishAt: 2026-11-02T09:00:00Z
newsletter: false
---

Die wichtigsten Alternativen zu ShipFast sind kostenlose Starter unter MIT-Lizenz (Seed, Open SaaS,
ShipFree, der Next.js SaaS Starter und das SaaS Boilerplate von Ixartz) und teurere Bezahl-Kits
(Makerkit und Supastarter). Welche davon besser passt als ShipFast, entscheidet eine Frage: Zahlt
bei Ihnen eine einzelne Person oder ein Team? ShipFast ist für den ersten Fall gebaut; die anderen
unterscheiden sich darin, wie viel sie für den zweiten mitbringen.

Ich entwickle Seed, eine der sieben Vorlagen, und bin daher nicht neutral. Deshalb verlinkt jede
Angabe zu einem fremden Produkt auf die Seite, von der sie stammt, und unten steht ehrlich, wann
ShipFast die bessere Wahl ist. Alle Seiten habe ich am 3. November 2026 gelesen. Eine Angabe ist
veraltet? [Eröffnen Sie ein Issue](https://github.com/spy4x/seed/issues), ich korrigiere sie.

## Was bekommt man bei ShipFast?

ShipFast ist ein Next.js-Boilerplate von Marc Lou. Seine [Verkaufsseite](https://shipfa.st/) nennt
199 Dollar für Starter und 249 Dollar für All-in, einmalig, und 299 Dollar mit seinem Kurs
CodeFast. Enthalten sind Anmeldung per Google oder Magic Link (NextAuth), MongoDB oder Supabase,
Zahlungen über Stripe oder Lemon Squeezy, E-Mail über Mailgun oder Resend, ein Blog und
SEO-Bausteine.

Die [Lizenz](https://shipfa.st/license) erlaubt beliebig viele Projekte, auch kommerzielle, verbietet
aber Weiterverkauf und Weitergabe der Vorlage; die Rechte am Code bleiben bei ShipFast. Zur
Veröffentlichung als Open Source sagt sie nichts: Fragen Sie nach, bevor Sie Code darauf
veröffentlichen.

Nicht auf der Seite: Gruppen oder Organisationen, Rollen, ein zweiter Faktor, Passkeys, ein
Admin-Bereich, Übersetzungen. Für ein Werkzeug, das eine Person bezahlt, fehlt das vielleicht nie.
Für ein B2B-Produkt ist es der erste Monat Arbeit.

## ShipFast und die Alternativen in einer Tabelle

| Vorlage                                                               | Preis                      | Lizenz                            | Stack                                     | Teams und Rollen                | Hosting                                  |
| --------------------------------------------------------------------- | -------------------------- | --------------------------------- | ----------------------------------------- | ------------------------------- | ---------------------------------------- |
| [ShipFast](https://shipfa.st/)                                        | 199 oder 249 USD einmalig  | Kostenpflichtig, keine Weitergabe | Next.js; MongoDB oder Supabase            | Nicht genannt                   | Vercel als kostenlose Option             |
| [Seed](https://github.com/spy4x/seed)                                 | Kostenlos                  | MIT                               | Deno, Hono, Fresh, Preact; Postgres       | Ja, mit Abrechnung pro Mitglied | Ein eigener Linux-Server, Docker Compose |
| [Open SaaS](https://github.com/wasp-lang/open-saas)                   | Kostenlos                  | MIT                               | Wasp (React, Node.js, Prisma); Postgres   | Nicht genannt                   | Railway oder Fly.io per Befehl           |
| [ShipFree](https://github.com/revokslab/shipfree)                     | Kostenlos                  | MIT                               | Next.js, Bun, Drizzle; Postgres           | Nicht genannt                   | Vercel oder Docker                       |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)        | Kostenlos                  | MIT                               | Next.js, Drizzle; Postgres                | Owner und Member                | Vercel                                   |
| [Ixartz SaaS Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) | Kostenlos; Bezahlversionen | MIT (kostenlose Version)          | Next.js, Clerk, Drizzle                   | Ja                              | Nicht genannt; Node.js 24+               |
| [Makerkit](https://makerkit.dev/pricing)                              | 299 oder 599 USD einmalig  | Kostenpflichtig; Lite unter MIT   | Next.js, React Router oder TanStack Start | Ja                              | Nicht genannt                            |
| [Supastarter](https://supastarter.dev/)                               | 349 bis 1.499 USD einmalig | Kostenpflichtig                   | Next.js, Nuxt oder TanStack Start         | Ja, Abrechnung pro Platz        | Vercel, Serverless oder Docker           |

„Nicht genannt“ heißt: Die Seiten des Produkts erwähnen es nicht, nicht, dass es sich nie
nachrüsten lässt. Bei Makerkit stehen die reduzierten Preise, regulär sind es 349 und 649 Dollar.
Die kostenlose Version von Ixartz enthält kein Stripe; Zahlungen kommen mit den Bezahlversionen
Pro und Max.

## DSGVO: Wo liegen die Daten Ihrer Kunden?

Jeder externe Dienst, der personenbezogene Daten verarbeitet, ist ein Auftragsverarbeiter mehr:
ein weiterer Vertrag, ein weiterer Eintrag in der Datenschutzerklärung. Bei ShipFast sind das je
nach Wahl Hosting, Datenbank (MongoDB oder Supabase), Mail-Versand und Zahlung, also schnell
vier oder fünf Anbieter.

Seed läuft komplett auf einem Server, den Sie selbst mieten, zum Beispiel bei einem Hoster in
Deutschland: Postgres, der Dateispeicher (Garage, S3-kompatibel), das Monitoring und die
Hintergrundjobs inklusive. Dazu kommt nur, was Sie einschalten, etwa Stripe und ein
Mail-Anbieter. Das macht Ihr Produkt nicht automatisch DSGVO-konform, und dies ist keine
Rechtsberatung, aber die Liste der Auftragsverarbeiter bleibt kurz.

## Welche kostenlose ShipFast-Alternative kommt am nächsten?

**ShipFree** ist die direkteste Kopie der Idee: ein kostenloses Next.js-Kit, das sich selbst als
Alternative zu ShipFast bezeichnet, inzwischen mit Bun, Drizzle und Better Auth, Stripe und fünf
weiteren Zahlungsanbietern. Etwa 1.700 Sterne auf GitHub.

**Open SaaS** ist mit rund 16.200 Sternen die beliebteste kostenlose Vorlage hier. Sie baut auf dem
Framework Wasp und bringt ein Admin-Dashboard, Datei-Uploads nach S3, Stripe, Polar oder Lemon
Squeezy und eine Doku-Seite mit.

**Der Next.js SaaS Starter**, ebenfalls rund 16.200 Sterne, ist bewusst klein: Anmeldung per
E-Mail, Stripe Checkout, Teams mit den Rollen Owner und Member. An einem Nachmittag gelesen.

## Welche Vorlage passt zu einem Produkt für Teams?

Hier ist Seed am stärksten. Jede Person bekommt bei der Registrierung eine Gruppe, Gruppen haben
Rollen vom Leser bis zum Inhaber, und Stripe rechnet pro Mitglied ab, der Preis wächst also mit
dem Team. Die Anmeldung ist fertig: Passwort, Passkeys, Anmeldelinks per E-Mail, Google und GitHub
und eine Authenticator-App als zweiter Faktor. Der Admin-Bereich auf eigener Domain findet eine
Person, erstattet eine Zahlung und schreibt jede Aktion ins Audit-Log. Die App funktioniert offline,
aktualisiert sich in Echtzeit und spricht neun Sprachen, Deutsch eingeschlossen.

Die Kosten sind ein fester Monatspreis für den Server, keine Rechnung, die mit dem Traffic wächst.
Seed ist kostenlos und MIT-lizenziert: Was Sie darauf bauen, dürfen Sie verkaufen, forken oder
offenlegen. Die [vollständige Vergleichstabelle](/de/compare) zeigt 19 Funktionen von sechs
Startern. Unter den Bezahl-Kits haben **Supastarter** und **Makerkit** ebenfalls Organisationen.

## Wann ist ShipFast trotzdem die bessere Wahl?

- Sie arbeiten mit Next.js und React und wollen dort bleiben.
- Sie verkaufen an Einzelpersonen und wollen Landingpage, Zahlungen und Blog bis Montag online.
- Sie wollen eine große Community: Der Discord (laut Seite über 5.000 Maker) und der Kurs gehören
  zum Kauf.
- Sie brauchen heute Lemon Squeezy. Seed rechnet nur über Stripe ab; ein Merchant-of-Record-Anbieter
  ist eine offene Idee ([#584](https://github.com/spy4x/seed/issues/584)), kein Plan.
- Sie deployen auf Vercel oder Serverless-Funktionen. Seed braucht einen Server, den Sie steuern.

Und die Risiken von Seed, ohne Schönfärberei: Es ist ein junges Projekt mit einem einzigen
Maintainer, und es läuft heute auf Deno; Node.js und Bun kommen erst noch.

## In zehn Minuten entscheiden

1. Notieren Sie, wer zahlt: eine Person oder ein Team mit Admin.
2. Bei einem Team: Streichen Sie alles ohne Gruppen und Rollen aus der Tabelle.
3. Zählen Sie die externen Dienste, die personenbezogene Daten sehen würden.
4. Öffnen Sie die Demo oder das Repository und registrieren Sie sich, bevor Sie einen Cent zahlen.

Die Demo von Seed ist die App, die Sie am ersten Tag bekommen, mit erfundenen Personen und Daten:
[auf app.seedsaas.com ausprobieren](https://app.seedsaas.com), danach sehen,
[was der Betrieb kostet](/de/pricing).
