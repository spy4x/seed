---
slug: saas-boilerplate-kostenlos
language: de
translationOf: free-saas-boilerplate
title: Gibt es ein kostenloses Open-Source-SaaS-Boilerplate? Sieben im ehrlichen Vergleich
seoTitle: "SaaS Boilerplate kostenlos: 7 Open-Source-Starter im Vergleich"
description: Ja. Seed, Open SaaS, Next.js SaaS Starter, ixartz, Apptension, BoxyHQ und Makerkit Lite sind kostenlos und quelloffen. Was jedes kann, wo die Daten liegen, und wann welches passt.
tldr:
  - Ja, es gibt mehrere kostenlose Open-Source-SaaS-Boilerplates mit Login, Zahlungen und Dashboard.
  - Kostenlose Editionen bezahlter Kits lassen oft genau Zahlungen oder Teams weg.
  - Wer Nutzerdaten in der EU halten will, wählt ein Kit ohne fremden Login-Dienst, das auf dem eigenen Server läuft.
  - Seed bringt Gruppen mit Rollen, Stripe-Abrechnung pro Mitglied, ein Admin-Panel und neun Sprachen auf Ihrem eigenen Server mit.
topic: Fragen
intro: "Ich habe nach einem kostenlosen SaaS-Boilerplate gesucht, so wie Sie es tun würden, und sieben gefunden, die nichts kosten. Jedes lässt etwas anderes weg, also habe ich verglichen, was Sie wirklich bekommen, bevor Sie Ihre Zeit investieren."
coverAlt: "Sieben junge Pflanzen in Anzuchttöpfen auf einem Holzregal hinter einem offenen Gartentor."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

Ja, es gibt kostenlose Open-Source-SaaS-Boilerplates (auch Starter Kits genannt), und die guten
bringen Login, Zahlungen und ein Dashboard schon mit. Stand 3. November 2026 stehen Seed, Open
SaaS, Vercels Next.js SaaS Starter, das ixartz SaaS Boilerplate, das Apptension SaaS Boilerplate,
das BoxyHQ SaaS Starter Kit und Makerkit Lite unter MIT oder Apache-2.0. Der Unterschied liegt
darin, was jedes weglässt und wo die Daten Ihrer Nutzer landen.

Ich entwickle Seed, bin also befangen. Jede Angabe zu einem anderen Projekt verlinkt die Seite, auf
der ich sie am 3. November 2026 gelesen habe, und wo ein anderes Kit besser passt, steht das hier.

## Welche kostenlosen SaaS-Boilerplates gibt es?

| Starter                            | Lizenz     | Stack                        | Teams und Rollen                                | Zahlungen                        | Betrieb                                         |
| ---------------------------------- | ---------- | ---------------------------- | ----------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| [Seed][seed]                       | MIT        | Deno, Hono, Preact, Postgres | Gruppen: Betrachter, Bearbeiter, Admin, Inhaber | Stripe, pro Mitglied             | Docker Compose auf jedem eigenen Linux-Server   |
| [Open SaaS][opensaas]              | MIT        | Wasp: React, Node.js, Prisma | Nicht genannt                                   | Stripe, Polar oder Lemon Squeezy | Fly.io oder Railway per Befehl, oder jeder Host |
| [Next.js SaaS Starter][next]       | MIT        | Next.js, Postgres, Drizzle   | Owner und Member                                | Stripe                           | Vercel, laut Anleitung                          |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js, Drizzle, Clerk      | Organisationen mit Rollen, über Clerk           | Nicht in der Gratis-Edition      | Nicht angegeben                                 |
| [Apptension SaaS Boilerplate][app] | MIT        | React, Django, Postgres      | Tenants: Owner, Admin, Member                   | Stripe                           | AWS, per AWS CDK                                |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js, Prisma, Postgres    | Teams mit Rollen                                | Stripe-Abos pro Team             | Buttons für Vercel, Heroku, DigitalOcean        |
| [Makerkit Lite][mk]                | MIT        | Next.js, Supabase            | Nicht in Lite                                   | Nicht in Lite                    | Jeder Host mit Next.js                          |

