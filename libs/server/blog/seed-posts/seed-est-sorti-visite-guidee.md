---
slug: seed-est-sorti-visite-guidee
language: fr
translationOf: welcome-to-the-seed-blog
title: "Seed est sorti : visite guidée du starter SaaS gratuit, écran par écran"
seoTitle: "Seed est sorti : le starter SaaS gratuit, écran par écran"
description: Seed, un starter SaaS gratuit sous licence MIT, est utilisable dès aujourd’hui. Ce qui marche dès le premier jour, ce qui manque encore et comment l’essayer en une minute.
tldr:
  - Seed est un starter SaaS gratuit sous licence MIT, utilisable dès aujourd’hui. Vous copiez un dépôt et chaque ligne vous appartient.
  - "Déjà prêt : passkeys et 2FA, groupes avec rôles, facturation par membre via Stripe, temps réel, hors ligne, un panneau d’administration et neuf langues."
  - "Pas encore là : les applications Android et de bureau."
  - La démo s’ouvre en un clic, et en local Seed démarre en quatre commandes.
topic: Seed
intro: "Seed, le starter SaaS gratuit que je construis en public, est utilisable dès aujourd’hui. Voici, écran par écran, ce que vous obtenez dès le premier jour, ce qui manque encore et comment l’essayer en une minute."
coverAlt: "Une pousse violette dans un pot, à côté d’une enveloppe ouverte d’où s’envolent des feuilles comme des lettres."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-01T09:00:00Z
newsletter: false
---

