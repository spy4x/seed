---
slug: open-saas-alternativen
language: de
translationOf: open-saas-alternatives
title: "Open SaaS Alternativen: wenn das kostenlose Wasp-Template nicht passt"
seoTitle: "Open SaaS (Wasp) Alternativen: kostenlose und bezahlte SaaS-Starter"
description: "Open SaaS ist kostenlos, MIT-lizenziert und baut auf Wasp, hat aber keine Teams. Wer an Teams verkauft oder einfachen Code auf dem eigenen Server will: die Alternativen."
tldr:
  - Open SaaS ist kostenlos und MIT, mit Zahlungen, Admin-Dashboard und Datei-Uploads, gebaut auf Wasp.
  - Es kennt keine Teams oder Organisationen, jedes Abo gehört genau einer Person.
  - Für Produkte, die Teams kaufen, schauen Sie sich Seed (kostenlos, MIT) oder die bezahlten Makerkit und Supastarter an.
  - Bleiben Sie bei Open SaaS, wenn Einzelne kaufen, Sie mit einem Befehl deployen oder Polar und Paddle wollen.
topic: Fragen
intro: "Open SaaS ist eines der besten kostenlosen SaaS-Templates, ehrlich. Es trifft aber zwei Entscheidungen für Sie: ein Abo pro Person und das Framework Wasp. Hier steht, was Sie nehmen, wenn eine davon nicht passt."
relatedFeature: groups
coverAlt: "Ein Gewächshaus aus Glas mit einem großen gemeinsamen Pflanzkasten violetter Pflanzen darin und einer Reihe von fünf kleinen Töpfen neben der offenen Tür."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

Open SaaS ist eines der stärksten kostenlosen SaaS-Templates: MIT-Lizenz, rund 16.250 Sterne auf
GitHub, mit Zahlungen, Admin-Dashboard und Datei-Uploads an Bord. Eine Alternative brauchen Sie in
drei Fällen: Sie verkaufen an Teams (Open SaaS hat keine Organisationen), Sie wollen nicht auf dem
Framework Wasp aufbauen, oder Sie wollen es auf dem eigenen Server betreiben. Dann lohnt ein Blick
auf Seed (kostenlos, MIT, mit Teams und Abrechnung pro Mitglied) oder die bezahlten Makerkit und
Supastarter.