„Nicht genannt“ heißt: Die Projektseite erwähnt es nicht. Das beweist nicht, dass es fehlt, aber
verlassen sollten Sie sich nicht darauf.

## Wo liegen die Daten Ihrer Nutzer?

Für ein Produkt mit Kunden in der EU ist das oft die erste Frage im Gespräch mit dem
Datenschutzbeauftragten, lange vor dem Funktionsumfang.

- **Alles auf dem eigenen Server:** Seed läuft komplett per Docker Compose auf einem Linux-Server
  Ihrer Wahl, etwa bei einem deutschen Hoster. Login, Datenbank und Dateispeicher (Garage, ein
  mitgelieferter S3-Speicher) laufen dort mit. Auch Open SaaS lässt sich von Hand auf jeden Host
  bringen, und BoxyHQ bringt Docker Compose mit.
- **Login bei einem Dienst:** ixartz meldet Nutzer über Clerk an, einen gehosteten Dienst. Die
  Konten liegen dann bei Clerk, nicht in Ihrer Datenbank. Das kann völlig in Ordnung sein, gehört
  aber ins Verarbeitungsverzeichnis.
- **Cloud fest eingeplant:** Apptensions Infrastruktur ist für AWS geschrieben, und Makerkit Lite
  setzt auf Supabase.

Stripe selbst ist in Deutschland, Österreich und der Schweiz [verfügbar][stripe-global], die
Zahlungsdaten liegen also bei jedem dieser Kits bei Stripe. Das ist kein rechtlicher Rat, nur die
Landkarte, mit der Sie zum Gespräch gehen.

## Wann ist ein anderes Kit die bessere Wahl?

- **Open SaaS**, wenn Sie an Einzelpersonen verkaufen und neben Stripe auch Polar oder Lemon
  Squeezy wollen. Dafür nehmen Sie das Framework Wasp in Kauf.
- **Next.js SaaS Starter**, wenn Sie eine kleine, gut lesbare Basis auf Next.js suchen und den Rest
  selbst bauen.
- **ixartz**, wenn Clerk für Sie passt und Sie Teams und Übersetzungen gratis wollen; Zahlungen
  gibt es erst in den bezahlten Editionen Plus, Pro und Max.
- **Apptension**, wenn Ihr Team Python schreibt: Zwei-Faktor-Login, Passkeys, SSO, drei Rollen,
  Stripe und Admin, alles auf Django.
- **BoxyHQ**, wenn Ihre Kunden Konzerne sind, die ab Tag eins SAML-SSO und SCIM verlangen.
  Stripe-Abos pro Team sind ebenfalls dabei.

## Was bringt Seed mit?

Seed ist für ein Produkt gedacht, für das Teams zahlen, auf einem Server, den Sie kontrollieren.
Auf `main` heute: Login per Passwort, Passkey, Google, GitHub und E-Mail-Link, ein zweiter Faktor
per Authenticator-App, Gruppen mit vier Rollen und Einladungen, Stripe-Abrechnung pro Mitglied mit
Gratis-Plan und 14 Tagen Testphase, ein Admin-Panel auf eigener Domain, ein Audit-Log,
Benachrichtigungen in der App, per Web-Push und in Telegram, eine offlinefähige App und neun
Sprachen, Deutsch eingeschlossen.

Die Grenzen, ehrlich: nur Stripe, die Server laufen auf Deno 2 (Node und Bun sind
[geplant][runtime], ohne Datum), kein Serverless, und es gibt einen einzigen Maintainer, mich.

## Und jetzt?

Zwei Fragen entscheiden fast alles: Wer zahlt, eine Person oder ein Team, und wo dürfen die Daten
liegen? Wenn die Antworten „Teams“ und „auf meinem Server“ lauten, testen Sie die
[Live-Demo](https://app.seedsaas.com) auf Deutsch, werfen einen Blick auf den
[Vergleich mit bezahlten Kits](/de/compare) und starten mit dem [Repository][seed].

[seed]: https://github.com/spy4x/seed
[runtime]: https://github.com/spy4x/seed/issues/623
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
[stripe-global]: https://stripe.com/global
