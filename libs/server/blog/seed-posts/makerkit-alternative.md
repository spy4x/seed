---
slug: makerkit-alternative
language: de
translationOf: makerkit-alternatives
title: "Makerkit-Alternative: kostenlose SaaS-Starter, und wann sich Bezahlen lohnt"
seoTitle: "Makerkit-Alternative: kostenlose Open-Source-SaaS-Starter"
description: "Makerkit kostet ab 299 $, dem kostenlosen Lite fehlen Abrechnung und Teams. Kostenlose Alternativen mit beidem, mit Quellen, und wann Makerkit sein Geld wert ist."
tldr:
  - Die bezahlten Makerkit-Kits kosten einmalig 299 oder 599 $; dem kostenlosen Lite fehlen Abrechnung, Teams und Admin.
  - Ein Projekt auf einem bezahlten Kit darf nicht Open Source werden, und Freelancer brauchen eine Lizenz pro Kunde.
  - Seed ist kostenlos und MIT, mit Teams, Abrechnung pro Mitglied und Admin-App, auf Ihrem eigenen Server.
  - Nehmen Sie Makerkit, wenn Sie Supabase, Next.js oder React Router und Werkzeuge für KI-Agenten wollen.
topic: Fragen
intro: "Makerkit ist ein sauberes bezahltes Kit mit einer kostenlosen Lite-Ausgabe, und der Unterschied zwischen beiden ist genau das, was ein Produkt für Teams braucht. Hier sind die kostenlosen Alternativen, die diese Lücke füllen, mit Quelle zu jeder Angabe, und die Fälle, in denen Makerkit sein Geld wert ist."
relatedFeature: deploy
coverAlt: "Ein großer violetter Werkzeugkasten steht offen, seine Fächer voller Werkzeug, daneben ein kleiner geschlossener grauer Kasten mit Vorhängeschloss."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

Die kostenlose Makerkit-Alternative, die behält, was die bezahlten Kits hinzufügen, also Teams,
Abrechnung und ein Admin-Panel, ist Seed: ein Starter unter MIT-Lizenz mit Gruppen und Rollen,
Stripe-Abrechnung pro Mitglied und einer Admin-App auf eigener Domain. Makerkits eigenes kostenloses
Kit, Lite, lässt diese drei weg. Für eine kleinere kostenlose Basis gibt es den Next.js SaaS
Starter, unter den bezahlten Kits Supastarter. Die bezahlten Makerkit-Kits kosten einmalig 299 oder
599 $.

