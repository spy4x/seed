---
slug: abrechnung-pro-nutzer-stripe-webhooks
language: de
translationOf: per-seat-billing-stripe-webhooks-retries
title: "Abrechnung pro Nutzer mit Stripe und Webhooks, die Wiederholungen überstehen"
seoTitle: "Stripe-Abrechnung pro Nutzer: Webhooks sicher gegen Wiederholungen"
description: "Wie Seed ein Team pro Mitglied über Stripe abrechnet: Die Zahl der Plätze folgt der Mitgliederliste über einen wiederholten Job, und jeder Webhook wird genau einmal angewendet, nie rückwärts."
tldr:
  - "In Seed ist die Menge des Stripe-Abos die Zahl der Gruppenmitglieder, der Eigentümer eingeschlossen. Stripe rechnet anteilig ab, die App rechnet kein Geld."
  - "Erst tritt das Mitglied bei, dann folgt die Rechnung: Ein Worker-Job meldet Stripe die neue Zahl und wiederholt mit demselben Idempotenzschlüssel, solange Stripe nicht erreichbar ist."
  - "Die Id jedes Ereignisses wird in derselben Transaktion gespeichert, die es anwendet: Eine Wiederholung ändert nichts, und ein Fehler rollt beides zurück, damit Stripe es erneut schickt."
  - "Ein älteres Ereignis setzt nie einen Plan zurück, und ein nächtlicher Job korrigiert jede abgewichene Platzzahl."
topic: Im Detail
intro: "Abrechnung pro Nutzer wirkt wie eine einzige Zahl: Mitglieder mal Preis. Schwierig ist, dass diese Zahl stimmt, während Leute beitreten, Stripe ausfällt und Webhooks doppelt oder in falscher Reihenfolge kommen. So macht es Seed, mit dem echten Code."
coverAlt: "Eine Reihe violetter Theatersessel, auf jedem eine Topfpflanze, während ein neuer Setzling an einer Schnur in einen weiteren Sessel gesenkt wird."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: true
---

Wie rechnet man ein SaaS pro Nutzer mit Stripe ab, ohne dass die Rechnung vom Team abweicht? In
Seed ist die Menge des Abos einfach die Zahl der Gruppenmitglieder, und die App verlässt sich
weder auf einen einzelnen Aufruf noch auf einen einzelnen Webhook, um sie dort zu halten. Eine
Mitgliederänderung wird zuerst gespeichert; ein wiederholter Job meldet Stripe dann die neue Zahl;
jeder Webhook wird mit seiner Ereignis-Id in derselben Transaktion gespeichert, die ihn anwendet;
und ein nächtlicher Job behebt, was durchgerutscht ist.

