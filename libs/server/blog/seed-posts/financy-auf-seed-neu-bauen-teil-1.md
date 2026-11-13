---
slug: financy-auf-seed-neu-bauen-teil-1
language: de
translationOf: rebuilding-financy-on-seed-part-1
title: "Financy auf Seed neu bauen, Teil 1: ein echtes Produkt"
seoTitle: "Financy auf Seed neu bauen: ein Produkt auf einem SaaS-Starter"
description: "Ich baue Financy, meinen Open-Source-Finanztracker, auf Seed neu. Teil 1: warum ich von vorn anfange, wie die Kopie entstand und wie der erste Abgleich mit Seed lief."
tldr:
  - "Financy, mein Open-Source-Finanztracker, beginnt neu als Kopie von Seed. Die alte Version ist in einem Branch eingefroren, als Nachschlagewerk dafür, was sie konnte."
  - "Der erste Commit besteht aus den Dateien von Seed plus 19 eigenen: Lizenz, README, Regeln für Agenten, Produktdokumente und die zwei .seed-Dateien."
  - "Der erste Abgleich, einen Tag nach der Kopie und nach einem Rebranding, brachte 19 Seed-Commits und 616 geänderte Dateien ohne einen einzigen Konflikt."
  - "Noch gibt es keine Finanzfunktion. Was jedes Produkt bräuchte, entsteht zuerst in Seed, und Financy übernimmt es mit einem Abgleich."
topic: Öffentlich gebaut
intro: "Ich baue Financy, meinen Open-Source-Finanztracker für eine Person oder eine Familie, auf Seed neu und schreibe darüber, während es passiert. Teil 1: warum ich den alten Code weggeworfen habe, wie ein Produkt aus Seed entsteht und wie der erste Abgleich aussah."
coverAlt: "Eine junge violette Pflanze wird aus einem gesprungenen grauen Topf in einen neuen violetten Topf gesetzt und von einer großen violetten Pflanze daneben mit Wasser versorgt."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-09T09:00:00Z
newsletter: true
devto: false
---

