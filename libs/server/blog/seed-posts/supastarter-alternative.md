---
slug: supastarter-alternative
language: de
translationOf: supastarter-alternatives
title: "Supastarter-Alternative gesucht? Kostenlose und bezahlte SaaS-Starter für Teams"
seoTitle: "Supastarter-Alternative: SaaS-Starter für Teams im Vergleich"
description: "Supastarter kostet einmalig 349 bis 1.499 $. Kostenlose und bezahlte Alternativen mit Organisationen und Abrechnung pro Platz, mit Quellen und Blick auf die DSGVO."
tldr:
  - Supastarter ist ein bezahltes Kit für Next.js, Nuxt oder TanStack Start, einmalig 349, 799 oder 1.499 $.
  - Seed ist eine kostenlose MIT-Alternative mit Gruppen, Rollen und Stripe-Abrechnung pro Mitglied.
  - Der engste bezahlte Konkurrent ist Makerkit, der kleinste kostenlose der Next.js SaaS Starter.
  - Bleiben Sie bei Supastarter, wenn Sie Vue, einen anderen Zahlungsanbieter als Stripe oder KI-Beispiele wollen.
topic: Fragen
intro: "Supastarter ist eines der vollständigsten bezahlten SaaS-Kits, mit Organisationen, Abrechnung pro Platz und fünf Zahlungsanbietern. Es kostet aber 349 bis 1.499 $. Ich habe es mit den kostenlosen und bezahlten Alternativen verglichen, die ebenfalls Teams können, mit einer Quelle zu jeder Angabe."
relatedFeature: groups
coverAlt: "Ein langes violettes Ruderboot mit vielen Riemen und leeren Sitzen an einem Steg, an dem eine graue Jacht mit leerem Preisschild liegt."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-04T09:00:00Z
newsletter: false
---

Die wichtigsten Alternativen zu Supastarter für ein Produkt, das an Teams verkauft wird, sind Seed,
ein kostenloser Starter unter MIT-Lizenz mit Gruppen, Rollen und Stripe-Abrechnung pro Mitglied,
und Makerkit, ein bezahltes Kit ab 299 $. Wer eine kleinere kostenlose Basis sucht, findet den
Next.js SaaS Starter und Open SaaS, muss dort aber Teams oder Abrechnung selbst bauen. Supastarter
selbst kostet einmalig 349, 799 oder 1.499 $ und unterstützt mehr Zahlungsanbieter als alle
anderen hier.

