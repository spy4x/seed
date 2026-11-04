---
slug: seed-ist-da-rundgang
language: de
translationOf: welcome-to-the-seed-blog
title: "Seed ist da: ein Rundgang durch den kostenlosen SaaS-Starter, Bildschirm für Bildschirm"
seoTitle: "Seed ist da: der kostenlose SaaS-Starter im Rundgang"
description: Seed, ein kostenloser SaaS-Starter unter MIT-Lizenz, ist einsatzbereit. Was ab Tag eins funktioniert, was noch fehlt und wie du ihn in einer Minute testest.
tldr:
  - Seed ist ein kostenloser SaaS-Starter unter MIT-Lizenz, heute nutzbar. Du kopierst ein Repository, und jede Zeile gehört dir.
  - "Schon fertig: Passkeys und 2FA, Gruppen mit Rollen, Abrechnung pro Mitglied über Stripe, Echtzeit, Offline, ein Adminbereich und neun Sprachen."
  - "Noch nicht fertig: die Android- und die Desktop-App."
  - Die Demo öffnet sich mit einem Klick, lokal läuft Seed nach vier Befehlen.
topic: Seed
intro: "Seed, der kostenlose SaaS-Starter, den ich öffentlich baue, ist einsatzbereit. Hier siehst du Bildschirm für Bildschirm, was du ab Tag eins bekommst, was noch fehlt und wie du ihn in einer Minute ausprobierst."
coverAlt: "Ein violetter Keimling in einem Topf neben einem offenen Umschlag, aus dem Blätter wie Briefe herausfliegen."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-01T09:00:00Z
newsletter: false
---