Kann man ein echtes Produkt auf einem SaaS-Starter bauen und trotzdem weiter dessen Updates
bekommen? Genau das mache ich gerade mit [Financy](https://github.com/spy4x/financy), meinem
kostenlosen Open-Source-Finanztracker (AGPL-3.0) für eine Person oder eine Familie. Financy hat am
3. November 2026 als Kopie von Seed neu begonnen und am 4. November die ersten Änderungen von Seed
übernommen: 19 Commits, 616 Dateien, kein Konflikt. Diese Serie begleitet den Neubau, während er
passiert.

Sie richtet sich an Entwicklerinnen und Entwickler, die einen SaaS-Starter auswählen und ihn einmal
an etwas anderem als einer Demo sehen wollen, und an alle, die neugierig auf Financy sind. Alles hier
ist öffentlich: Jede Zahl stammt aus den beiden Repositories auf GitHub, und Sie können jede selbst
mit git nachzählen.

## Warum Financy neu bauen statt reparieren?

Das erste Financy entstand im April 2025 und kam auf 157 Commits. Es führte Konten in mehreren
Währungen, rechnete zwischen ihnen um und hatte End-to-End-Tests. Es hatte aber auch Code, dem ich
nicht mehr traue: Vieles davon habe ich schnell mit den KI-Modellen von damals geschrieben, und
Struktur, Zustandsverwaltung und Synchronisierung hätten sich ohnehin ändern müssen, um das Produkt
zu werden, das ich will.

Die andere Hälfte der Antwort ist das, was Financy fehlte. Ein Finanztracker für einen Haushalt
braucht eine Anmeldung mit Zwei-Faktor-Authentifizierung, Gruppen mit Rollen, Live-Updates auf jedem
Gerät, eine App, die offline funktioniert, ein Admin-Panel und eine öffentliche Website. Das ist die
Infrastruktur jedes SaaS, keine Finanzlogik, und das meiste davon hatte ich im Oktober in Seed
gebaut ([was im Oktober dazukam](/blog/whats-new-in-seed-october-2026), auf Englisch). Sie in
Financy ein zweites Mal zu schreiben, wäre genau der Fehler, vor dem Seed bewahren soll.

Also ist das alte Financy im Branch [`legacy`](https://github.com/spy4x/financy/tree/legacy)
eingefroren. Es ist Referenz dafür, **was** Financy tut (Funktionen, Geldregeln, Sonderfälle), und
nie dafür, **wie**: Nicht einmal eine Hilfsfunktion wird übernommen. Eine Geldregel von dort ist eine
Hypothese: Sie wird zuerst ein Test und dann neuer Code.

## Wie hat Financy aus Seed angefangen?

Mit einem einzigen Pull Request, [financy#83](https://github.com/spy4x/financy/pull/83): die Dateien
von Seed plus die 19 Dateien, die aus der Kopie Financy machen. Gezählt habe ich sie, indem ich den
ersten Commit von Financy mit dem Seed-Commit verglichen habe, den er festhält:

```sh
git fetch https://github.com/spy4x/seed main
git diff --stat "$(git show 3d267c6f:.seed/commit)" 3d267c6f
```

Diese 19 Dateien sind: die Lizenz AGPL-3.0, mit dem MIT-Hinweis von Seed in einer eigenen Datei; ein
README, das offen sagt, dass die App noch nicht fertig ist; das `AGENTS.md` von Financy mit den
Regeln für jeden Agenten und jeden Menschen, der daran arbeitet; die Produktdokumente; der Image-Name
der Release-Pipeline, damit ein Financy-Tag nie die Images von Seed überschreibt; die vier
verschlüsselten Servereinstellungen von Seed, gelöscht; und die zwei Dateien, die den Abgleich
möglich machen.

Diese zwei sind der ganze Trick. `.seed/commit` enthält den Seed-Commit, dem die Kopie entspricht,
und `.seed/skip` listet die Pfade von Seed, deren Änderungen Financy nie übernimmt, etwa das README.
Ein Abgleich ist dann ein `git diff` von diesem Commit bis zum aktuellen `main` von Seed, angewendet
mit einem Drei-Wege-Merge. Das ganze Rezept steht in
[Start a product from Seed and keep getting its updates](/blog/start-a-product-from-seed-and-keep-its-updates)
(auf Englisch); dieser Beitrag zeigt, was passiert ist, als ich es wirklich befolgt habe.

## Hat der erste Abgleich wirklich funktioniert?

Ja, und mit einer kleinen Falle, die ich ihm absichtlich gestellt habe. Vor dem Abgleich hatte
Financy schon Dateien von Seed geändert: [financy#123](https://github.com/spy4x/financy/pull/123) gab
ihm seinen Namen, ein Geldbörsen-Icon und ein eigenes Blau statt des Violetts von Seed, in 32
Dateien. Ein Abgleich, der nur auf einer unberührten Kopie funktioniert, wäre kein Beweis.

Dann hat [financy#127](https://github.com/spy4x/financy/pull/127) Seed von `ec61062b` auf `d9641f03`
gebracht. Das sind 19 Pull Requests von Seed und 616 geänderte Dateien, und `git apply --3way` hat
sie ohne Konflikt angewendet. Unter anderem kam an:

- die Anmeldung mit einem per E-Mail geschickten Code;
- ein Jahrespreis neben dem Monatspreis;
- eine Zeitzone für die ganze Gruppe;
- API und Worker, die neben Deno auch auf Node und Bun laufen;
- eine Einstellung, wo das Changelog eines Produkts beginnt.

Der Abgleich hat auch einen Schritt gezeigt, den ein Produkt von Hand erledigt. Seed hatte gerade
`AGENTS.seed.md` hinzugefügt, die Regeln des eigenen Seed-Repositorys; Financy hat die Datei gelöscht
und in `.seed/skip` eingetragen, damit kein späterer Abgleich sie zurückbringt. Nach dem Abgleich
unterscheidet sich Financy in 59 Dateien von Seed, und jede davon hat Financy absichtlich geändert.

## Was gehört in Seed statt in Financy?

Alles, was jedes SaaS bräuchte. Das `AGENTS.md` von Financy legt die Reihenfolge fest: Code, den
jedes Projekt nutzen könnte, kommt in die gemeinsamen `@spy4x/*`-Bibliotheken, Code, den jedes
Produkt auf Seed bräuchte, kommt in Seed, und nur was ein Finanzprodukt braucht (Konten,
Buchungen, Budgets, Kurse), bleibt in Financy. Keine lokalen Notlösungen „zum späteren Umziehen“:
„Später“ ist genau der Weg, auf dem ein Fork abdriftet.

Drei Punkte aus der Liste oben sind genau das. Financy braucht jährliche Abrechnung, der Monat eines
Haushalts braucht eine Zeitzone für alle Mitglieder, und sein Changelog darf nicht mit Jahren an
Commits der alten App beginnen. Nichts davon hat mit Geld zu tun, also wurde jedes in Seed gebaut
und kam per Abgleich in Financy an. Am 3. und 4. November entstanden in Seed 31 neue
Issues, die Financy nennen, und bis zum 5. November waren 8 davon geschlossen.

Der Neubau hat auch Lücken in meinem eigenen Rezept gefunden. Die Liste dessen, was ein Produkt von
der Website von Seed entfernt, ließ mehrere Dateien aus, und Schritt 1 hielt den neuesten Commit von
Seed fest, der neuer als die Kopie sein kann, sodass der erste Abgleich die Commits dazwischen still
überspringen würde. Beides ist in Seed behoben ([seed#811](https://github.com/spy4x/seed/pull/811)),
und die [Anleitung](/de/docs/products) erklärt jetzt, wie Sie den Commit finden, dessen Dateien zu
Ihren passen. Diese Korrektur nützt Ihnen mehr als mir: Das nächste Produkt auf Seed stolpert nicht
mehr darüber.

## Was ist noch nicht fertig?

Fast alles. Während ich das schreibe, ist Financy Seed mit dem Namen, der Lizenz und der Farbe von
Financy. Es gibt noch keine Seite für Konten, Buchungen oder Budgets, also nutzen Sie es bitte noch
nicht. Selbst der Name steht nicht fest:
[financy#126](https://github.com/spy4x/financy/issues/126) fragt, ob er bis zum Start bleibt.

Der Plan ist öffentlich: [die Issues von Financy](https://github.com/spy4x/financy/issues), in sieben
Meilensteine gegliedert, vom Fundament bis zum Start und darüber hinaus. Jede Lücke, auf die sie in
Seed stoßen, wird in Seed geschlossen, also zeigt diese Serie beide Seiten: was Financy gebraucht
hat und was Seed daraus gelernt hat.

## Dranbleiben

[Beobachten Sie das Financy-Repository](https://github.com/spy4x/financy) (Watch), um jeden Pull
Request zu sehen, und abonnieren Sie diesen Blog, um Teil 2 per E-Mail zu bekommen. Wenn Sie gerade
ein eigenes Produkt beginnen, ist [die Anleitung](/de/docs/products) dieselbe, der Financy folgt, und
wenn ein Schritt bei Ihnen scheitert, [öffnen Sie ein Issue](https://github.com/spy4x/seed/issues):
Dann fehlt dem Rezept eine Zeile.
