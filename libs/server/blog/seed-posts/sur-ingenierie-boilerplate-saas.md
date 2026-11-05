---
slug: sur-ingenierie-boilerplate-saas
language: fr
translationOf: over-engineering-a-saas-boilerplate
title: "Ce que j'ai raté dans Seed v1 : la sur-ingénierie d'un boilerplate SaaS"
seoTitle: "Sur-ingénierie d'un boilerplate SaaS : mes erreurs sur Seed v1"
description: "Seed v1 a coché la moitié de sa feuille de route et presque rien de ce qu'une personne utilise. À quoi ressemblait la sur-ingénierie d'un boilerplate SaaS dans son code, et ce que fait Seed aujourd'hui."
tldr:
  - "Seed v1 (2019 à 2022) a coché 33 des 66 points de sa feuille de route, et aucun des 17 du client web, du panneau d'administration, de la PWA et de l'envoi de fichiers."
  - "Il comptait 31 projets Nx, 23 classes de messages CQRS et neuf services cloud autour de trois tables."
  - "La sur-ingénierie, c'est construire une fonctionnalité de façon plus compliquée qu'il ne faut. Ce n'est pas construire trop de fonctionnalités."
  - "Seed construit aujourd'hui chaque fonctionnalité de bout en bout sur un seul modèle copié, sur un seul serveur, et a toutes les fonctionnalités produit que v1 n'avait que prévues."
topic: Cicatrices
intro: "Seed a eu une première version, de 2019 à 2022, et je l'ai sur-conçue. Voici à quoi cela ressemblait dans sa feuille de route, ses commits et ses dossiers, et ce que Seed fait autrement aujourd'hui."
relatedFeature: deploy
coverAlt: "Un grand échafaudage violet monté autour d'une minuscule pousse en pot, à côté d'un pot tout simple où une grande plante pousse toute seule."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-07T09:00:00Z
newsletter: true
devto: false
---

Qu'est-ce que j'ai raté dans Seed v1 ? La sur-ingénierie : j'ai monté l'échafaudage d'un gros
produit avant le produit. Sa propre feuille de route le montre. Sur 66 points, 33 étaient cochés,
et cette moitié-là, c'était surtout de l'outillage et de la plomberie backend : un monorepo, des
règles de lint strictes, un hook de pre-commit, des classes de base CQRS, des déploiements sur
Google Cloud. L'autre moitié contenait presque tout ce qu'une personne utilise : les groupes, les
paiements, le temps réel, le hors-ligne, l'envoi de fichiers et le panneau d'administration.

