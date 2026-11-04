---
slug: neuf-langues-et-rtl-des-le-premier-jour
language: fr
translationOf: nine-languages-and-right-to-left-from-day-one
title: "Internationaliser un SaaS dès le premier jour : neuf langues et l’arabe de droite à gauche"
seoTitle: "Internationalisation d’un SaaS : neuf langues et RTL dès le départ"
description: "Comment Seed sort en neuf langues dès le premier jour, arabe de droite à gauche compris, et quels tests empêchent de publier un texte non traduit ou une marge qui ne s’inverse pas."
tldr:
  - L’application, le panneau d’administration, le site et les e-mails de Seed existent en neuf langues, arabe compris, avec environ 3 900 messages dans chacune.
  - Un test casse le build si un message manque, est périmé ou a perdu une variable. Un autre refuse une marge « à gauche » ou « à droite » qui ne s’inverserait pas en arabe.
  - La langue est un réglage de la personne, enregistré sur le serveur, indépendant du format de date, du fuseau horaire et de l’horloge.
  - Ajouter une dixième langue, c’est une entrée dans une liste, un fichier par catalogue et quelques lignes de chargement.
topic: En détail
intro: "Seed parle neuf langues dès le premier commit, arabe de droite à gauche compris. Cet article montre comment les catalogues restent complets, et les tests qui bloquent une traduction manquante avant sa mise en ligne."
coverAlt: "Un globe violet entouré de bulles de dialogue vides, avec des flèches qui tournent autour dans les deux sens."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T20:00:00Z
newsletter: false
---

Comment internationaliser un SaaS, arabe de droite à gauche compris, sans devoir tout réécrire plus
tard ? En commençant dès le premier écran, et en laissant les tests monter la garde. Seed sort en
neuf langues : français, anglais, russe, espagnol, allemand, portugais du Brésil, arabe, japonais
et chinois simplifié. Cela vaut pour l’application, le panneau d’administration, le site et les
e-mails. En arabe, toute la mise en page se retourne.

Cet article s’adresse aux fondateurs et aux développeurs qui savent que « on traduira plus tard »
veut dire « on ne traduira jamais ». Je vous montre où vivent les textes, ce que les tests
attrapent, et ce que coûte vraiment le RTL.

## Pourquoi dès le premier jour ?

Parce que traduire après coup oblige à repasser sur chaque écran. Il faut retrouver chaque texte
écrit en dur, chaque date assemblée à la main, chaque `margin-left`, dans un code qui entre-temps
s’est rempli de fonctionnalités. En traduisant dès le début, chaque nouvel écran est traduit
pendant qu’on le construit : quelques minutes, pas un chantier que personne ne veut ouvrir.

Et il y a une raison plus simple : la plupart des gens sur Internet ne lisent pas d’abord en
anglais. Un produit qui parle leur langue part avec une longueur d’avance.

## Où vivent les textes ?

Chaque mot affiché par Seed se trouve dans un catalogue : un fichier TypeScript par domaine et par
langue, comme `i18n/app/fr.ts` ou `i18n/site/ja.ts`. Il y a cinq domaines : l’application, le
panneau d’administration, le site, les e-mails et les messages d’erreur de l’API. L’anglais est la
source, les autres fichiers ont les mêmes clés.

| Domaine         | Messages par langue |
| --------------- | ------------------: |
| L’application   |               1 503 |
| Panneau d’admin |               1 487 |
| Site            |                 682 |
| Codes d’erreur  |                 164 |
| E-mails         |                  79 |

Soit environ 3 900 messages par langue, comptés le 2 novembre 2026. Les composants de
preact-components apportent en plus leurs propres catalogues.

L’application ne charge que votre langue, dans un petit fichier à part : qui lit en français ne
télécharge pas le japonais.

## Qu’est-ce qui empêche une traduction de vieillir ?

Un test, `i18n/i18n.test.ts`. Il échoue quand :

- un message manque dans une langue, ou qu’il en reste un que l’anglais n’a plus ;
- l’anglais a changé après la traduction (chaque langue garde un fichier lock qui note de quelle
  version de l’anglais elle a été traduite) ;
- une traduction a perdu ou mal écrit une variable comme `{count}`, ou une balise autour d’un
  lien ;
- il manque à un pluriel une forme dont la langue a besoin. L’arabe en compte six ;
- plus aucun code n’utilise un message anglais.

Ainsi, ni un bouton qui affiche `Notes.create`, ni un écran allemand en retard d’une semaine sur
l’anglais ne partent en production.

## Que coûte vraiment l’écriture de droite à gauche ?

Moins qu’on ne le craint, tant que la mise en page ne dit jamais « gauche » ni « droite ». Les
styles de Seed utilisent des côtés logiques : « début » et « fin ». Sur une page de gauche à
droite, le début est à gauche ; en arabe, à droite. C’est le navigateur qui retourne tout.

Un test en fait une règle : `tests/spacing.test.ts` parcourt toutes les applications et échoue sur
toute classe d’espacement qui nomme un côté physique. La page règle `dir` selon la langue : le
site sur le serveur, l’application au moment où vous changez de langue.

Deux autres détails qui font mal tard si on les oublie :

- **Les noms dans les phrases.** « Anna vous a invité dans le groupe Team » mélange deux sens en
  arabe, et un nom en alphabet latin peut entraîner la ponctuation du mauvais côté. Les valeurs
  saisies par les utilisateurs sont placées dans `<bdi>`, qui isole leur sens du reste du texte.
- **Dates, nombres et heures.** Chaque date de chaque écran passe par un seul formateur. Un autre
  test, `tests/no-direct-date-format.test.ts`, échoue sur tout appel direct à `toLocaleString()`.

## Langue, format régional et horloge : trois réglages

La langue est enregistrée sur le serveur avec le profil : elle est la même sur tous vos appareils
et dans chaque e-mail. Le format régional, le fuseau horaire et l’horloge sur 12 ou 24 heures sont
des réglages à part. Une Québécoise installée à Paris veut l’interface en français et l’heure de
Paris. Un Britannique installé à Lyon veut des textes en anglais et des dates comme `03/11/2026`.
Lier tout cela en un seul réglage, c’est la meilleure façon d’afficher la mauvaise date à la
moitié de vos utilisateurs.

Sur le site, la langue figure dans l’adresse (`/fr/pricing`, `/ar/pricing`), sans redirection
selon le navigateur ou l’IP, et chaque page indique aux moteurs de recherche quelles versions
existent.

## Qui traduit ?

Des agents d’IA, qui suivent un guide écrit, `i18n/TRANSLATING.md`. Il fixe le ton de chaque
langue (en français, le vouvoiement), un glossaire pour qu’une même chose porte le même nom sur
tous les écrans, et la règle de traduire la situation, pas les mots. Un second agent retraduit
chaque nouvelle traduction vers l’anglais et compare le sens. Ce n’est pas une agence de traduction
professionnelle, et je ne vais pas prétendre le contraire. Mais c’est bien mieux qu’un écran que
personne ne peut lire.

## Ajouter une dixième langue

Une entrée dans la liste des langues, un fichier de catalogue par domaine et quelques lignes dans
chaque application pour le charger. Ensuite, les tests listent chaque message qui manque à la
nouvelle langue, et restent rouges tant qu’elle n’est pas complète.

## Essayez

Ouvrez la [démo](https://app.seedsaas.com), allez dans votre profil et passez la langue en arabe.
Regardez toute l’application se retourner, puis revenez au français. Cet article existe aussi dans
les neuf langues, et le [code](https://github.com/spy4x/seed) est sous licence MIT.
