---
slug: nextjs-saas-starter-alternativen
language: de
translationOf: nextjs-saas-starter-alternatives
title: "Next.js SaaS Starter Alternativen: was tun, wenn er zu klein wird"
seoTitle: "Next.js SaaS Starter Alternativen, kostenlos und bezahlt"
description: "Der Next.js SaaS Starter ist kostenlos und bewusst klein: kein Passwort-Reset, keine Einladungs-Mails. Alternativen mit mehr an Bord, kostenlos und bezahlt."
tldr:
  - Der Next.js SaaS Starter ist kostenlos und MIT, mit Teams aus Inhaber und Mitglied und Stripe Checkout.
  - Er verschickt gar keine E-Mails, Einladungen, Passwort-Reset und Adressbestätigung bauen Sie selbst.
  - Kostenlos mit all dem fertig ist Seed; bei Next.js bleiben und mehr fertig haben heißt Makerkit oder Supastarter.
  - Behalten Sie den Starter, wenn Sie wenig Code zum Lernen wollen oder den Login selbst bauen.
topic: Fragen
intro: "Der Next.js SaaS Starter ist eine saubere, kleine Basis, und seine eigene README sagt, dass er zum Lernen gedacht ist. Hier steht, was ihm fehlt und welcher Starter passt, wenn Sie diese Teile fertig brauchen."
relatedFeature: sign-in
coverAlt: "Ein kleines Holzgerüst um einen einzelnen Keimling vor einem fertigen Glasgewächshaus voller violetter Pflanzen."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

Der Next.js SaaS Starter ist ein kostenloses Template unter MIT-Lizenz: Login mit E-Mail und
Passwort, Stripe Checkout und Teams mit den Rollen Inhaber und Mitglied. Seine README nennt ihn
bewusst minimal, eine Lernressource. Alternativen brauchen Sie, wenn mehr schon fertig sein soll:
Seed ist kostenlos und MIT, mit Einladungen, Passwort-Reset, Passkeys und Abrechnung pro Mitglied,
und Makerkit und Supastarter sind bezahlte Kits, mit denen Sie bei Next.js bleiben.