Cet article s'adresse aux développeurs qui construisent leur propre boilerplate SaaS, ou leur
premier SaaS, et qui se demandent s'ils ne sont pas en train de polir l'atelier au lieu de fabriquer
les meubles. Chaque chiffre ci-dessous vient du code : v1 est toujours dans le dépôt, sous le tag
[`v1-final`](https://github.com/spy4x/seed/tree/v1-final), et les commandes qui m'ont servi à
compter sont dans la [pull request](https://github.com/spy4x/seed/pull/823) qui a ajouté cet
article. Aucun souvenir n'a été maltraité : j'ai compté.

## Qu'était Seed v1 ?

Un « full-stack startup monorepo template », selon son README, avec les bonnes pratiques dès le
premier jour. Angular côté front, Nest.js et Prisma sur PostgreSQL côté back, Firebase pour la
connexion, Google Cloud pour l'exécution, Nx pour tenir l'ensemble et Yarn pour l'installer. Le
premier commit date du 16 juin 2019, le dernier du 23 décembre 2022 : 134 commits en trois ans et
demi.

Il ne s'est pas éteint peu à peu. Il s'est arrêté : 55 de ces commits tombent dans ses deux
derniers mois, puis plus rien, jusqu'à ce que Seed reparte sur un nouvel historique le 26 janvier
2026.

## Que promettait la feuille de route, et qu'est-ce qui a été construit ?

La feuille de route du README marquait chaque point comme fait ou prévu. Sa dernière mise à jour
date du 25 novembre 2022 :

| Section de la feuille de route            |   Fait |  Prévu |
| ----------------------------------------- | -----: | -----: |
| Environnement et organisation du code     |      8 |      7 |
| Backend                                   |     14 |      5 |
| Base de données                           |      3 |      1 |
| Frontend partagé (connexion, état, tests) |      6 |      3 |
| Styles                                    |      2 |      0 |
| PWA (hors-ligne, push, installable)       |      0 |      4 |
| Envoi de fichiers                         |      0 |      4 |
| Panneau d'administration                  |      0 |      3 |
| Client web (groupes, temps réel, compte)  |      0 |      6 |
| **Total**                                 | **33** | **33** |

Les abonnements Stripe étaient dans la section Backend, prévus. Une table des utilisateurs pour le
panneau d'administration est bien arrivée en décembre 2022, après la dernière mise à jour ;
accordons-la à v1.

Trois des 33 coches concernaient les sauvegardes automatiques, la restauration d'une sauvegarde et
les réplicas en lecture. Chacune renvoyait vers la documentation de Google Cloud SQL, et le
document d'infrastructure précisait que la réplication était « not yet used ». Je cochais les
devoirs faits par Google.

## Où est passé le travail ?

Dans l'atelier. Les messages de commit portent leur type, et ils racontent l'histoire mieux que
moi :

- **52 des 134 commits sont de type `env` ou `environment`** : configuration, outillage, CI, mises
  à jour et renommages. 31 sont des `feat`.
- **Le premier commit qui permet à une personne de faire quoi que ce soit** (une API utilisateurs
  basique : s'inscrire, lire et modifier son profil) est le numéro 38, du 31 mai 2021, presque deux
  ans après le premier. Parmi les 37 premiers, 28 sont des commits `environment`.
- **La CI a été mise en place trois fois** : GitLab CI en juillet 2019, GitHub Actions en mars
  2021, Google Cloud Build en juin 2021. La dernière feuille de route listait encore le CI/CD comme
  prévu.
- **Quatre renommages d'applications et de dossiers en deux jours** en février 2021, et un commit
  intitulé « massive refactoring » un an plus tard.

## Combien de structure pour si peu de données ?

Le schéma de base de données de v1 compte trois modèles : `User`, `UserDevice` et
`Notification`. Autour d'eux :

- **31 projets Nx** : trois applications, deux applications de tests de bout en bout et 26
  bibliothèques. La connexion partagée du front à elle seule faisait quatre bibliothèques :
  container, guards, state et UI.
- **65 fichiers `index.ts`**, dont 63 se contentent de réexporter d'autres fichiers.
- **Une couche CQRS avec ses propres classes de base** au-dessus des bus de commandes, de requêtes
  et d'événements, portant 11 commandes, 5 requêtes et 7 événements, avec 19 handlers.
- **Neuf services cloud** dans le document d'infrastructure (Cloud Run, Cloud SQL, Cloud Tasks,
  Cloud Logging, Cloud IAM, Firebase Authentication, Hosting et Storage, et Sentry), et un guide
  d'installation marqué « WIP » qui commençait par des étapes manuelles.
- **104 paquets npm** dans le `package.json` racine, dont 50 dépendances d'exécution.

À titre de comparaison, Seed compte aujourd'hui 34 paquets de workspace autour de 73 tables. La
structure grandit désormais avec les données au lieu de les attendre.

## Le problème, c'était trop de fonctionnalités ?

Non, et c'est le point que je tiens à poser clairement. La sur-ingénierie, c'est construire une
fonctionnalité de façon plus compliquée qu'il ne faut : des couches en trop, des protections contre
des cas de concurrence rarissimes, de l'automatisation que personne ne lance. Ce n'est pas « cette
fonctionnalité est inutile ». La liste de souhaits de v1 tenait la route. Seed a aujourd'hui toutes
les fonctionnalités produit que v1 n'avait que prévues, et plus : passkeys et second facteur,
groupes avec rôles et invitations, facturation Stripe par membre, temps réel, une application qui
marche hors-ligne, un stockage de fichiers, un panneau d'administration sur son propre hôte et neuf
langues ([README](https://github.com/spy4x/seed#readme)).

Il utilise même toujours CQRS : commandes, requêtes et événements passent chacun par son propre bus,
et chaque changement de groupe écrit son événement dans une outbox que vide un worker. Le pattern
n'a jamais été le coupable. Le coupable, c'était d'écrire quatre bibliothèques de connexion avant
qu'un seul groupe existe.

## Que fait Seed autrement aujourd'hui ?

- **Un seul modèle pour chaque fonctionnalité.** Une nouvelle fonctionnalité copie celle des notes
  fichier par fichier, dans un ordre fixe :
  [tous les fichiers de l'agrégat des notes](/fr/docs/aggregates). Le guide le dit sans détour :
  « Do not invent a second shape », n'inventez pas une deuxième forme.
- **Un serveur au lieu de neuf services.** Docker Compose fait tourner l'application, Postgres, le
  proxy et la supervision sur un serveur que vous contrôlez :
  [de git clone à la production sur un serveur Hetzner](/blog/deploy-saas-to-one-hetzner-server)
  (en anglais).
- **Des principes qui disent non.** Les
  [principes de Seed](https://github.com/spy4x/seed/blob/main/docs/principles.md) comprennent « Ship
  small, safe slices », « Avoid speculative complexity » et « Add deps only with clear ROI » :
  livrer par petites tranches sûres, pas de complexité au cas où, une dépendance seulement quand
  elle rapporte clairement.
- **Les standards du web plutôt que les frameworks.** Les serveurs parlent Fetch, Web Crypto et
  WebSocket, pas l'API privée d'une plateforme :
  [pourquoi Seed est construit sur les standards du web](/blog/why-seed-free-saas-starter-web-standards)
  (en anglais).

Les types de commits ont bougé aussi. Sur les 531 commits de Seed depuis le redémarrage, 194 sont
des `feat` et 46 des `chore`, `ci` ou `build`. La plupart sont des pull requests fusionnées en
squash, donc pas de la même taille que les commits de v1, mais la direction est nette.

## Votre boilerplate fait-il la même chose ?

Trois vérifications rapides, tirées des chiffres de v1 :

1. Comptez vos dossiers et vos tables. Plus de bibliothèques que de tables, c'est mauvais signe.
2. Relisez la moitié « prévue » de votre feuille de route. Si tout ce qu'un utilisateur toucherait
   s'y trouve, vous construisez l'atelier.
3. Cherchez le commit où une personne a pu faire quelque chose pour la première fois. Si c'est le
   38e, bonjour, c'est moi.

Ou sautez l'échafaudage : [Seed](https://github.com/spy4x/seed) est gratuit, sous licence MIT, et
ses fondations sont déjà construites. Clonez-le et
[livrez votre première fonctionnalité](/blog/your-first-feature-copy-the-notes-aggregate) cette
semaine (en anglais).