Dieser Artikel ist für alle, die Teamabrechnung in ein SaaS einbauen, und für alle, deren
Webhook-Handler gut lief, bis Stripe ein Ereignis wiederholt hat. Alles steht im
[Code von Seed](https://github.com/spy4x/seed) unter MIT-Lizenz, und ich zitiere die echten Zeilen.

## Was bedeutet Abrechnung pro Nutzer in Seed?

Die Abrechnung gehört einer Gruppe, dem Team in Seed. Jede Gruppe hat ein Abo, das ihr Eigentümer
bezahlt. Der Katalog hat zwei Pläne ([`PLANS`](https://github.com/spy4x/seed/blob/main/libs/domain/billing/+lib.ts)):

| Plan | Preis                         | Mitglieder | Testphase |
| ---- | ----------------------------- | ---------- | --------- |
| Free | 0                             | bis 3      | keine     |
| Pro  | 9,00 € pro Mitglied und Monat | bis 50     | 14 Tage   |

„Pro Mitglied“ heißt: Die Menge des Abos in Stripe ist die Zahl der Gruppenmitglieder, der
Eigentümer eingeschlossen. Es ist dieselbe Zahl, die auch die Obergrenze von 50 prüft, also gibt es
eine Definition eines Platzes, nicht zwei, die sich widersprechen. Eine offene Einladung belegt
keinen Platz; eine angenommene schon.

Was das ein Team kostet, zeigt der Rechner mit den Preisen der Demo. Schieben Sie den Regler:

<CostCalculator members={5} />

Fünf Personen auf Pro zahlen 45 € im Monat. Der Eigentümer sieht den Preis eines weiteren Platzes,
bevor er jemanden einlädt: Das Einladungsformular zeigt, was das neue Mitglied kostet, und bittet um
Zustimmung. Die API lehnt eine Einladung ohne diese Zustimmung ab (`SEAT_PRICE_NOT_ACCEPTED`), die
Regel gilt also auch, wenn das Formular ohne JavaScript abgeschickt wird.

## Warum tritt das Mitglied bei, bevor Stripe davon erfährt?

Weil ein langsames Stripe niemanden daran hindern darf, einem Team beizutreten. Der naheliegende
Code ruft Stripe in der Anfrage „Einladung annehmen“ auf. Läuft Stripe in einen Timeout, kann die
Person entweder nicht beitreten, oder sie tritt bei und die Rechnung bleibt für immer falsch. Beides
ist schlecht, und das Zweite fällt niemandem auf.

Seed speichert die Mitgliederänderung zuerst, in einer eigenen Transaktion. Ihr Commit schreibt eine
Zeile in die Outbox, und der Worker macht aus jeder Änderung (beigetreten, entfernt, ausgetreten)
einen Job, der die Plätze abgleicht. Der Job liest die Zahl erst, wenn er läuft, und fragt Stripe
nur, wenn sie von der gespeicherten abweicht ([`seat-sync.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/seat-sync.ts)):

```ts
const members = await new PostgresInvitationRepository(sql).countMembers(groupId)
if (members < 1 || row.quantity === members) return
const result = await provider.updateQuantity({
  subscriptionId: row.providerSubscriptionId,
  quantity: members,
  // A retry of this row asks for the same count with the same key; a later count gets its own.
  idempotencyKey: `seats:${event.id}:${members}`,
})
if (!result.ok) {
  throw new Error(`seat sync of group ${groupId} failed: ${result.error.code} ...`)
}
```

Drei Details tragen das Ganze:

1. **Die Zahl wird gelesen, wenn der Job läuft**, nicht beim Einreihen. Fünf Beitritte in einer
   Minute brauchen einen richtigen Aufruf, nicht fünf, die sich überholen.
2. **Der Idempotenzschlüssel nennt Job und Zahl.** Hat Stripe die Änderung angewendet und die
   Antwort ging verloren, sendet die Wiederholung denselben Schlüssel, und Stripe antwortet mit dem
   ersten Ergebnis, statt doppelt anzuwenden.
3. **Ein Fehler wirft eine Ausnahme.** Das Jobsystem wiederholt nach 1 s, 2 s, 4 s und so weiter,
   mit bis zu 15 Minuten Abstand, 20 Versuche lang, etwa zweieinhalb Stunden ([jobs.md](https://github.com/spy4x/seed/blob/main/docs/jobs.md)).

Die Mengenänderung verlangt von Stripe `proration_behavior=create_prorations`, den
[Standardwert](https://docs.stripe.com/billing/subscriptions/prorations): Der Rest des Zeitraums
wird auf der nächsten Rechnung nachberechnet oder gutgeschrieben. Die App rechnet keinen anteiligen
Euro selbst aus. Geldrechnungen, die ich nicht schreibe, kann ich nicht falsch schreiben.

## Und wenn der Abgleich nie ankommt?

Zwei weitere Wege fangen ihn auf, denn zweieinhalb Stunden Wiederholungen sind nicht „für immer“:

- **Auch der Webhook prüft.** Meldet Stripe ein Abo, dessen Menge nicht zur Mitgliederzahl passt,
  reiht dieselbe Transaktion, die das Ereignis speichert, einen Abgleich ein. So korrigiert sich ein
  Checkout, der geöffnet wurde, bevor jemand beitrat.
- **Ein nächtlicher Job prüft jede zahlende Gruppe.** Um 03:00 Uhr sucht die Bereinigung jedes Abo
  pro Mitglied, dessen gespeicherte Menge von der Gruppe abweicht, und reiht einen Abgleich ein. Das
  deckt einen langen Stripe-Ausfall ab und eine Zahl, die sich ohne Gruppenereignis geändert hat,
  etwa wenn ein Mitglied sein Konto löscht.

Die Platzzahl stimmt also nach der nächsten Änderung, dem nächsten Webhook oder der nächsten Nacht,
je nachdem, was zuerst kommt. Das ist mir lieber als ein Entwurf, der nur stimmt, wenn jeder Aufruf
klappt.

## Wie macht man einen Stripe-Webhook sicher gegen Wiederholungen?

Stripe [wiederholt eine fehlgeschlagene Zustellung](https://docs.stripe.com/webhooks#automatic-retries)
im Live-Modus bis zu drei Tage lang und weist darauf hin, dass ein Endpunkt dasselbe Ereignis mehr
als einmal erhalten kann. Ein Handler, der bei jeder Zustellung einen Platz hinzufügt oder eine Mail
schickt, tut das früher oder später doppelt.

Der Webhook von Seed macht drei Dinge in fester Reihenfolge. Zuerst die Signatur: Der Adapter
[`@spy4x/billing`](https://jsr.io/@spy4x/billing) prüft den Header `Stripe-Signature` gegen den
rohen Body, mit einem Fenster von fünf Minuten, bevor er ein Byte JSON parst. Eine falsche Signatur
bekommt `400`. Danach geschieht alles in einer Postgres-Transaktion, die mit dem Speichern der
Ereignis-Id beginnt ([`postgres-billing-repository.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/postgres-billing-repository.ts)):

```ts
return await this.sql.begin(async (transaction) => {
  const stored = await transaction`
    INSERT INTO billing_events (id, event_type) VALUES (${event.id}, ${event.type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  if (stored.length === 0) return "duplicate"
  // ... apply the subscription, queue mails and seat syncs, record the plan change
})
```

`billing_events.id` ist der Primärschlüssel, also fügt die zweite Zustellung nichts ein und kehrt
zurück, ohne das Abo anzufassen. Weil die Id _innerhalb_ der Transaktion gespeichert wird, ist auch
der umgekehrte Fall sicher: Schlägt danach etwas fehl, wird die Id mit allem anderen zurückgerollt,
die Route antwortet `500`, und Stripes Wiederholung bekommt einen sauberen zweiten Versuch. Die Id
zuerst zu speichern und später anzuwenden, in zwei Schritten, würde das Ereignis verlieren, sobald
ein Deployment die API zwischen beiden neu startet.

Die Mails an den Eigentümer (Zahlung fehlgeschlagen, Testphase endet, Plan endet) werden in derselben
Transaktion in die Outbox gestellt, ein wiederholtes Ereignis stellt also nie eine zweite Mail ein.
Ein Ereignis, das Seed nicht behandelt, bekommt `200`, damit Stripe es nicht mehr schickt.

## Was ist mit Ereignissen in falscher Reihenfolge?

Stripe [garantiert keine Reihenfolge](https://docs.stripe.com/webhooks#event-ordering). Ein spätes
`customer.subscription.updated` mit „trialing“ darf das vorherige `active` nicht rückgängig machen.
Seed schreibt das Abo mit einem Upsert, der sich nur vorwärts bewegt:

```sql
ON CONFLICT (group_id) DO UPDATE SET ...
WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
    <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
```

Zuerst zählt die Zeit des Ereignisses, bei Gleichstand seine Art: erstellt, dann geändert, dann
gelöscht. Ein älteres Ereignis trifft keine Zeile und ändert nichts. Eine zweite Regel im selben
`WHERE` verhindert, dass ein neues Abo, das nicht zahlt (etwa nach einer verspäteten fehlgeschlagenen
Abbuchung), eines ablöst, das zahlt.

Die Grenze nenne ich offen. Stripes Doku rät davon ab, Ereignisse nach `created` zu ordnen, weil es
in ganzen Sekunden angegeben ist. Seed nutzt es nur als Schutz gegen Rückschritte, nie zum Erkennen
von Duplikaten, dafür ist die Ereignis-Id da. Zwei Ereignisse derselben Art in derselben Sekunde,
die vertauscht ankommen, lassen weiterhin das ältere gespeichert, bis das nächste Ereignis oder eine
Änderung im Portal es korrigiert. Der Fall steht in
[der Abrechnungsdoku](/de/docs/billing-lifecycle#known-limits), und die Lösung wartet auf
[spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380). Ich sage es lieber selbst, als dass
Sie es finden.

## Beweisen die Tests das?

Sie laufen gegen ein echtes Postgres. Zu den 26 Schritten der Webhook-Suite
(`tests/integration/billing.integration.test.ts`) gehören „eine zweite Zustellung desselben
Ereignisses ändert nichts“ und „ein älteres Ereignis als das gespeicherte setzt den Plan nie
zurück“. Die Plätze haben eine eigene Suite (`tests/integration/seat-billing.integration.test.ts`)
mit Schritten wie „ein entferntes und ein austretendes Mitglied senken sie jeweils um eins“ und „der
nächtliche Job reiht für jede abgewichene Gruppe eine Platzänderung ein“.

## Was macht Seed nicht?

Damit Sie es wissen, bevor Sie darauf aufbauen:

- **Ein bezahlter Plan, monatlich, pro Mitglied.** Keine nutzungsbasierte oder gemessene Abrechnung,
  keine Stufen. Einen Plan hinzuzufügen sind fünf Schritte in [Plans and limits](/de/docs/billing-plans).
- **Nur Stripe.** Der Code spricht mit einer Anbieter-Schnittstelle, aber Stripe ist der einzige
  Adapter. Die Abrechnung lässt sich auch abschalten, dann bekommt jede Gruppe jede Funktion.
- **`invoice.paid` und `invoice.payment_failed` werden gespeichert, ändern aber noch nichts.** Der
  Plan folgt dem Status des Abos selbst.
- **Das Geld bleibt bei Stripe.** Die App hält fest, was die Webhooks melden, und entscheidet nie
  selbst über einen Plan.

## Ausprobieren

Öffnen Sie die [Demo](https://app.seedsaas.com), legen Sie eine Gruppe an und sehen Sie sich den Tab
Abrechnung an; laden Sie jemanden ein, und Sie sehen den Preis des Platzes vor dem Senden. Die
Kurzfassung steht auf der [Seite zur Abrechnung](/de/features/billing),
[Set up billing](/de/docs/billing) führt von keiner Abrechnung zu echtem Stripe, erst im Testmodus,
und Gruppen haben [ihre eigene Seite](/de/features/groups). Wenn Ihr Webhook-Handler die
Ereignis-Id in einem Schritt speichert und in einem anderen anwendet, würde ich genau diese Zeile
heute ändern.
