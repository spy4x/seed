---
slug: mandantenfaehiges-saas-gruppen-rollen-postgres
language: de
translationOf: multi-tenant-saas-groups-roles-postgres
title: "Mandantenfähiges SaaS: Gruppen, Rollen und Rechteprüfung in Postgres"
seoTitle: "Mandantenfähiges SaaS mit Postgres: Gruppen, Rollen, Rechte"
description: "Wie Seed Mandanten in einer einzigen Postgres-Datenbank trennt: eine Gruppen-Id in jeder Zeile, vier feste Rollen, die Rolle in jedem Handler geprüft und bei jedem Schreiben unter einer Sperre neu gelesen."
tldr:
  - "In Seed ist der Mandant eine Gruppe. Jede Zeile trägt eine group_id, und der Zugang einer Person ist eine Zeile in group_members mit einer Rolle von 1 bis 4."
  - "Wer was darf, ist eine Reihe kleiner reiner Funktionen. Jeder Handler liest die Rolle und ruft eine davon auf; WebSocket und HTTP teilen dieselben Handler."
  - "Jeder Schreibvorgang liest die Rolle in seiner eigenen Transaktion unter einer Sperre neu, sodass ein gerade entferntes Mitglied keinen letzten Schreibvorgang mehr durchbringt."
  - "Es gibt keine Row-Level Security. Fremde bekommen 404, nie 403, und Tests prüfen, dass eine Gruppe nie die Daten einer anderen sieht."
topic: Im Detail
intro: "Jedes SaaS mit Teams beantwortet bei jeder Anfrage dieselbe Frage: Darf diese Person diese Zeile anfassen? So beantwortet Seed sie in einer einzigen Postgres-Datenbank, mit dem echten Code, und mit der einen Stelle, an der es Sicherheit gegen Einfachheit tauscht."
coverAlt: "Ein Gewächshaus, unterteilt in gläserne Räume, jeder mit eigenen Pflanzen und eigener violetter Tür, neben jeder Tür hängt ein Schlüssel."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

Wie baut man ein mandantenfähiges SaaS (Multi-Tenant) auf Postgres, sodass ein Team nie die Daten
eines anderen sieht? In Seed ist der Mandant eine **Gruppe**. Jede Zeile, die einem Mandanten
gehört, trägt eine `group_id`, der Zugang einer Person ist eine Zeile in `group_members` mit einer
Rolle, und jede Anfrage prüft diese Rolle im Code, bevor sie liest oder schreibt. Schreibvorgänge
prüfen zweimal: im Handler und noch einmal in ihrer eigenen Transaktion, unter einer Sperre. Eine
gemeinsame Datenbank, ein Schema, keine Row-Level Security.

