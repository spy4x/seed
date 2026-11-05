---
slug: seed-laeuft-auf-deno-node-und-bun
language: de
translationOf: seed-runs-on-deno-node-and-bun
title: "Seed läuft jetzt auf Deno, Node und Bun"
seoTitle: "SaaS-Boilerplate für Node.js, Bun und Deno: Seed läuft auf allen"
description: "Die kostenlose SaaS-Boilerplate Seed läuft jetzt unverändert auf Deno, Node.js und Bun: Start auf deiner Runtime, Umstieg im Produkt, was noch Deno braucht."
tldr:
  - API, Worker, Migration und Website von Seed starten jetzt unverändert auf Deno, Node und Bun, und die CI prüft alle drei bei jedem Pull Request.
  - Eine Zeile in der Env-Datei, APP_RUNTIME=node oder bun, stellt die Server um. Ohne die Zeile bleibt Deno, ein Produkt ohne Änderung läuft also weiter.
  - Die öffentliche Website hat Fresh gegen eine kleine Schicht mit denselben Routen, Seiten und Islands getauscht. Jede Seite lädt weniger JavaScript.
  - Tasks und Tests laufen weiter auf Deno; npm oder Bun installieren es für dich.
topic: Neuigkeiten
intro: "Seed hängt nicht mehr an einer Runtime. Die Server starten unverändert auf Deno, Node und Bun, und eine Zeile in der Env-Datei wählt aus. Was das für ein neues Produkt heißt und was du in einem laufenden tun musst."
coverAlt: "Ein violetter Keimling im Topf auf einer Hügelkuppe, zu dem drei Wege hinaufführen: aus Trittsteinen, aus Holzplanken und aus Kies."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-10T09:00:00Z
newsletter: true
---

Seed, die kostenlose SaaS-Boilerplate, läuft jetzt auf Deno, Node.js und Bun. Die API, der
Hintergrund-Worker, die Datenbankmigration und die öffentliche Website starten auf jeder der drei
Runtimes ohne Codeänderung, und die CI fährt API, Worker und Website bei jedem Pull Request auf allen
dreien hoch. Eine Zeile in der Env-Datei wählt die Runtime der Server deines Produkts; fehlt sie,
bleibt alles auf Deno.

Der Beitrag richtet sich an zwei Leute: an dich, wenn du ein Starter-Kit suchst und dein Produkt
nicht an eine einzige Runtime binden willst, und an dich, wenn du schon ein Produkt auf Seed betreibst
und diese Änderung mit dem nächsten Sync bekommst. Jeder Abschnitt beantwortet eine Aufgabe. Wie der
Umzug selbst lief, Fehler inklusive, steht
[in meinem Blog](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun) (auf Englisch).

## Wie starte ich ein neues Produkt auf meiner Runtime?