Seed est sorti. C’est un starter SaaS gratuit, sous licence MIT, que vous pouvez utiliser dès
aujourd’hui : vous copiez un dépôt et vous démarrez avec la connexion, des groupes avec rôles, la
facturation par membre via Stripe, les mises à jour en temps réel, une application hors ligne, un
panneau d’administration et neuf langues, déjà en place. Il tourne sur Postgres et Docker Compose,
sur un seul serveur que vous contrôlez, et vous pouvez parcourir l’application dans la
[démo en ligne](https://app.seedsaas.com) avant d’installer quoi que ce soit.

Je m’appelle Anton et je développe des MVP SaaS pour des clients. Chacun commençait par le même mois
de plomberie : connexion, équipes, facturation, et une page d’admin que je promettais toujours
d’embellir « plus tard ». Seed, c’est ce mois-là, fait une fois pour toutes et tenu à jour. Voici la
visite ; une comparaison honnête avec les autres starters se trouve dans
[Boilerplate SaaS gratuit](/fr/blog/boilerplate-saas-gratuit).

## Comment les gens se connectent-ils ?

De toutes les façons qu’ils attendent : e-mail et mot de passe avec code de confirmation, passkeys,
Google et GitHub, et codes de connexion par e-mail. La double authentification avec une application
d’authentification s’active d’un interrupteur sur la page de sécurité, et cette même page liste
chaque appareil connecté, pour fermer une session qu’on ne reconnaît pas. Un visiteur peut aussi
commencer en invité d’un seul clic et ajouter une méthode de connexion plus tard, sans rien perdre.

![La page de sécurité d’un profil : le mot de passe, un bouton Ajouter une clé d’accès, la double authentification activée, et le haut de la liste des appareils connectés.](/shots/profile-security-dark-800.webp)

Personne ne s’est jamais inscrit à un produit parce que la réinitialisation du mot de passe
fonctionnait. Beaucoup sont partis parce qu’elle ne fonctionnait pas. Comment c’est construit sans
payer un service d’authentification :
[Passkeys, 2FA and sessions without an auth SaaS](/blog/passkeys-2fa-sessions-without-auth-saas)
(en anglais).

## Comment fonctionnent les équipes ?

Par des groupes. L’inscription crée le compte, la session et un premier groupe dans une seule
transaction de base de données : un espace personnel et une équipe sont donc la même chose, avec les
mêmes règles. On invite par e-mail, avec l’un des quatre rôles : lecteur, éditeur, administrateur
ou propriétaire. Le propriétaire peut céder le groupe, et un groupe supprimé se restaure pendant
30 jours.

![Les membres d’un groupe, chacun avec son rôle, un bouton pour inviter des personnes, et le menu d’un membre ouvert : Nommer lecteur, Nommer administrateur, Retirer du groupe.](/shots/group-members-dark-800.webp)

## À quoi ressemble la facturation ?

Des abonnements Stripe par groupe, facturés par membre. Le catalogue de la démo a un forfait gratuit
(jusqu’à 3 membres et 10 notes) et un forfait Pro à 9 € par membre et par mois, propriétaire
compris, avec 14 jours d’essai. La quantité suit le nombre de membres, le propriétaire confirme le
nouveau prix avant chaque invitation, et une carte refusée ouvre un délai de grâce au lieu d’un
blocage immédiat. Les prix sont des exemples : vos forfaits sont une liste dans un fichier
([forfaits](/docs/billing-plans), en anglais).

![Le forfait d’un groupe d’exemple dans l’application de démo, aux prix d’exemple de la démo : forfait Pro avec sa date de renouvellement, 36,00 € par mois, pour 4 membres à 9,00 € chacun, propriétaire compris.](/shots/billing-plan-dark-780.webp)

Une équipe de quatre paie 36 € par mois en Pro. Déplacez le curseur pour voir ce que paierait la
vôtre.

<CostCalculator members={4} />

## Que se passe-t-il si deux personnes modifient en même temps, ou si le Wi-Fi tombe ?

Les changements arrivent dans chaque onglet ouvert par WebSocket, et quand le socket est coupé, les
appels passent par HTTP classique. L’application s’installe, s’ouvre sans réseau, lit les dernières
notes et les groupes depuis IndexedDB et met en file les modifications de notes jusqu’au retour de
la connexion. Si quelqu’un a modifié la même note entre-temps, vous voyez un conflit à régler, jamais
un écrasement silencieux du travail d’un collègue.

![La page Notes d’une équipe appelée Acme Studio : six notes avec leurs auteurs, des étiquettes de couleur et l’heure de modification, un champ de recherche, des filtres par étiquette et par auteur, et un bouton Nouvelle note.](/shots/notes-dark-800.webp)

Les notes sont la fonctionnalité de référence : votre première fonctionnalité la copie fichier par
fichier ([votre première fonctionnalité](/blog/your-first-feature-copy-the-notes-aggregate), en anglais). Les détails, en anglais :
[le temps réel par WebSocket avec repli HTTP](/blog/realtime-websocket-with-http-fallback) et
[la synchronisation de la base locale](/blog/offline-first-preact-signals-local-database-sync).

## Que voit l’opérateur ?

Un panneau d’administration sur son propre domaine. Un opérateur retrouve une personne, voit ses
méthodes de connexion, ses sessions et ses groupes, rembourse un paiement, écrit ce blog, s’occupe
des abonnés de la newsletter et relance une tâche en échec. Les actions risquées demandent
confirmation, et chaque action entre dans un journal d’audit.

![La page Utilisateurs du panneau d’administration : une recherche par nom ou adresse, des filtres par statut, type de compte et rôle, et un tableau de personnes inventées avec leur rôle, leur statut et leur dernière activité.](/video/admin-panel-poster-1280.webp)

Chaque fonctionnalité de l’application reçoit son écran d’administration dans le même changement,
pour que les deux ne divergent jamais
([comment le panneau reste synchronisé](/blog/admin-panel-for-every-feature), en anglais).

## Quelles langues parle-t-il ?

Neuf : français, anglais, allemand, espagnol, portugais du Brésil, russe, japonais, chinois
simplifié et arabe, qui se lit de droite à gauche. L’application, le panneau, ce site et les e-mails
changent de langue, vous pouvez donc tester votre mise en page en arabe avant que votre premier
client arabophone ne trouve le bug à votre place
([neuf langues et RTL dès le premier jour](/fr/blog/neuf-langues-et-rtl-des-le-premier-jour)).

## Qu’est-ce qui manque encore ?

L’application Android ([#202](https://github.com/spy4x/seed/issues/202)) et l’application de bureau
([#203](https://github.com/spy4x/seed/issues/203)). Le reste du plan est dans les
[issues ouvertes](https://github.com/spy4x/seed/issues). La connexion avec Google et GitHub et la
facturation Stripe demandent vos propres clés : elles sont donc désactivées dans la démo, qui montre
des paiements inventés plutôt que de vrais. Le panneau d’administration ne fait pas partie de la
démo non plus : [une vidéo le montre](/fr/admin).

Et Seed ne convient pas à tous les projets. Si vous déployez sur des fonctions serverless ou voulez
un backend hébergé, prenez autre chose : Seed suppose un serveur que vous gérez.

## Comment l’essayer ?

Deux chemins, une minute chacun :

- **La démo en ligne.** « Essayer sans compte » ouvre un compte invité rempli de données d’exemple :
  un groupe à vous et deux équipes de personnes inventées. Elle est effacée chaque nuit, alors cassez
  ce que vous voulez.
- **Sur votre machine.** Deno 2 et Docker, puis quatre commandes. Le guide
  [Get started](/docs/get-started) les détaille pas à pas, et
  [l’article d’installation](/blog/install-seed-and-run-it-locally) montre la vraie sortie et les
  pièges habituels (tous deux en anglais).

Commencez par la démo : [ouvrez-la maintenant](https://app.seedsaas.com), cliquez sur « Essayer sans
compte » et fouillez dans une équipe qui n’est pas la vôtre.