Ich entwickle Seed, lesen Sie das mit diesem Wissen. Jede Angabe zu einem anderen Produkt verlinkt
ihre Quelle, geprüft am 4. November 2026. Etwas veraltet?
[Öffnen Sie ein Issue](https://github.com/spy4x/seed/issues), ich korrigiere es.

## Was steckt im Next.js SaaS Starter?

Der [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) liegt in der Next.js-Organisation
auf GitHub, die meisten Commits stammen von Lee Robinson. Er hat rund 16.250 Sterne. Die README
listet:

- eine Landingpage und eine Preisseite, die Stripe Checkout öffnet;
- Login mit E-Mail und Passwort, mit JWTs in Cookies;
- ein Dashboard mit Teams und den Rollen Inhaber und Mitglied;
- Abo-Verwaltung im Customer Portal von Stripe;
- ein Aktivitätsprotokoll der Nutzer.

Der Stack: Next.js, Postgres mit Drizzle und shadcn/ui. Man liest ihn an einem Nachmittag komplett,
und genau das ist der Sinn.

## Was fehlt ihm?

Er verschickt keine E-Mails. Die `package.json` enthält keine Mail-Bibliothek, und eine Einladung
wird gespeichert, aber nicht verschickt; der Code sagt es selbst:
[`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454).
Passwort-Reset und E-Mail-Bestätigung gibt es im Code ebenfalls nicht.

Login heißt nur E-Mail und Passwort: kein Google, kein GitHub, keine Passkeys, kein zweiter Faktor.

Abgerechnet wird ein Abo pro Team. Checkout startet mit Menge eins und 14 Tagen Testphase, und die
Menge ändert sich nur, wenn jemand sie im Customer Portal anpasst
([stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)). Ein neues
Mitglied ändert die Rechnung nicht.

Und er bewegt sich langsam. Die letzten zwei Commits am 8. und 11. Dezember 2025 waren beide
Sicherheitsupdates für Next.js; der zweite hob ihn auf Next.js `15.6.0-canary.59`, um
CVE-2025-55182 zu schließen. Der davor war im Juni 2025.

Nichts davon ist ein Mangel für das, was der Starter sein will. Es heißt nur: Was ein zahlendes
Team zuerst braucht, schreiben Sie selbst.

## Die Alternativen im Vergleich

| Funktion         | Next.js SaaS Starter  | Seed                            | Open SaaS                    | Makerkit                              | Supastarter                            |
| ---------------- | --------------------- | ------------------------------- | ---------------------------- | ------------------------------------- | -------------------------------------- |
| Preis            | Kostenlos             | Kostenlos                       | Kostenlos                    | 299 $ oder 599 $, einmalig            | 349 $ bis 1.499 $, einmalig            |
| Lizenz           | MIT                   | MIT                             | MIT                          | Kostenpflichtig; das Lite-Kit ist MIT | Kostenpflichtig                        |
| Stack            | Next.js, Drizzle      | Hono, Preact; Postgres          | Wasp (React, Node.js)        | Next.js 16 oder TanStack Start u. a.  | Next.js, Nuxt oder TanStack Start      |
| Teams und Rollen | Inhaber und Mitglied  | Vom Betrachter bis zum Inhaber  | Nein                         | Ja, mit Einladungen                   | Ja, mit Einladungen                    |
| Einladungs-Mail  | Wird nicht verschickt | Ja                              | Keine Teams                  | Nicht geprüft                         | Nicht geprüft                          |
| Abrechnung       | Stripe, eins pro Team | Stripe, pro Mitglied            | Stripe, Polar, Lemon Squeezy | Nicht geprüft                         | Stripe, Lemon Squeezy und drei weitere |
| Hosting          | Vercel                | Docker Compose auf Ihrem Server | Fly.io oder Railway          | Nicht geprüft                         | Vercel, Serverless oder Docker         |

Quellen: [Next.js SaaS Starter](https://github.com/nextjs/saas-starter),
[Open SaaS](https://github.com/wasp-lang/open-saas), [Makerkit-Preise](https://makerkit.dev/pricing),
[Supastarter](https://supastarter.dev/) und die [README von Seed](https://github.com/spy4x/seed).
Makerkits Preise sind die reduzierten, die Listenpreise liegen bei 349 $ und 649 $. „Nicht geprüft“
heißt, dass ich es auf den gelesenen Seiten nicht gefunden habe, nicht, dass es fehlt.

## Welche Alternative soll ich nehmen?

**Sie wollen bei Next.js bleiben und mehr fertig haben.** Kaufen Sie Makerkit oder Supastarter.
Beide haben Organisationen mit Einladungen und Rollen; Supastarter rechnet pro Platz ab und bietet
fünf Zahlungsanbieter. Makerkit Lite ist kostenlos und MIT, aber ohne Teams und Abrechnung.

**Sie wollen es kostenlos, mit fertigen Teams.** Das ist Seed. Jedes Konto bekommt eine Gruppe, mit
Rollen vom Betrachter bis zum Inhaber; Einladungen gehen per E-Mail raus; Stripe rechnet pro
Mitglied ab, und die Menge folgt der Mitgliederzahl, mit kostenlosem Plan, 14 Tagen Testphase und
Schonfrist nach einer fehlgeschlagenen Zahlung. Der Login ist ebenfalls fertig: Passwort mit
Bestätigungscode, Passkeys, Google, GitHub, Anmeldecodes per E-Mail, Gastkonten und eine
Authenticator-App als zweiter Faktor ([Login in Seed](/de/features/sign-in)). Dazu eine Admin-App
mit Audit-Log, Echtzeit, eine Offline-App und neun Sprachen. Der Preis: Es ist kein Next.js,
sondern Hono und Preact.

**Sie verkaufen an Einzelne und mögen ein Framework, das die Verdrahtung übernimmt.** Schauen Sie
sich Open SaaS an; über [seine Alternativen](/de/blog/open-saas-alternativen) habe ich auch
geschrieben.

## Was kostet das Hosting: Vercel oder ein Server?

Die README des Starters deployt auf Vercel und nimmt jede Postgres-URL. Seed läuft auf einem
gemieteten Server. Hier beides, mit Vercel Pro und Supabase Pro als gängigem verwaltetem Paar;
wählen Sie einen Server und stellen Sie den Regler auf Ihr Team ein:

<HostingCost server="cx23" developers={1} />

Mit einem Entwickler kostet Seed auf einem Hetzner CX23 12,48 € im Monat und das verwaltete Paar
45 $, rund 40,12 € zum EZB-Kurs vom 2. November 2026. Das ist kein Vergleich eins zu eins: Beim
verwalteten Paar patcht niemand von Ihnen einen Server, und jemand anderes sichert die Datenbank.
Die ganze Rechnung mit jedem Preis und seiner Quelle steht in
[ein SaaS auf einem Hetzner-Server deployen](/blog/deploy-saas-to-one-hetzner-server) (auf
Englisch).

## Wann ist der Next.js SaaS Starter weiter die bessere Wahl?

- Sie wollen App Router und Server Actions an Code lernen, den man ganz lesen kann.
- Sie bauen Login und Abrechnung auf Ihre Art und wollen so wenig wie möglich löschen.
- Ihr Team kennt Next.js und React, und Sie deployen auf Vercel.

Die Risiken von Seed zum Abwägen: Es ist jung und hat einen einzigen Maintainer. API und Worker
laufen mit einer Zeile in der env-Datei auch auf Node oder Bun
([zur Laufzeit](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), Website und
Tooling brauchen aber weiterhin Deno.

## Wie teste ich Seed, bevor ich mich entscheide?

Öffnen Sie die [Live-Demo](https://app.seedsaas.com): Ein Klick meldet Sie in einem Gastkonto mit
Beispieldaten an. Laden Sie eine Kollegin ein und öffnen Sie die Abrechnung, genau das, was der
Next.js-Starter Ihnen überlässt. Passt es, klonen Sie [das Repository](https://github.com/spy4x/seed).
Für den breiteren Blick vergleicht [ShipFast-Alternativen](/de/blog/shipfast-alternative) sieben
Boilerplates in einer Tabelle.