Ich entwickle Seed, lesen Sie das also mit diesem Wissen. Jede Angabe zu einem fremden Produkt
verlinkt ihre Quelle, und ich habe jede Seite am 4. November 2026 gelesen. Hat sich etwas
geändert? [Eröffnen Sie ein Issue](https://github.com/spy4x/seed/issues), ich korrigiere es.

## Was bietet Makerkit, und was fehlt in Lite?

[Makerkit](https://makerkit.dev/) liefert Kits auf drei Datenschichten (Supabase; Drizzle mit
Better Auth; Prisma mit Better Auth) für Next.js 16, TanStack Start und, mit Supabase, React
Router 8. Die Startseite nennt Anmeldung per Passwort, Magic Links, optionale Passkeys, OAuth und
Authenticator-App; Team-Konten mit Rollen und Einladungen; Stripe-Abos pauschal, pro Platz oder
nach Verbrauch; einen Super-Admin, der sich als Nutzer anmelden oder ihn sperren kann;
Übersetzungen; Blog und Doku; und Echtzeit-Benachrichtigungen in den Supabase-Kits. Für
KI-Coding-Agenten gibt es Regeln, Skills und einen MCP-Server.

Die [Preisseite](https://makerkit.dev/pricing) zeigt zwei Einmallizenzen mit Updates auf
Lebenszeit:

- **Pro**, 349 $, auf den Kit-Karten 299 $: ein Entwickler, beliebig viele Projekte.
- **Teams**, 649 $, auf den Kit-Karten 599 $: bis zu fünf Personen im Repository.

Lesen Sie die Lizenzbedingungen vor dem Kauf, denn zwei davon überraschen viele. Freelancer brauchen
für jeden Kunden eine eigene Lizenz. Und ein Projekt auf einem bezahlten Kit darf nicht als Open
Source veröffentlicht werden; dafür verweist die Seite auf Lite. Erstattungen gibt es nach dem
Zugang in der Regel nicht, deshalb rät die Seite, zuerst Lite anzusehen.

[Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) ist kostenlos und MIT,
etwa 470 Sterne auf GitHub: Next.js, Anmeldung über Supabase, Profilseiten, i18n und
Marketingseiten. Sein README listet auf, was fehlt, und diese Liste ist das Herz eines
Team-Produkts: Abrechnung, Team-Konten, Mail-Vorlagen, das Super-Admin-Panel, Blog und Doku.

## Makerkit und die Alternativen in einer Tabelle

| Starter                                                                   | Preis                                          | Lizenz                               | Stack                                     | Teams und Abrechnung              | Hosting                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------ | ----------------------------------------- | --------------------------------- | ----------------------------------------- |
| [Makerkit](https://makerkit.dev/pricing)                                  | 299 oder 599 $ einmalig (Listenpreis 349, 649) | Bezahlt, kein Open Source, pro Kunde | Next.js, React Router oder TanStack Start | Ja, pro Platz                     | Vercel empfohlen; Cloudflare, Docker, VPS |
| [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) | Kostenlos                                      | MIT                                  | Next.js, Supabase                         | Nein                              | Nicht genannt                             |
| [Seed](https://github.com/spy4x/seed)                                     | Kostenlos                                      | MIT                                  | Hono, Preact; Postgres                    | Ja, pro Mitglied                  | Eigener Server, Docker Compose            |
| [Supastarter](https://supastarter.dev/)                                   | 349, 799 oder 1.499 $ einmalig                 | Bezahlt, keine Weitergabe            | Next.js, Nuxt oder TanStack Start         | Ja, pro Platz                     | Vercel, Docker, Coolify und andere        |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)            | Kostenlos                                      | MIT                                  | Next.js, Drizzle; Postgres                | Owner und Member; Stripe Checkout | Vercel                                    |

Die Hosting-Zeile von Makerkit stammt aus seiner
[Checkliste für die Produktion](https://makerkit.dev/docs/next-supabase-turbo/going-to-production/checklist):
Vercel ist dort empfohlen, Docker oder ein VPS bedeuten „mehr Einrichtung“. Die
[Vergleichsseite](/de/compare) stellt 19 Funktionen von sechs Startern nebeneinander.

## DSGVO: Wo liegen die Daten Ihrer Kunden?

Jeder externe Dienst mit personenbezogenen Daten ist ein Auftragsverarbeiter mehr. Makerkits
empfohlener Weg ist Vercel mit Supabase, dazu nach Wahl Sentry oder PostHog: schnell drei oder vier
Anbieter. Mit den Drizzle- und Prisma-Kits und den Docker- oder VPS-Anleitungen geht es auch auf
einem eigenen Server.

Seed läuft komplett auf einem Server, den Sie selbst mieten, zum Beispiel bei einem Hoster in
Deutschland: Postgres, Dateispeicher, Monitoring und Hintergrundjobs inklusive. Dazu kommt nur, was
Sie einschalten, etwa Stripe und ein Mail-Anbieter. Das ist keine Rechtsberatung und macht Ihr
Produkt nicht automatisch DSGVO-konform, aber die Liste der Auftragsverarbeiter bleibt kurz.

## Welche kostenlose Alternative hat, was Makerkit Lite fehlt?

**Seed** hat alle drei fehlenden Teile. Jede Person bekommt bei der Registrierung eine Gruppe mit
Rollen vom Leser über Bearbeiter und Admin bis zum Inhaber. Stripe rechnet pro Mitglied ab, mit
kostenlosem Plan, 14 Tagen Testphase und einer Schonfrist nach einer fehlgeschlagenen Zahlung. Eine
Admin-App auf eigener Domain findet eine Person, erstattet eine Zahlung und schreibt jede Aktion ins
Audit-Log. Anmeldung per Passwort, Passkeys, Anmeldecodes per E-Mail, Google und GitHub, dazu eine
Authenticator-App als zweiter Faktor. Dazu kommt, was keine Makerkit-Seite nennt: eine App, die
offline startet und Änderungen in eine Warteschlange stellt, und Server-Monitoring (VictoriaMetrics,
Grafana) und Backups in der Compose-Datei.

Weil Seed unter MIT steht, gibt es die zwei Lizenz-Überraschungen nicht: Veröffentlichen Sie Ihr
Produkt als Open Source oder bauen Sie zehn Kundenprojekte darauf, eine zweite Lizenz braucht
niemand. Ich baue die MVPs meiner eigenen Kunden auf Seed, das ist also keine Theorie.

**Der Next.js SaaS Starter**, etwa 16.300 Sterne, liegt zwischen Lite und den bezahlten Kits:
Teams mit Owner und Member, Stripe Checkout und Customer Portal auf Next.js, Drizzle und Postgres,
ohne Admin-Panel.

## Was kostet das Hosting zusätzlich?

Makerkits Checkliste empfiehlt Vercel, und sein Haupt-Kit läuft auf Supabase. Das Paar kostet jeden
Monat, pro Entwicklerplatz und pro Datenbank. Seed läuft auf einem gemieteten Server. Wählen Sie
Server und Teamgröße:

<HostingCost server="cx23" developers={1} />

Mit einem Entwickler kostet Seed auf dem CX23 12,48 € im Monat, Vercel Pro und Supabase Pro 45 $.
Das ist kein Vergleich eins zu eins: Das verwaltete Paar patcht, skaliert und sichert für Sie. Wie
Seed auf den Server kommt, steht in der [Deploy-Anleitung](/de/docs/deploy).

## Wann lohnt sich Makerkit?

- **Sie wollen Supabase.** Makerkits Haupt-Kit baut auf dessen Anmeldung, Speicher und Row Level
  Security. Seed hat sein eigenes Postgres und seine eigene Anmeldung.
- **Sie wollen Next.js oder React Router.** Seed ist durchgehend Preact, auch die öffentliche Website.
- **Sie brauchen Anmeldung als Nutzer, Abrechnung nach Verbrauch oder einen zweiten
  Zahlungsanbieter.** Makerkit nennt die ersten beiden, und seine Startseite nennt Polar neben
  Stripe. Seed hat keins davon; Stripe ist sein einziger Anbieter.
- **Sie arbeiten mit KI-Coding-Agenten.** Makerkit liefert einen MCP-Server und Agent-Skills. Seed
  hat [Anleitungen für Agenten](/de/docs/ai-agents), aber keinen MCP-Server
  ([#211](https://github.com/spy4x/seed/issues/211)).
- **Sie wollen einen Maintainer mit Geschichte.** Makerkit schreibt, dass es seit 2022 in Vollzeit
  gepflegt wird. Seed ist jung und hat einen Maintainer, mich.

## Wie probiere ich Seed aus, bevor ich mich entscheide?

Öffnen Sie die [Live-Demo](https://app.seedsaas.com): Ein Klick öffnet ein Gastkonto mit
Beispieldaten, und in zwei Minuten haben Sie ein Team angelegt, jemanden eingeladen und die
Abrechnung geöffnet. Dann klonen Sie [das Repository](https://github.com/spy4x/seed). Und wenn
Makerkit besser passt, probieren Sie zuerst Lite, wie es die eigene Preisseite empfiehlt. Weitere
Optionen: [Supastarter-Alternative](/de/blog/supastarter-alternative).