Ich entwickle Seed, ich bin also nicht neutral. Jede Angabe zu einem anderen Produkt verlinkt ihre
Quelle, und ich habe alle am 4. November 2026 geprüft. Etwas veraltet?
[Öffnen Sie ein Issue](https://github.com/spy4x/seed/issues), ich korrigiere es.

## Was bekommen Sie mit Open SaaS?

[Open SaaS](https://github.com/wasp-lang/open-saas) ist ein kostenloses Template vom Team hinter
dem Framework Wasp. Die README listet viel für null Euro:

- Registrierung per E-Mail mit Bestätigung, dazu Google, GitHub und Discord, die sich in der
  [Login-Konfiguration](https://github.com/wasp-lang/open-saas/blob/main/template/app/src/auth/auth.wasp.ts)
  einschalten lassen;
- Zahlungen über Stripe, Polar oder Lemon Squeezy, und der Code enthält auch eine
  Paddle-Anbindung;
- ein Admin-Dashboard auf shadcn/ui, Datei-Uploads zu AWS S3 und E-Mail über SendGrid, Mailgun
  oder SMTP;
- Plausible oder Google Analytics, eine Demo-App mit OpenAI, eine Doku-Seite mit Blog auf Astro und
  End-to-End-Tests mit Playwright;
- Regeln, Skills und ein Claude-Code-Plugin für KI-Coding-Agenten.

Und es lebt: Der letzte Commit stammt vom 28. Oktober 2026.

Was fehlt, sind Teams. Das
[Datenbankschema](https://github.com/wasp-lang/open-saas/blob/main/template/app/schema.prisma) hat
einen `User` mit einem `isAdmin`-Feld und kein Team- oder Organisationsmodell, ein Abo gehört also
einer Person. Für ein Tool, das jeder für sich kauft, ist das genau richtig. Für ein B2B-Produkt
sind Teams, Einladungen, Rollen und Abrechnung pro Platz Ihre ersten Wochen Arbeit.

## Was bedeutet es, auf Wasp zu bauen?

Wasp ist ein Full-Stack-Framework: Seiten, Routen, Login, Jobs und Server-Operationen beschreiben
Sie in einer einzigen Datei, `main.wasp.ts`, und Wasp baut daraus die App auf React, Node.js und
Prisma ([Wasp-Doku](https://wasp.sh/docs)). Das spart viel Verdrahtung, und genau dafür ist es da.

Der Preis: Ihre App nimmt die Form des Frameworks an. Sie lernen seine Spezifikation, Sie
aktualisieren, wenn es aktualisiert, und Wasp ist noch vor 1.0: Die neueste Version ist
[0.26.1 vom 23. Oktober 2026](https://github.com/wasp-lang/wasp/releases). Viele Teams fahren gut
damit. Treffen Sie diese Wahl nur bewusst und nicht nebenbei.

Das Deployment ist einfach: `wasp deploy` bringt Datenbank, Server und Client mit einem Befehl zu
Fly.io oder Railway, und der manuelle Weg führt zu jedem Hoster
([Deploy-Anleitung](https://docs.opensaas.sh/guides/deploying/)). Docker erwähnt die Anleitung
nicht.

## Die Alternativen im Vergleich

| Funktion         | Open SaaS                            | Seed                                   | Makerkit                               | Supastarter                            |
| ---------------- | ------------------------------------ | -------------------------------------- | -------------------------------------- | -------------------------------------- |
| Preis            | Kostenlos                            | Kostenlos                              | 299 $ oder 599 $, einmalig             | 349 $ bis 1.499 $, einmalig            |
| Lizenz           | MIT                                  | MIT                                    | Kostenpflichtig; das Lite-Kit ist MIT  | Kostenpflichtig                        |
| Stack            | Wasp (React, Node.js, Prisma)        | Hono, Preact; Postgres                 | Next.js 16 oder TanStack Start u. a.   | Next.js, Nuxt oder TanStack Start      |
| Teams und Rollen | Nein                                 | Ja, vom Betrachter bis zum Inhaber     | Ja, mit Einladungen und Berechtigungen | Ja, mit Einladungen und Rollen         |
| Zahlungen        | Stripe, Polar, Lemon Squeezy         | Stripe, pro Mitglied                   | Nicht geprüft                          | Stripe, Lemon Squeezy und drei weitere |
| Admin            | Admin-Dashboard                      | Eigene App auf eigenem Host, Audit-Log | Nicht im Lite-Kit                      | Nicht geprüft                          |
| Hosting          | Fly.io oder Railway mit einem Befehl | Docker Compose auf Ihrem Server        | Nicht geprüft                          | Vercel, Serverless oder Docker         |

Quellen: [Open-SaaS-README](https://github.com/wasp-lang/open-saas),
[Makerkit-Preise](https://makerkit.dev/pricing), [Supastarter](https://supastarter.dev/) und die
[README von Seed](https://github.com/spy4x/seed). Makerkits Preise sind die reduzierten, die
Listenpreise liegen bei 349 $ und 649 $. „Nicht geprüft“ heißt, dass ich es auf den gelesenen
Seiten nicht gefunden habe, nicht, dass es fehlt.

## Welche Alternative passt zu einem Produkt für Teams?

Genau dafür habe ich Seed gebaut. Jede Person bekommt bei der Registrierung eine Gruppe, Gruppen
haben Rollen vom Betrachter bis zum Inhaber und Einladungen per E-Mail, und Stripe rechnet pro
Mitglied ab: Die Menge folgt der Mitgliederzahl, mit kostenlosem Plan, 14 Tagen Testphase und einer
Schonfrist nach einer fehlgeschlagenen Zahlung
([Abrechnungs-Doku](https://github.com/spy4x/seed/blob/main/docs/billing.md)). Wie das aussieht,
zeigt die [Seite zu Gruppen](/de/features/groups).

Das übrige Fundament steht ebenfalls:

- Login per Passwort, Passkey, Google, GitHub oder E-Mail-Code, Gastkonten und eine
  Authenticator-App als zweiter Faktor;
- eine Admin-App auf eigenem Host, in der jede Aktion ins Audit-Log geht;
- Echtzeit-Updates über WebSocket und eine App, die offline startet und Änderungen speichert;
- ein Dateispeicher, neun Sprachen mit Arabisch von rechts nach links, Backups und Monitoring in
  der Compose-Datei.

Es ist schlichtes TypeScript auf Hono und Preact, ohne Spezifikationsdatei oder Codegenerator
zwischen Ihnen und dem Code. Es läuft mit Docker Compose auf einem gemieteten Server, die Rechnung
ist also ein fester Monatspreis.

Bei den bezahlten Kits haben **Makerkit** und **Supastarter** beide Organisationen mit Einladungen
und Rollen, und Supastarter rechnet pro Platz ab. Das kostenlose Makerkit Lite hat weder Teams noch
Abrechnung.

## Wann ist Open SaaS die bessere Wahl?

- Sie verkaufen an Einzelne und wollen Zahlungen, Admin-Dashboard und Uploads, kostenlos und
  sofort.
- Ihnen gefällt Wasps Modell: eine Spezifikationsdatei und viel weniger Verdrahtung.
- Sie wollen Polar, Lemon Squeezy oder Paddle. Seed rechnet nur über Stripe ab; ein Merchant of
  Record ist eine offene Idee ([#584](https://github.com/spy4x/seed/issues/584)), kein Plan.
- Sie wollen mit einem Befehl zu Fly.io oder Railway deployen, ohne Server zu pflegen.
- Sie wollen eine große Community: Wasp hat einen [Discord](https://discord.gg/rzdnErX), und Open SaaS hat weit mehr Sterne auf
  GitHub als Seed.

Die Risiken von Seed, damit Sie ehrlich abwägen können: Es ist ein junges Projekt mit einem
einzigen Maintainer. API und Worker laufen mit einer Zeile in der env-Datei auch auf Node oder Bun
([zur Laufzeit](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), Website und
Tooling brauchen aber weiterhin Deno. Die Android- und Desktop-Apps
[gibt es noch nicht](https://github.com/spy4x/seed/issues/202).

## Wie vergleiche ich beide an einem Nachmittag?

1. Legen Sie mit `wasp new -t saas` eine Open-SaaS-App an, wie es die README beschreibt.
2. Öffnen Sie die [Live-Demo](https://app.seedsaas.com) von Seed: Ein Klick meldet Sie in einem
   Gastkonto mit Beispieldaten an.
3. Probieren Sie in beiden, was Ihre Kunden am ersten Tag tun. Kommen sie als Team, laden Sie eine
   Kollegin ein und öffnen Sie die Abrechnung.

Meine anderen Vergleiche: [ShipFast-Alternativen](/de/blog/shipfast-alternative) stellt sieben
Boilerplates in eine Tabelle, und [der Leitfaden zum kostenlosen SaaS-Boilerplate](/de/blog/saas-boilerplate-kostenlos)
erklärt, was ein kostenloser Starter schon mitbringen sollte. Passt Seed, ist
[das Repository](https://github.com/spy4x/seed) nur einen Clone entfernt.
