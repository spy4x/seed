---
slug: over-engineering-saas-boilerplate-fehler
language: de
translationOf: over-engineering-a-saas-boilerplate
title: "Was ich bei Seed v1 falsch gemacht habe: zu viel gebaut"
seoTitle: "Over-Engineering im SaaS-Boilerplate: meine Fehler bei Seed v1"
description: "Seed v1 hakte die Hälfte seiner Roadmap ab und fast nichts von dem, was ein Mensch benutzt. Wie Over-Engineering eines SaaS-Boilerplates im Code aussah, und was Seed heute tut."
tldr:
  - "Seed v1 (2019 bis 2022) hakte 33 von 66 Roadmap-Punkten ab, aber keinen der 17 für Web-Client, Admin-Bereich, PWA und Datei-Uploads."
  - "Es hatte 31 Nx-Projekte, 23 CQRS-Nachrichtenklassen und neun Cloud-Dienste rund um drei Datenbanktabellen."
  - "Over-Engineering heißt, ein Feature komplizierter zu bauen, als es nötig ist. Es heißt nicht, zu viele Features zu bauen."
  - "Seed baut heute jedes Feature von vorn bis hinten nach einer kopierten Form, auf einem Server, und hat jedes Produkt-Feature, das v1 nur geplant hatte."
topic: Lehrgeld
intro: "Seed hatte eine erste Version, von 2019 bis 2022, und ich habe sie überkonstruiert. So sah das in ihrer Roadmap, ihren Commits und ihren Ordnern aus, und das macht Seed heute anders."
relatedFeature: deploy
coverAlt: "Ein hohes violettes Baugerüst rund um einen winzigen Setzling im Topf, daneben ein schlichter Topf, in dem eine große Pflanze von allein wächst."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-07T09:00:00Z
newsletter: true
devto: false
---

Was habe ich bei Seed v1 falsch gemacht? Over-Engineering: Ich habe das Gerüst eines großen
Produkts gebaut, bevor es das Produkt gab. Die eigene Roadmap zeigt es. Von 66 Punkten waren 33
abgehakt, und diese Hälfte bestand vor allem aus Werkzeugen und Backend-Unterbau: ein Monorepo,
strenge Lint-Regeln, ein Pre-Commit-Hook, CQRS-Basisklassen, Deployments in die Google Cloud. In
der anderen Hälfte lag fast alles, was ein Mensch benutzt: Gruppen, Zahlungen, Echtzeit-Updates,
Offline-Betrieb, Datei-Uploads und der Admin-Bereich.