Der Quick Start im README hat jetzt einen Abschnitt pro Runtime:
[Node](https://github.com/spy4x/seed#node), [Bun](https://github.com/spy4x/seed#bun) und
[Deno](https://github.com/spy4x/seed#deno). Du brauchst Docker und eine der drei. Mit Node:

```sh
npm install -g deno
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
npm run init
npm run dev
```

Ja, die erste Zeile installiert Deno. Deno zu verlassen, indem man Deno installiert, ist lustiger,
als mir lieb ist. Aber die Tasks von Seed laufen noch darauf (mehr dazu unten), und dank des
`deno`-Pakets auf npm braucht ein Rechner mit nur Node nichts weiter. Mit Bun lautet die erste Zeile
`bun add -g deno`, die letzten beiden `bun run init` und `bun run dev`. Die `gh`-Zeile ist optional:
„Use this template“ auf GitHub und ein Clone tun dasselbe.

Damit läuft der ganze Stack in Docker auf Deno. Sollen auch die Server deines Produkts auf Node oder
Bun laufen, setze vor `dev` eine Zeile in `infra/envs/.env`:

```sh
APP_RUNTIME=node   # oder bun; deno, leer oder keine Zeile behält Deno
```

## Was läuft auf Node oder Bun, und was ist dort anders?

Mit `APP_RUNTIME=node` oder `bun` laufen API, Worker, Migration und Website auf Node 26 oder Bun 1.4,
jeweils aus einem eigenen Docker-Image. Ports, Umgebungsvariablen und die Reihenfolge der Dienste
bleiben gleich. Die SPA und das Admin-Panel sind statische Dateien, für sie ändert sich nichts. Alle
Details stehen im [Runtime-Abschnitt der Doku](/de/docs/apps#runtime).

Drei Unterschiede zu Deno solltest du vor dem Umstieg kennen:

- **Kein Watch-Modus.** Der Code wird ins Image gebündelt, auf Node oder Bun siehst du eine Änderung
  also erst nach einem Rebuild, auch in der Entwicklung. Entwicklung mit Hot Reload bleibt auf Deno.
- **Keine Runtime-Berechtigungen für den Worker.** Unter Deno darf der Worker nur seinen Bildordner
  lesen und schreiben und nur `vips` starten. Node und Bun kennen solche Grenzen nicht: Dort begrenzen
  den Worker nur sein Container und sein Benutzer ohne Root-Rechte.
- **Du entscheidest.** Ohne Zeile, mit leerer Zeile oder mit `deno` bleibt alles auf Deno.

## Ich betreibe schon ein Produkt auf Seed. Was muss ich tun?

Hol dir die Änderung wie gewohnt, so wie es [die Produkt-Anleitung](/de/docs/products) beschreibt:
Seed holen, den Patch anwenden und den Commit festhalten:

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

Dann `deno task check` laufen lassen, bevor du den Pull Request öffnest. Ich habe diesen Sync auf
einer Kopie von Seed von kurz vor der Runtime-Arbeit ausprobiert, und der Patch ging ohne einen
einzigen Konflikt durch. In deinem Produkt kann es dort Konflikte geben, wo du Dateien von Seed
absichtlich geändert hast: Behalte dort deine Version, wie die Anleitung sagt.

Der Sync bringt die Docker-Images für Node und Bun, die Compose-Dateien, die auf sie umschalten, und
eine `package.json` im Wurzelverzeichnis. An deiner Runtime ändert er nichts. Willst du umziehen,
setze `APP_RUNTIME=node` (oder `bun`) in `infra/envs/.env` und baue die Images neu:

```sh
deno task compose up -d --build
```

Auf dem Server kommt dieselbe Zeile in dessen Env-Datei, dann deployst du wie immer
([Updates](/de/docs/deploy-updates)): Jedes Deployment baut die Images, die diese Zeile nennt.

## Was hat sich an der öffentlichen Website geändert?

Die Website läuft nicht mehr auf Fresh, sondern auf
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server), einer kleinen Open-Source-Schicht, die
die Routen, Seiten und Islands von Fresh 2 nachbildet. Der Code der Website hat sich deshalb kaum
verändert. Ich habe jede Route auf beiden Builds abgefragt: 419 von 423 Antworten waren identisch.
Die vier Abweichungen sind Änderungsdatum und ETag eines Videos sowie eine kaputte Adresse, die
früher einen nackten Fehler bekam und jetzt die 404-Seite der Website.

Außerdem sind die Seiten leichter geworden. JavaScript pro Seite nach gzip, gemessen mit Lighthouse
auf Mobilgeräten:

| Seite                  | Neue Schicht | Fresh   |
| ---------------------- | ------------ | ------- |
| Startseite             | 24.0 KB      | 32.1 KB |
| Blogbeitrag mit Island | 29.9 KB      | 38.0 KB |
| Doku                   | 8.6 KB       | 19.4 KB |

Beim Beitrag mit einem interaktiven Schieberegler blockiert die Seite Eingaben 5 ms lang, gegenüber
48 ms mit Fresh. Meine erste Version der Schicht war genau dort langsamer als Fresh, und die CI hat
es nicht bemerkt; wie ich es gefunden habe, steht in
[der ganzen Geschichte](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun).

Hast du die Website deines Produkts angepasst, bleiben nach dem Sync vielleicht Dateien übrig, die
noch Fresh importieren. So findest du sie, vom Wurzelverzeichnis aus:

```sh
grep -rlE 'from "fresh' apps/mpa
```

Stell jeden Import auf `@spy4x/preact-server` um (auch `fresh/runtime`) und benenne `FreshContext` in
`Context` um. Der Build-Ordner heißt jetzt `dist` statt `_fresh`. Die Seiten haben kein Inline-Skript
mehr, die Sicherheits-Header brauchen also keine Nonce pro Anfrage. Die Schicht ist eine erste
Version: Was sie kann und was sie weglässt, steht in
[ihrer Doku](https://github.com/spy4x/seed/blob/main/docs/website-server.md).

## Wofür braucht man noch Deno?

Für die Werkzeuge: Formatierung, Linter, Typprüfung, Tests und die Skripte hinter `deno task`. Die
`package.json` im Wurzelverzeichnis reicht die üblichen Tasks an Deno weiter, also funktionieren
auch `npm run test` und `bun run dev`. Die Tests bleiben beim Test-Runner von Deno. Ob sich das
ändert, entscheidet eine Überprüfung, die für den 10. Januar 2027 angesetzt ist
([die Runtime-Richtlinie](https://github.com/spy4x/seed/blob/main/docs/runtime-policy.md)). Die
Runtime, die deine Nutzer erreichen, bindet nichts davon an Deno.

## Warum hängt Seed nicht mehr an Deno?

Am 9. Oktober 2026 hat das Deno-Team [angekündigt](https://deno.com/blog/cloudflare), noch ein Jahr
lang Bugfixes und Sicherheitsupdates zu liefern und danach die eigene Entwicklung einzustellen. Deno
bleibt Open Source, und ich mag es nach wie vor. Aber ein Starter, auf dem du ein Geschäft aufbaust,
sollte dein Produkt nicht auf die Roadmap einer einzigen Runtime setzen, meine eingeschlossen. Seed
war schon auf Webstandards gebaut (Fetch, Web Crypto, WebSocket, ES-Module). Schwierig waren deshalb
das Ausliefern von Dateien, Deno-Typen in öffentlichen Signaturen und die Website-Schicht, nicht ein
Neuschreiben.

Probier den [Quick Start](https://github.com/spy4x/seed#quick-start) auf der Runtime aus, die du
ohnehin nutzt. Klappt ein Schritt nicht, [eröffne ein Issue](https://github.com/spy4x/seed/issues) mit
dem, was du ausgeführt hast, und ich behebe es.