Dieser Artikel ist für alle, die ein Produkt für Teams bauen und eine vollständige, funktionierende
Antwort sehen wollen statt eines Diagramms. Alles steht im
[Code von Seed](https://github.com/spy4x/seed) unter MIT-Lizenz, und die Auszüge sind die echten
Zeilen, leicht gekürzt.

## Was ist ein Mandant in Seed?

Eine Gruppe. Eine eigene „persönliche“ Art gibt es nicht: Die Registrierung legt eine gewöhnliche
Gruppe namens „Personal“ an, mit Ihnen als einzigem Mitglied. Ein Einzelnutzer und ein Team von 50
laufen also durch denselben Code, und nichts muss migriert werden, wenn jemand eine Kollegin
einlädt. Eine Person kann in beliebig vielen Gruppen sein.

Die Mitgliedschaft ist eine Tabelle
([die Migration](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)):

```sql
CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INT2 NOT NULL,
    ...
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role_check CHECK (role BETWEEN 1 AND 4)
);
```

Zwei Regeln hält Postgres selbst: Eine Rolle liegt zwischen 1 und 4, und ein partieller eindeutiger
Index erlaubt genau einen Eigentümer pro Gruppe. Eine Eigentumsübertragung stuft den alten
Eigentümer herab, bevor sie den neuen befördert, in einer Transaktion, denn dieser Index lässt nicht
einmal kurz zwei Eigentümer zu. Jede Zeile einer Funktion (eine Notiz, ein Tag, eine Datei) hat ihre
eigene Spalte `group_id`.

## Welche Rollen gibt es, und was darf jede?

Vier, fest und geordnet: viewer (1), editor (2), admin (3), owner (4). Dank der Reihenfolge ist fast
jede Regel ein Vergleich: „editor oder höher“ heißt `role >= 2`.

| Was                                           | Viewer | Editor | Admin | Owner |
| --------------------------------------------- | ------ | ------ | ----- | ----- |
| Die Notizen der Gruppe lesen                  | ja     | ja     | ja    | ja    |
| Notizen anlegen, ändern und löschen           | nein   | ja     | ja    | ja    |
| Als viewer oder editor einladen               | nein   | nein   | ja    | ja    |
| Gruppe umbenennen, E-Mail-Adressen sehen      | nein   | nein   | ja    | ja    |
| Jemanden zum admin machen                     | nein   | nein   | nein  | ja    |
| Bezahlen, Gruppe löschen, Eigentum übertragen | nein   | nein   | nein  | ja    |

Ein admin verwaltet viewer und editor, nie einen anderen admin, und den Eigentümer fasst nur der
Eigentümer selbst an. Im Free-Plan fügt eine Einladung nur viewer hinzu: andere Rollen zu vergeben
ist das, was der bezahlte Plan verkauft. Wie Plan und Rolle getrennt bleiben, kommt weiter unten.

## Wo sitzt die Rechteprüfung?

In kleinen reinen Funktionen der Domänenbibliothek, eine pro Frage
([`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)). Die
schwierigste, wer wessen Rolle ändern darf, ist die längste:

```ts
export function canManageMember(actor: GroupRole, target: GroupRole, next?: GroupRole): boolean {
  if (!isGroupRole(actor) || !isGroupRole(target) || (next !== undefined && !isGroupRole(next))) {
    return false
  }
  if (actor === GroupRole.OWNER) return true
  if (actor !== GroupRole.ADMIN || target > GroupRole.EDITOR) return false
  return next === undefined || next <= GroupRole.EDITOR
}
```

Keine Datenbank, keine Anfrage, kein Framework: Ein Unit-Test ruft sie mit jeder Kombination von
Rollen auf. Ein Handler liest die Rolle des Handelnden und gibt sie an die passende Prüfung, bevor er
das Repository aufruft:

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

Die Transportschicht kennt keine Regeln. Ein Aufruf kommt über den WebSocket oder als
`POST /api/call/<name>`, beide landen im selben Handler und bekommen dieselbe Antwort. Deshalb kann
[Echtzeit auf HTTP zurückfallen](/blog/realtime-websocket-with-http-fallback), ohne einen zweiten
Satz Prüfungen, den man synchron halten müsste.

## Warum die Rolle zweimal prüfen?

Weil eine vor dem Schreiben gelesene Rolle beim Commit schon veraltet sein kann. Stellen Sie sich vor:
Der Eigentümer entfernt eine Editorin im selben Moment, in dem sie eine Notiz speichert. Der Handler
hat vor einer Millisekunde „editor“ gelesen, das Entfernen wird committet, und die Notiz landet in
einer Gruppe, zu der ihre Autorin nicht mehr gehört.

Deshalb ruft jeder Schreibvorgang in einer Gruppe zuerst `lockActorRole` auf, in seiner eigenen
Transaktion ([`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)):

```ts
const active = await sql`
  SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
`
if (active.length === 0) throw new GroupNotActiveError(groupId)
const member = (await sql`
  SELECT group_members.role
  FROM group_members
  INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
  WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${actorId}
  FOR SHARE OF group_members
`)[0]
return member?.role ?? null
```

Die Zeile der Gruppe wird zuerst gesperrt, in derselben Reihenfolge wie bei jeder
Mitgliederänderung, sodass beide aufeinander warten, statt sich gegenseitig zu blockieren. Die
Mitgliedszeile wird `FOR SHARE` gelesen: Ein vorher committetes Entfernen ist sichtbar, ein späteres
wartet, bis der Schreibvorgang fertig ist. Danach prüft das Repository die erhaltene Rolle, die
zweite Prüfung kostet also einen Indexzugriff in einer Transaktion, die ohnehin offen war.

Ein Test belegt das für jede Art von Notiz-Schreibvorgang: Er hält ein Entfernen oder Herabstufen
offen, startet den Schreibvorgang, sieht ihn warten, committet die Änderung und erwartet, dass der
Schreibvorgang abgelehnt wird und nichts gespeichert ist („note update: refused when a removal
commits while the write waits“, in `tests/integration/group-write-race.integration.test.ts`).

## Warum bekommen Fremde 404 statt 403?

Weil 403 sagt: „Diese Gruppe gibt es, nur nicht für Sie.“ Wer kein Mitglied ist, bekommt
`GROUP_NOT_FOUND`, genau wie bei einer Gruppe, die es nie gab, sodass niemand Gruppen-Ids
durchprobieren kann, um echte zu finden. Ein Mitglied ohne die nötige Rolle bekommt 403
`ROLE_INSUFFICIENT`, denn es weiß ja, dass die Gruppe existiert.

Beim Plan gilt dasselbe Prinzip. Erreicht eine Gruppe das Limit ihres Plans, lautet die Antwort
**402 Payment Required**, nicht 403, damit die App „Bitten Sie den Eigentümer um ein Upgrade“ von
„Ihnen fehlt die Rolle“ unterscheiden kann. Die Rolle entscheidet, wer handeln darf; der Plan, wie
viel die Gruppe bekommt. Die Abrechnung pro Platz und ihre Webhooks haben
[einen eigenen Artikel](/de/blog/abrechnung-pro-nutzer-stripe-webhooks).

## Warum nicht Row-Level Security von Postgres?

Ich habe sie erwogen und den Kompromiss im
[Entwurf der Gruppen-Synchronisation](https://github.com/spy4x/seed/blob/main/docs/archive/group-sync.md#9-tradeoffs)
festgehalten. Row-Level Security würde eine zweite Kopie der Rechteregeln in die Datenbank legen, als
SQL-Policies, neben die Kopie, die die Handler ohnehin brauchen, um „Sie sind viewer“ mit einer
brauchbaren Fehlermeldung zu beantworten. Zwei Kopien einer Regel driften auseinander. Außerdem
müsste jede Verbindung die aktuelle Person mitführen, was Connection-Pooling, Hintergrundjobs und
Migrationen verkompliziert.

Der ehrliche Preis: Mit Filtern im Anwendungscode kann eine Abfrage, die `group_id` vergisst, Daten
preisgeben. Seed antwortet darauf dreifach:

- **Signaturen mit Gruppe.** Eine Repository-Methode nimmt die Gruppen-Id als Argument, etwa
  `get(groupId, id)`, und ihre Abfrage filtert nach beidem. Ein „Notiz nach Id holen“, das man falsch
  benutzen könnte, gibt es nicht.
- **Eine Checkliste für jede Funktion.** [docs/aggregates.md](/de/docs/aggregates) nennt die Regeln,
  die eine neue Funktion übernimmt: Sie lebt in einer Gruppe, jede Zeile hat eine `group_id`, jeder
  Schreibvorgang liest die Rolle neu.
- **Gruppenübergreifende Tests.** Integrationstests laufen gegen ein echtes Postgres mit einer
  fremden Person in ihrer eigenen Gruppe, in Schritten wie „never counts a note of another group“
  und „a person who is not a member is told the group does not exist“.

Braucht Ihr Produkt eine Garantie auf Datenbankebene, etwa für ein Compliance-Audit, ist
Row-Level Security eine gute Wahl, und Sie können sie darüberlegen. Für eine Vorlage habe ich mich
für einen einzigen Ort für die Regeln entschieden.

## Was macht Seed nicht?

- **Keine eigenen Rollen.** Vier feste Rollen. Ein Produkt, das einen „Abrechnungsverwalter“
  braucht, fügt eine Rolle und ihre Prüfungen hinzu.
- **Keine Rechte pro Datensatz.** Eine Rolle gilt für die ganze Gruppe; eine einzelne Notiz lässt
  sich nicht mit einer einzelnen Person teilen.
- **Keine Row-Level Security**, wie oben beschrieben.
- **Kein eigenes Schema und keine eigene Datenbank pro Mandant.** Alle Gruppen teilen die Tabellen.

## Ausprobieren

Öffnen Sie die [Demo](https://app.seedsaas.com), legen Sie eine Gruppe an, laden Sie ein zweites
Konto als viewer ein und versuchen Sie, damit eine Notiz zu bearbeiten. Die Kurzfassung steht auf
der [Seite zu Gruppen](/de/features/groups), und [Ihre erste Funktion](/blog/your-first-feature-copy-the-notes-aggregate)
zeigt, wie eine neue Art von Datensatz all das erbt, indem sie den Code der Notizen kopiert. Wenn
Ihre App die Rolle nur einmal prüft, vor der Transaktion, ist das der Wettlauf, den ich als Erstes
schließen würde.