Dieser Beitrag ist für Entwicklerinnen und Entwickler, die ein eigenes SaaS-Boilerplate oder ihr
erstes SaaS bauen und den Verdacht haben, dass sie die Werkstatt polieren, statt Möbel zu bauen.
Jede Zahl unten stammt aus dem Code: v1 liegt noch immer im Repository, als Tag
[`v1-final`](https://github.com/spy4x/seed/tree/v1-final), und die Befehle, mit denen ich gezählt
habe, stehen im [Pull Request](https://github.com/spy4x/seed/pull/823) zu diesem Beitrag. Keine
Erinnerung kam zu Schaden; ich habe gezählt.

## Was war Seed v1?

Ein „Full-stack startup monorepo template“, so die eigene README, mit Best Practices ab Tag eins.
Angular im Frontend, Nest.js und Prisma auf PostgreSQL im Backend, Firebase für die Anmeldung,
Google Cloud für den Betrieb, Nx als Klammer und Yarn zum Installieren. Der erste Commit stammt vom
16. Juni 2019, der letzte vom 23. Dezember 2022: 134 Commits in dreieinhalb Jahren.

Es ist nicht langsam eingeschlafen. Es hörte auf: 55 dieser Commits fielen in die letzten zwei
Monate, danach kam nichts, bis Seed am 26. Januar 2026 mit einer neuen Historie neu begann.

## Was versprach die Roadmap, und was wurde gebaut?

Die Roadmap in der README markierte jeden Punkt als erledigt oder geplant. Zuletzt aktualisiert
wurde sie am 25. November 2022:

| Abschnitt der Roadmap                      | Erledigt | Geplant |
| ------------------------------------------ | -------: | ------: |
| Umgebung und Code-Organisation             |        8 |       7 |
| Backend                                    |       14 |       5 |
| Datenbank                                  |        3 |       1 |
| Gemeinsames Frontend (Login, State, Tests) |        6 |       3 |
| Styles                                     |        2 |       0 |
| PWA (offline, Push, installierbar)         |        0 |       4 |
| Datei-Uploads                              |        0 |       4 |
| Admin-Bereich                              |        0 |       3 |
| Web-Client (Gruppen, Echtzeit, Konto)      |        0 |       6 |
| **Summe**                                  |   **33** |  **33** |

Stripe-Abos standen unter Backend, geplant. Eine Benutzertabelle für den Admin-Bereich kam im
Dezember 2022 doch noch, nach dem letzten Roadmap-Update; die rechnen wir v1 an.

Drei der 33 Haken waren automatische Backups, das Wiederherstellen eines Backups und
Lese-Replikate. Jeder verlinkte auf die Dokumentation von Google Cloud SQL, und das
Infrastruktur-Dokument sagte, Replikation sei „not yet used“. Ich habe Googles Hausaufgaben
abgehakt.

## Wohin ging die Arbeit stattdessen?

In die Werkstatt. Commit-Nachrichten tragen ihren Typ, und der erzählt die Geschichte besser als
ich:

- **52 der 134 Commits haben den Typ `env` oder `environment`**: Konfiguration, Werkzeuge, CI,
  Updates und Umbenennungen. 31 sind `feat`.
- **Der erste Commit, mit dem ein Mensch überhaupt etwas tun kann** (eine einfache Benutzer-API:
  registrieren, eigenes Profil lesen und ändern), ist Nummer 38 vom 31. Mai 2021, fast zwei Jahre
  nach dem ersten. Unter den ersten 37 sind 28 `environment`-Commits.
- **CI wurde dreimal eingerichtet**: GitLab CI im Juli 2019, GitHub Actions im März 2021, Google
  Cloud Build im Juni 2021. Die letzte Roadmap führte CI/CD trotzdem noch als geplant.
- **Vier Umbenennungen von Apps und Ordnern an zwei Tagen** im Februar 2021, und ein Jahr später
  ein Commit namens „massive refactoring“.

## Wie viel Struktur für wie wenig Daten?

Das Datenbankschema von v1 hat drei Modelle: `User`, `UserDevice` und `Notification`. Drumherum:

- **31 Nx-Projekte**: drei Apps, zwei End-to-End-Test-Apps und 26 Bibliotheken. Allein die
  gemeinsame Anmeldung im Frontend bestand aus vier Bibliotheken: container, guards, state und UI.
- **65 `index.ts`-Dateien**, und 63 davon exportieren nur andere Dateien weiter.
- **Eine CQRS-Schicht mit eigenen Basisklassen** über den Bussen für Commands, Queries und Events,
  mit 11 Commands, 5 Queries und 7 Events sowie 19 Handlern.
- **Neun Cloud-Dienste** im Infrastruktur-Dokument (Cloud Run, Cloud SQL, Cloud Tasks, Cloud
  Logging, Cloud IAM, Firebase Authentication, Hosting und Storage sowie Sentry) und eine als „WIP“
  markierte Einrichtungsanleitung, die mit Handarbeit begann.
- **104 npm-Pakete** in der `package.json` im Wurzelverzeichnis, 50 davon Laufzeitabhängigkeiten.

Zum Vergleich: Seed hat heute 34 Workspace-Pakete rund um 73 Tabellen. Die Struktur wächst jetzt
mit den Daten, statt auf sie zu warten.

## Lag es an zu vielen Features?

Nein, und genau das will ich sauber trennen. Over-Engineering heißt, ein Feature komplizierter zu
bauen, als es nötig ist: zusätzliche Schichten, Schutz gegen seltene Timing-Fälle, Automatisierung,
die niemand startet. Es heißt nicht „dieses Feature ist überflüssig“. Die Wunschliste von v1 war in
Ordnung. Seed hat heute jedes Produkt-Feature, das v1 nur geplant hatte, und mehr: Passkeys und
einen zweiten Faktor, Gruppen mit Rollen und Einladungen, Stripe-Abrechnung pro Mitglied,
Echtzeit-Updates, eine Offline-App, einen Dateispeicher, einen Admin-Bereich auf eigenem Host und
neun Sprachen ([README](https://github.com/spy4x/seed#readme)).

Es nutzt sogar weiterhin CQRS: Commands, Queries und Events laufen über je einen eigenen
Bus, und jede Gruppenänderung schreibt ihr Event in eine Outbox, die ein Worker abarbeitet. Das
Muster war nie der Täter. Vier Anmelde-Bibliotheken zu schreiben, bevor es eine einzige Gruppe gab, war es.

## Was macht Seed heute anders?

- **Eine Form für jedes Feature.** Ein neues Feature kopiert das Notizen-Feature Datei für Datei,
  in fester Reihenfolge: [alle Dateien des Notizen-Aggregats](/de/docs/aggregates). Die Anleitung
  sagt es klar: „Do not invent a second shape“, erfinden Sie keine zweite Form.
- **Ein Server statt neun Dienste.** Docker Compose betreibt die App, Postgres, den Proxy und das
  Monitoring auf einem Server, den Sie selbst kontrollieren:
  [von git clone in die Produktion auf einem Hetzner-Server](/blog/deploy-saas-to-one-hetzner-server)
  (auf Englisch).
- **Prinzipien, die Nein sagen.** Zu
  [Seeds Prinzipien](https://github.com/spy4x/seed/blob/main/docs/principles.md) gehören „Ship
  small, safe slices“, „Avoid speculative complexity“ und „Add deps only with clear ROI“: in
  kleinen, sicheren Schritten liefern, keine Komplexität auf Vorrat, eine Abhängigkeit nur, wenn
  sie sich klar lohnt.
- **Webstandards statt Frameworks.** Die Server sprechen Fetch, Web Crypto und WebSocket statt der
  privaten API einer Plattform:
  [warum Seed auf Webstandards gebaut ist](/blog/why-seed-free-saas-starter-web-standards) (auf
  Englisch).

Auch die Commit-Typen haben sich verschoben. Von Seeds 531 Commits seit dem Neustart sind 194
`feat` und 46 `chore`, `ci` oder `build`. Die meisten sind per Squash gemergte Pull Requests, also
nicht so groß wie die Commits von v1, aber die Richtung ist klar.

## Macht Ihr Boilerplate dasselbe?

Drei schnelle Prüfungen, abgeleitet aus den Zahlen von v1:

1. Zählen Sie Ihre Ordner und Ihre Tabellen. Mehr Bibliotheken als Tabellen ist ein Warnsignal.
2. Lesen Sie die geplante Hälfte Ihrer Roadmap. Steht dort alles, was ein Nutzer anfassen würde,
   bauen Sie die Werkstatt.
3. Suchen Sie den Commit, ab dem ein Mensch zum ersten Mal etwas tun konnte. Ist es Nummer 38:
   Hallo, das bin ich.

Oder lassen Sie das Gerüst weg: [Seed](https://github.com/spy4x/seed) ist kostenlos und
MIT-lizenziert, das Fundament steht schon. Klonen Sie es und
[liefern Sie Ihr erstes Feature](/blog/your-first-feature-copy-the-notes-aggregate) noch diese Woche
(auf Englisch).
