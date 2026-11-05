---
slug: backup-und-wiederherstellung-saas-selbst-hosten
language: de
translationOf: self-hosted-saas-backup-and-restore
title: "Backups für ein selbst gehostetes SaaS, und wie Sie beweisen, dass die Wiederherstellung klappt"
seoTitle: "Backup und Restore für selbst gehostetes SaaS: Postgres und Dateien"
description: Wie Sie ein selbst gehostetes SaaS (Datenbank, Dateien, Schlüssel) außerhalb des Servers sichern und die Wiederherstellung vorher testen.
tldr:
  - Sichern Sie Datenbank, hochgeladene Dateien und jeden Schlüssel, den es nur auf dem Server gibt, in einen Bucket bei einem anderen Anbieter.
  - Erst eine Wiederherstellung beweist ein Backup. Spielen Sie eine in eine Ersatzdatenbank ein; in Seed sind das vier Befehle.
  - Seed sichert täglich einen pg_dump, die Dateien und die Web-Push-Schlüssel mit restic und warnt, wenn das letzte Backup zwei Tage alt ist.
  - Eine Wiederherstellung auf einen Zeitpunkt gibt es nicht, bis zu einem Tag an Schreibvorgängen kann verloren gehen, und die gespeicherten Daten prüft es nicht selbst.
topic: Anleitungen
intro: "Ein SaaS auf dem eigenen Server ist günstig, bis die Platte stirbt. Hier steht, was Sie sichern, wo Sie es ablegen und wie Sie beweisen, dass die Wiederherstellung klappt, am Beispiel des Backups, das Seed mitbringt."
relatedFeature: deploy
coverAlt: "Eine violette Pflanze wächst aus einem Server-Turm auf einer kleinen Insel, und auf einer zweiten Insel jenseits des Wassers steht ein verschlossenes Glas mit einem Steckling derselben Pflanze neben einem Topf, in den er umgepflanzt wird."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-08T09:00:00Z
newsletter: true
devto: false
---

Um ein selbst gehostetes SaaS zu sichern, speichern Sie jeden Tag drei Dinge in einem Speicher bei
einem anderen Anbieter: einen Dump der Datenbank, die Dateien, die Ihre Nutzer hochgeladen haben,
und jeden Schlüssel, den es nur auf dem Server gibt. Verschlüsseln Sie das Backup, bewahren Sie
sein Passwort nicht auf dem Server auf und lassen Sie sich melden, wenn ein Lauf scheitert. Dann
kommt der Teil, den die meisten auslassen: Spielen Sie ein Backup in eine Ersatzdatenbank ein und
prüfen Sie, ob die Tabellen da sind. Bis dahin haben Sie einen Ordner voller Hoffnung.

Ein Server zum Festpreis ist die ganze Idee von Seed, und was Leute vom Selbsthosten abhält, ist
die Angst vor Datenverlust. Deshalb geht es hier um das Backup, das Seed mitbringt: was es sichert,
wie Sie die Wiederherstellung proben und, genauso offen, was es nicht kann. Die Befehle stammen aus
der [Backup-Anleitung](/de/docs/backups) und der
[Anleitung zur Wiederherstellung](/de/docs/restore).

## Was muss ein selbst gehostetes SaaS sichern?

Alles, was Sie nicht aus git neu bauen können. Hier ist die Liste von Seed aus
[docs/backups.md](/de/docs/backups):

| Was                                   | Im Backup? | Warum                                                                     |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| Die Postgres-Datenbank, als `pg_dump` | Ja         | Konten, Gruppen und alles, was Nutzer angelegt haben.                     |
| Hochgeladene Dateien (Garage)         | Ja         | Seine Datenblöcke und die zwei neuesten stündlichen Kopien der Metadaten. |
| Die Web-Push-Schlüssel, `vapid.json`  | Ja         | Es gibt sie nur auf dem Server; ohne sie kommen keine Pushes mehr an.     |
| Valkey                                | Nein       | Ein Cache, er füllt sich von selbst wieder.                               |
| Die Env-Datei der Produktion          | Nein       | Sie enthält die Schlüssel des Backups. Bewahren Sie eine Kopie woanders.  |
| Dateien in einem anderen S3-Speicher  | Nein       | Die decken die Backups dieses Speichers ab.                               |

Die Env-Datei wird am häufigsten vergessen. Sie enthält den Schlüssel des Dateispeichers und das
Passwort des Backups; ein Backup mit dieser Datei gäbe beides jedem, der das Backup liest. Legen Sie
sie in Ihren Passwortmanager oder verschlüsselt in git, aber nicht nur auf den Server.

## Wo sollen die Backups liegen?

Nicht auf demselben Server und besser nicht beim selben Anbieter. Ein Backup auf der toten Platte
ist kein Backup, und ein Backup im selben Konto verschwindet mit einem gesperrten Konto. Das Backup
von Seed schreibt in jeden S3-kompatiblen Bucket. Der
[Beitrag zum Deployment](/blog/deploy-saas-to-one-hetzner-server) rechnet dafür mit Hetzner Object
Storage, das außerhalb des Servers liegt; ein Bucket bei einem zweiten Anbieter übersteht auch
Ärger mit dem ersten.