Ich entwickle Seed, bin also nicht neutral. Deshalb verlinkt jede Angabe zu einem fremden Produkt
ihre Quelle, ich habe jede Seite am 4. November 2026 gelesen, und es gibt einen Abschnitt dazu,
wann Supastarter die bessere Wahl ist. Eine Angabe ist veraltet?
[Eröffnen Sie ein Issue](https://github.com/spy4x/seed/issues), ich korrigiere sie.

## Was bekommt man bei Supastarter?

[Supastarter](https://supastarter.dev/) ist ein bezahlter Starter für Next.js, Nuxt oder TanStack
Start. Die Startseite nennt drei Einmalpreise mit Updates auf Lebenszeit:

- **Solo**, 349 $: ein Entwickler, beliebig viele eigene Projekte, kommerzielle Nutzung.
- **Startup**, 799 $: bis zu fünf Entwickler, Projekte des Teams, ein 60-minütiges
  Beratungsgespräch und bevorzugter E-Mail-Support.
- **Agency**, 1.499 $: bis zu zehn Entwickler, Kundenprojekte, White Label und ein privater
  Discord-Kanal mit dem Gründer.

Enthalten sind: Anmeldung über Better Auth mit Passwort, Passkeys, Magic Links, OAuth und zweitem
Faktor; Organisationen mit Einladungen, Rollen und Abrechnung pro Platz; Stripe, Lemon Squeezy,
Polar, Creem und Dodo Payments; ein Super-Admin, der sich als Nutzer anmelden kann; i18n; ein
MDX-Blog und Doku; Hintergrundjobs über trigger.dev oder QStash; S3-Dateispeicher; Sentry und ein
KI-Chatbot als Beispiel. Prisma oder Drizzle laufen standardmäßig auf PostgreSQL, und die
[Doku](https://supastarter.dev/docs/nextjs) hat Deploy-Anleitungen für Vercel, Render, Fly.io,
Netlify, Docker, Coolify und Railway.

Die [Lizenz](https://supastarter.dev/legal/license) erlaubt beliebig viele Produkte, für sich oder
für Kunden, auch zum Verkauf. Den Code weitergeben oder die Lizenz teilen dürfen Sie nicht, und ein
öffentliches Repository braucht die Erlaubnis des Autors. Eine Erstattungsregel habe ich auf den
gelesenen Seiten nicht gefunden; fragen Sie also vor dem Kauf.

## Supastarter und die Alternativen in einer Tabelle

| Starter                                                        | Preis                                 | Lizenz                      | Stack                                       | Teams und Rollen         | Hosting                                   |
| -------------------------------------------------------------- | ------------------------------------- | --------------------------- | ------------------------------------------- | ------------------------ | ----------------------------------------- |
| [Supastarter](https://supastarter.dev/)                        | 349, 799 oder 1.499 $                 | Bezahlt, keine Weitergabe   | Next.js, Nuxt oder TanStack Start; Postgres | Ja, Abrechnung pro Platz | Vercel, Docker, Coolify und andere        |
| [Seed](https://github.com/spy4x/seed)                          | Kostenlos                             | MIT                         | Hono, Preact; Postgres                      | Ja, pro Mitglied         | Eigener Server, Docker Compose            |
| [Makerkit](https://makerkit.dev/pricing)                       | 299 oder 599 $ (Listenpreis 349, 649) | Bezahlt; Lite-Kit unter MIT | Next.js, React Router oder TanStack Start   | Ja, pro Platz            | Vercel empfohlen; Cloudflare, Docker, VPS |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) | Kostenlos                             | MIT                         | Next.js, Drizzle; Postgres                  | Owner und Member         | Vercel                                    |
| [Open SaaS](https://github.com/wasp-lang/open-saas)            | Kostenlos                             | MIT                         | Wasp (React, Node.js, Prisma); Postgres     | Nicht genannt            | Railway oder Fly.io, oder jeder Host      |

„Nicht genannt“ heißt, dass die Seiten des Produkts es nicht erwähnen, nicht dass es sich nie
nachrüsten lässt. Die Preisseite von Makerkit streicht 349 und 649 $ durch und verlangt 299 und 599
$; die FAQ nennt noch 349 und 649 $. Die [Vergleichsseite](/de/compare) stellt 19 Funktionen von
sechs Startern nebeneinander.

## DSGVO: Wo liegen die Daten Ihrer Kunden?

Jeder externe Dienst, der personenbezogene Daten verarbeitet, ist ein Auftragsverarbeiter mehr.
Supastarters Anleitungen beginnen mit Vercel, dazu kommen eine verwaltete Datenbank wie Supabase
oder Neon, Jobs über trigger.dev oder QStash und Sentry: schnell vier oder fünf Anbieter. Supastarter
läuft laut Doku aber auch in Docker oder mit Coolify auf einem eigenen Server.

Seed läuft komplett auf einem Server, den Sie selbst mieten, zum Beispiel bei einem Hoster in
Deutschland: Postgres, Dateispeicher, Monitoring und Hintergrundjobs inklusive. Dazu kommt nur, was
Sie einschalten, etwa Stripe und ein Mail-Anbieter. Das macht Ihr Produkt nicht automatisch
DSGVO-konform, und dies ist keine Rechtsberatung, aber die Liste der Auftragsverarbeiter bleibt
kurz.

## Gibt es eine kostenlose Supastarter-Alternative mit Teams und Abrechnung?

Ja, und genau diese Lücke lassen die meisten kostenlosen Kits offen. Sie hören bei Anmeldung und
Stripe Checkout auf; Teams, Rollen und ein Preis pro Mitglied sind der Teil, für den man Supastarter
bezahlt hätte.

**Seed** hat diesen Teil. Jede Person bekommt bei der Registrierung eine Gruppe mit Rollen vom Leser
über Bearbeiter und Admin bis zum Inhaber, und Stripe rechnet pro Mitglied ab, mit kostenlosem Plan,
14 Tagen Testphase und einer Schonfrist nach einer fehlgeschlagenen Zahlung. Anmeldung per Passwort,
Passkeys, Anmeldecodes per E-Mail, Google und GitHub, dazu eine Authenticator-App als zweiter
Faktor. Eine Admin-App auf eigener Domain findet eine Person, erstattet eine Zahlung und schreibt
jede Aktion ins Audit-Log. Über Supastarters Liste hinaus hat Seed Echtzeit-Updates per WebSocket,
eine App, die offline startet und Änderungen in eine Warteschlange stellt, neun Sprachen
einschließlich Deutsch und Arabisch von rechts nach links, und Server-Monitoring (VictoriaMetrics,
Grafana) und Backups in der Compose-Datei.

**Der Next.js SaaS Starter**, etwa 16.300 Sterne auf GitHub, ist der kleine, ehrliche: E-Mail und
Passwort, Stripe Checkout, Teams mit Owner und Member. An einem Nachmittag gelesen, den Rest bauen
Sie selbst.

**Open SaaS**, ebenfalls etwa 16.300 Sterne, hat ein Admin-Dashboard, S3-Uploads, Hintergrundjobs
und Stripe, Polar oder Lemon Squeezy, aber sein README nennt keine Teams.

## Was kostet das Hosting zusätzlich?

Die Lizenz zahlt man einmal, die Hosting-Rechnung jeden Monat. Supastarters Anleitungen beginnen
mit Vercel, und eine verwaltete Datenbank wie Supabase ist eine seiner Datenbank-Anleitungen. Seed
läuft auf einem gemieteten Server. Verschieben Sie den Regler, um Vercel Pro und Supabase Pro mit
Seed auf einem Hetzner-Server zu vergleichen:

<HostingCost server="cx23" developers={1} />

Mit einem Entwickler kostet Seed auf dem CX23 12,48 € im Monat, das verwaltete Paar 45 $. Wie Seed
auf einen Server kommt, steht in der [Deploy-Anleitung](/de/docs/deploy). Auch Supastarter läuft
in Docker auf einem eigenen Server: Der Abstand oben ist der Preis des verwalteten Wegs, nicht der
von Supastarter.

## Wann ist Supastarter die bessere Wahl?

- **Sie schreiben Vue.** Supastarter hat eine Nuxt-Ausgabe. Seed ist Preact, Makerkit React.
- **Sie brauchen heute einen anderen Anbieter als Stripe.** Supastarter hat fünf. Zwei davon,
  [Lemon Squeezy](https://www.lemonsqueezy.com/) und [Polar](https://polar.sh/), nennen sich
  Merchant of Record: Sie verkaufen in Ihrem Namen und nehmen Ihnen die Umsatzsteuer ab. Seed
  rechnet nur über Stripe ab; ein Merchant-of-Record-Anbieter ist eine offene Idee
  ([#584](https://github.com/spy4x/seed/issues/584)), kein Plan.
- **Sie wollen nutzungsbasierte Abrechnung, Anmeldung als Nutzer oder ein KI-Chatbot-Beispiel.**
  Supastarter nennt alle drei. Seed hat keins davon.
- **Sie deployen auf Vercel oder Serverless.** Seed braucht einen Server, den Sie kontrollieren.
- **Sie wollen ein bezahltes Gespräch und einen Verkäufer, der antwortet.** Startup und Agency
  enthalten eines. Bei Seed gibt es GitHub-Issues und mich.

Und wägen Sie die Risiken von Seed ab: ein junges Projekt mit einem Maintainer. API und Worker
laufen auf Deno, Node oder Bun ([Doku](https://github.com/spy4x/seed/blob/main/docs/apps.md)), die
Tasks und Tests brauchen aber noch Deno.

## Wie probiere ich Seed aus, bevor ich 349 $ ausgebe?

Öffnen Sie die [Live-Demo](https://app.seedsaas.com): Ein Klick meldet Sie in einem Gastkonto mit
Beispieldaten an, und in zwei Minuten haben Sie ein Team angelegt, jemanden eingeladen und die
Abrechnung geöffnet. Passt es, klonen Sie [das Repository](https://github.com/spy4x/seed). Wenn
nicht: Supastarter ist ein gutes Kit, und die Seite zur
[ShipFast-Alternative](/de/blog/shipfast-alternative) vergleicht sieben weitere.