Seed ist da. Es ist ein kostenloser SaaS-Starter unter MIT-Lizenz, den du heute nutzen kannst: Du
kopierst ein Repository und startest mit Anmeldung, Gruppen mit Rollen, Abrechnung pro Mitglied über
Stripe, Echtzeit-Updates, einer Offline-App, einem Adminbereich und neun Sprachen, die bereits
funktionieren. Er läuft mit Postgres und Docker Compose auf einem Server, den du selbst
kontrollierst, und du kannst dich in der [Live-Demo](https://app.seedsaas.com) durch die App
klicken, bevor du irgendetwas installierst.

Ich bin Anton und baue SaaS-MVPs für Kunden. Jedes davon begann früher mit demselben Monat
Klempnerarbeit: Anmeldung, Teams, Abrechnung und eine Adminseite, die ich „später mal schön mache“.
Seed ist dieser Monat, einmal erledigt und aktuell gehalten. Dies ist der Rundgang; einen ehrlichen
Vergleich mit anderen Startern findest du unter
[Kostenloses SaaS-Boilerplate](/de/blog/saas-boilerplate-kostenlos).

## Wie melden sich Leute an?

Auf jede Art, die sie erwarten: E-Mail und Passwort mit Bestätigungscode, Passkeys, Google und
GitHub sowie Anmeldecodes per E-Mail. Ein zweiter Faktor mit einer Authenticator-App ist ein
Schalter auf der Sicherheitsseite, und dieselbe Seite listet jedes angemeldete Gerät, sodass man
eine fremde Sitzung beenden kann. Besucher können auch mit einem Klick als Gast starten und später
eine Anmeldemethode hinzufügen, ohne etwas zu verlieren.

![Die Sicherheitsseite eines Profils: das Passwort, ein Button „Passkey hinzufügen“, der eingeschaltete Zwei-Faktor-Schutz und der Anfang der Liste der angemeldeten Geräte.](/shots/profile-security-dark-800.webp)

Niemand hat sich je für ein Produkt angemeldet, weil das Zurücksetzen des Passworts funktionierte.
Viele sind gegangen, weil es das nicht tat. Wie das ohne bezahlten Auth-Dienst gebaut ist:
[Passkeys, 2FA and sessions without an auth SaaS](/blog/passkeys-2fa-sessions-without-auth-saas)
(auf Englisch).

## Wie funktionieren Teams?

Über Gruppen. Die Registrierung legt Konto, Sitzung und eine erste Gruppe in einer einzigen
Datenbanktransaktion an, also sind ein persönlicher Bereich und ein Team dasselbe, mit denselben
Regeln. Eingeladen wird per E-Mail, mit einer von vier Rollen: Betrachter, Bearbeiter, Admin oder
Inhaber. Der Inhaber kann die Gruppe übergeben, und eine gelöschte Gruppe lässt sich 30 Tage lang
wiederherstellen.

![Die Mitglieder einer Gruppe, jedes mit seiner Rolle, ein Button zum Einladen und das geöffnete Menü eines Mitglieds mit den Optionen: „Zum Betrachter machen“, „Zum Admin machen“, „Aus der Gruppe entfernen“.](/shots/group-members-dark-800.webp)

## Wie sieht die Abrechnung aus?

Stripe-Abos pro Gruppe, abgerechnet pro Mitglied. Der Katalog der Demo hat einen kostenlosen Tarif
(bis zu 3 Mitglieder und 10 Notizen) und Pro für 9 € pro Mitglied und Monat, der Inhaber
eingeschlossen, mit 14 Tagen Testphase. Die Menge folgt der Mitgliederzahl, der Inhaber bestätigt
den neuen Preis vor jeder Einladung, und eine abgelehnte Karte bekommt eine Schonfrist statt einer
sofortigen Sperre. Die Preise sind Beispiele: deine Tarife sind eine Liste in einer Datei
([Tarife](/docs/billing-plans), auf Englisch).

![Der Tarif einer Beispielgruppe in der Demo-App, zu den Beispielpreisen der Demo: Tarif Pro mit Verlängerungsdatum, 36,00 € im Monat für 4 Mitglieder zu je 9,00 €, der Inhaber eingeschlossen.](/shots/billing-plan-dark-780.webp)

Ein Team aus vier Personen zahlt bei Pro 36 € im Monat. Schieb den Regler auf die Größe deines
Teams.

<CostCalculator members={4} />

## Was passiert, wenn zwei gleichzeitig bearbeiten oder das WLAN weg ist?

Änderungen erreichen jeden offenen Tab über einen WebSocket, und ohne Socket gehen die Aufrufe über
normales HTTP. Die App lässt sich installieren, öffnet ohne Netz, liest die letzten Notizen und
Gruppen aus IndexedDB und hält Änderungen an Notizen zurück, bis die Verbindung wieder da ist. Hat
jemand dieselbe Notiz inzwischen geändert, siehst du einen Konflikt zum Klären, nie ein stilles
Überschreiben der Arbeit eines Kollegen.

![Die Seite Notizen eines Teams namens Acme Studio: sechs Notizen mit Autor, farbigen Tags und Änderungszeit, ein Suchfeld, Filter nach Tag und Autor und ein Button Neue Notiz.](/shots/notes-dark-800.webp)

Notizen sind die Referenzfunktion: deine erste eigene Funktion kopiert sie Datei für Datei
([deine erste Funktion](/blog/your-first-feature-copy-the-notes-aggregate), auf Englisch). Die
Details auf Englisch: [Echtzeit über WebSocket mit HTTP als Rückfall](/blog/realtime-websocket-with-http-fallback)
und [wie sich die lokale Datenbank synchronisiert](/blog/offline-first-preact-signals-local-database-sync).

## Was sieht der Betreiber?

Einen Adminbereich auf eigener Domain. Ein Betreiber findet eine Person, sieht ihre
Anmeldemethoden, Sitzungen und Gruppen, erstattet eine Zahlung, schreibt diesen Blog, betreut die
Abonnenten des Newsletters und startet einen fehlgeschlagenen Job neu. Riskante Aktionen fragen
vorher nach, und jede Aktion landet im Audit-Log.

![Die Seite Personen im Adminbereich: Suche nach Name oder Adresse, Filter nach Status, Kontoart und Rolle und eine Tabelle erfundener Personen mit Rolle, Status und wann sie zuletzt aktiv waren.](/video/admin-panel-poster-1280.webp)

Jede Funktion der App bekommt ihren Admin-Bildschirm in derselben Änderung, damit beide nie
auseinanderlaufen ([wie der Adminbereich synchron bleibt](/blog/admin-panel-for-every-feature), auf Englisch).

## Welche Sprachen spricht er?

Neun: Deutsch, Englisch, Spanisch, Französisch, brasilianisches Portugiesisch, Russisch, Japanisch,
vereinfachtes Chinesisch und Arabisch, das von rechts nach links läuft. App, Adminbereich, diese
Website und die E-Mails wechseln mit, sodass du dein Layout auf Arabisch prüfen kannst, bevor dein
erster arabischer Kunde den Fehler für dich findet
([neun Sprachen und RTL ab Tag eins](/de/blog/neun-sprachen-und-rtl-ab-tag-eins)).

## Was fehlt noch?

Die Android-App ([#202](https://github.com/spy4x/seed/issues/202)) und die Desktop-App
([#203](https://github.com/spy4x/seed/issues/203)). Der Rest des Plans steht in den
[offenen Issues](https://github.com/spy4x/seed/issues). Die Anmeldung mit Google und GitHub und die
Stripe-Abrechnung brauchen deine eigenen Schlüssel und sind in der Demo deshalb aus; sie zeigt
erfundene Zahlungen statt echter. Der Adminbereich ist auch nicht Teil der Demo:
[ein Video zeigt ihn](/de/admin).

Seed passt auch nicht zu jedem Projekt. Wenn du auf Serverless-Funktionen deployst oder ein
gehostetes Backend willst, nimm etwas anderes: Seed rechnet mit einem Server, den du
betreibst.

## Wie probierst du es aus?

Zwei Wege, je eine Minute:

- **Die Live-Demo.** „Ohne Konto ausprobieren“ öffnet ein Gastkonto voller Beispieldaten: eine
  Gruppe, die dir gehört, und zwei Teams erfundener Leute. Sie wird jede Nacht gelöscht, also
  mach ruhig etwas kaputt.
- **Auf deinem Rechner.** Deno 2 und Docker, dann vier Befehle. Die Anleitung
  [Get started](/docs/get-started) geht sie Schritt für Schritt durch, und
  [der Installations-Post](/blog/install-seed-and-run-it-locally) zeigt die echte Ausgabe und die
  üblichen Stolpersteine (beide auf Englisch).

Fang mit der Demo an: [jetzt öffnen](https://app.seedsaas.com), auf „Ohne Konto ausprobieren“
klicken und in einem fremden Team herumstöbern.