Drei Einstellungen zählen mehr als der Anbieter:

1. **Ein Schlüssel nur für diesen Bucket**, der dort lesen, schreiben und löschen darf und sonst
   nirgends.
2. **Versionierung oder Object Lock am Bucket**, wenn der Anbieter das hat. Der Schlüssel liegt auf
   dem Server; wer den Server übernimmt, könnte sonst auch die Backups löschen. Diese Einstellung
   macht aus „mein Server wurde gelöscht" einen schlechten Nachmittag statt einer geschlossenen
   Firma.
3. **Das Passwort des Repositorys nicht auf dem Server.** Ohne es lässt sich kein Snapshot lesen,
   weder von einem Angreifer noch von Ihnen.

## Wie erstellt Seed das Backup?

Steht `backup` in `COMPOSE_PROFILES`, läuft ein Container `backup` einmal beim Start und danach
alle 24 Stunden
([infra/backup/backup.sh](https://github.com/spy4x/seed/blob/main/infra/backup/backup.sh)). Er
speichert in ein [restic](https://restic.net)-Repository, das jeden Snapshot verschlüsselt und nur
überträgt, was sich seit dem letzten geändert hat.

Ein paar Entscheidungen in diesem Skript machen den Unterschied zwischen einem Backup und einer
Datei, die nur so aussieht:

- **restic startet `pg_dump` selbst** und speichert nichts, wenn `pg_dump` scheitert; ein
  abgebrochener Dump wird nie zum Snapshot. `pg_dump` exportiert konsistent, während die App
  weiter liest und schreibt, und blockiert keine anderen Nutzer
  ([Postgres-Dokumentation](https://www.postgresql.org/docs/current/app-pgdump.html)); die App
  bleibt also online.
- **Der Dump kommt aus der Postgres-Version des Servers.** Das Backup-Image baut auf dem Image der
  Datenbank auf
  ([infra/backup/Dockerfile](https://github.com/spy4x/seed/blob/main/infra/backup/Dockerfile)),
  daher hinken `pg_dump` und `pg_restore` dem Server nie hinterher.
- **Der Dump ist unkomprimiert.** restic komprimiert selbst und erkennt Unverändertes nur in
  unkomprimierten Daten, so bleibt der tägliche Dump einer kaum veränderten Datenbank klein.
- **Alte Snapshots werden ausgedünnt.** Alle Snapshots der letzten zwei Tage bleiben, dann einer
  pro Tag für eine Woche, einer pro Woche für einen Monat und einer pro Monat für ein halbes Jahr
  ([restic `forget`](https://restic.readthedocs.io/en/stable/060_forget.html)).
- **Ein abgebrochener Lauf räumt auf.** Ein Neustart oder der OOM-Killer kann eine Sperre von
  restic zurücklassen; jeder Lauf entfernt zuerst veraltete Sperren, und ein Lauf, der auf eine
  aktive trifft, versucht es nach einer Stunde erneut.

Einschalten heißt: das Profil `backup` und vier Variablen in der Env-Datei, dann ein Deployment. Bis Sie es einrichten, ist
das Profil aus; ein neues Produkt hat also kein Backup, bevor Sie es tun.

## Woran sehen Sie, dass das Backup noch läuft?

Ein Backup, das im März stehen geblieben ist, fällt im Juni auf, an dem Tag, an dem Sie es
brauchen. Seed meldet es dreifach:

- `docker ps` zeigt den Backup-Container als unhealthy, wenn das letzte vollständige Backup älter
  als zwei Tage ist.
- Der Alarm `BackupMissing`
  ([infra/configs/alerts.yml](https://github.com/spy4x/seed/blob/main/infra/configs/alerts.yml))
  schickt dieselbe Nachricht an ntfy.
- Die Seite System im Admin-Bereich warnt, wenn das letzte Backup 26 Stunden alt ist, und zeigt ab
  48 einen Fehler
  ([libs/domain/identity/admin-system.ts](https://github.com/spy4x/seed/blob/main/libs/domain/identity/admin-system.ts)).

Das Log nennt die Ursache: ein falsches Passwort oder ein falscher Schlüssel, eine Sperre oder ein
Repository, das nicht antwortet.

## Wie beweisen Sie, dass die Wiederherstellung klappt?

Indem Sie eine machen. Nicht den ganzen Server: einen Snapshot in eine Ersatzdatenbank neben der
echten, während die App weiterläuft. In Seed auf dem Server, im Ordner der App (`<db>` ist Ihr
`DB_NAME`):

```sh
deno task compose exec db psql -d postgres -c 'CREATE DATABASE "<db>_restore_test"'
deno task compose run --rm backup restore
deno task compose run --rm -e PGDATABASE=<db>_restore_test backup restore <snapshot id>
deno task compose exec db psql -d <db>_restore_test -c '\dt'
```

Die zweite Zeile listet die Snapshots und ändert nichts, die dritte spielt den genannten ein. Die
Tabellenliste muss mit der echten Datenbank übereinstimmen. Danach löschen Sie die Ersatzdatenbank.
Das dauert ein paar Minuten, und danach ist „wir haben Backups" eine Tatsache statt eines Gefühls.

Machen Sie das einmal, nachdem Sie das Backup eingeschaltet haben, und wieder nach jeder großen
Änderung: eine neue Postgres-Version, ein neuer Bucket, ein neues Passwort.

Das Skript selbst testet Seed auch. `deno task test:backup` und der CI-Schritt `backup-restore`
sichern bei jedem Pull Request eine Datenbank mit dem echten Skript, spielen sie in eine leere ein
und vergleichen die Zeilen
([infra/backup/restore.test.sh](https://github.com/spy4x/seed/blob/main/infra/backup/restore.test.sh)).
Derselbe Test bricht einen Lauf mittendrin ab und prüft, dass der nächste gelingt, und hält zwei
Projekte in einem Repository auseinander. Das beweist das Skript; Ihren Bucket, Ihren Schlüssel und
Ihr Passwort beweist nur Ihre eigene Probe.

## Wie stellen Sie im Ernstfall wieder her?

Langsam und ohne etwas zu überschreiben. Alle Befehle stehen in der
[Anleitung zur Wiederherstellung](/de/docs/restore); das sind die Gedanken dahinter:

1. **Legen Sie die beschädigte Datenbank beiseite, schreiben Sie nie darüber.** App anhalten,
   Datenbank umbenennen, eine leere anlegen. Die Wiederherstellung verweigert eine Datenbank mit
   Tabellen, damit sich zwei Stände nie mischen.
2. **Wählen Sie den Snapshot nach Datum.** Der neueste ist nicht immer der richtige: Ein Snapshot
   nach dem Schaden enthält den Schaden. Deshalb hat `restore` keinen Standardwert und nennt
   Snapshot und Zeitpunkt, bevor es etwas einspielt.
3. **Spielen Sie in einer Transaktion ein.** Eine Wiederherstellung, die mittendrin scheitert,
   hinterlässt eine leere Datenbank, keine halb gefüllte (`pg_restore --single-transaction`,
   [Postgres-Dokumentation](https://www.postgresql.org/docs/current/app-pgrestore.html)).
4. **Erst den Cache neu starten, dann die App.** Migrationen, die neuer als der Snapshot sind,
   laufen wie bei jedem Start.
5. **Holen Sie die Dateien aus derselben Nacht** wie die Datenbank.

Auf einem neuen Server lassen Sie das Backup aus, bis die Wiederherstellung fertig ist. Sonst
sichert der neue Server jeden Tag seine leere Datenbank in dasselbe Repository, und nach sieben
Läufen fängt die Bereinigung an, die Snapshots des alten Servers zu löschen. Lieber lesen Sie das
hier, als es selbst herauszufinden.

## Was kann das Backup von Seed nicht?

- **Keine Wiederherstellung auf einen Zeitpunkt.** Es ist ein Dump pro Tag, ein Ausfall kann also
  bis zu einem Tag an Schreibvorgängen kosten. Seed archiviert kein WAL; ist eine Stunde verlorener
  Bestellungen für Ihr Produkt zu viel, brauchen Sie das zusätzlich.
- **Es liest die gespeicherten Daten nicht selbst zurück.** `restic check` prüft die Struktur des
  Repositorys, `--read-data` liest jedes gespeicherte Pack
  ([restic-Dokumentation](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)),
  aber das Skript startet keins von beiden. Von Hand geht es so:
  `deno task compose run --rm backup restic check --read-data-subset=10%`.
- **Es probt die Wiederherstellung nicht für Sie.** Die CI testet das Skript, nicht Ihren Bucket.
- **Es sichert die Env-Datei nicht**, mit Absicht, und es schreibt nicht über SSH: Das Repository
  muss ein S3-Bucket sein.
- **Es ist aus, bis Sie es einschalten.**

Das ist ehrliche Alltagssicherheit für einen Server, nicht das Niveau einer Bank. Für die meisten
Produkte ist das die richtige Menge: Die gefährliche Lücke ist selten die verlorene Stunde, sondern
das Backup, das nie jemand wiederhergestellt hat.

## Jetzt Sie

Wenn Seed bei Ihnen schon läuft, proben Sie heute eine Wiederherstellung: vier Befehle, ein paar
Minuten. Wenn Sie noch entscheiden, wo Sie hosten, beginnen Sie mit
[Seed installieren und lokal starten](/blog/install-seed-and-run-it-locally), dann
[auf einen Hetzner-Server bringen](/blog/deploy-saas-to-one-hetzner-server) und das Backup gleich
mit einschalten. Ist etwas in den Anleitungen unklar?
[Öffnen Sie ein Issue](https://github.com/spy4x/seed/issues), und ich verbessere es.
