---
slug: alternatives-a-open-saas
language: fr
translationOf: open-saas-alternatives
title: "Alternatives à Open SaaS : quand le starter gratuit de Wasp ne convient pas"
seoTitle: "Alternatives à Open SaaS (Wasp) : starters SaaS gratuits et payants"
description: "Open SaaS est gratuit, sous MIT et construit sur Wasp, mais sans équipes. Si vous vendez à des équipes ou voulez du code simple sur votre serveur, voici les alternatives."
tldr:
  - Open SaaS est gratuit et sous MIT, avec paiements, tableau d'administration et envoi de fichiers, sur Wasp.
  - "Il n'a ni équipes ni organisations : chaque abonnement appartient à une seule personne."
  - Pour vendre à des équipes, regardez Seed (gratuit, MIT) ou les payants Makerkit et Supastarter.
  - Gardez Open SaaS si l'on achète seul, si vous voulez déployer en une commande ou utiliser Polar et Paddle.
topic: Questions
intro: "Open SaaS est l'un des meilleurs starters SaaS gratuits, sincèrement. Mais il fait deux choix pour vous : un abonnement par personne et le framework Wasp. Voici quoi prendre si l'un des deux ne vous va pas."
relatedFeature: groups
coverAlt: "Une serre en verre avec une grande jardinière partagée de plantes violettes à l'intérieur et une rangée de cinq petits pots près de sa porte ouverte."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

Open SaaS est l'un des starters SaaS gratuits les plus complets : licence MIT, environ 16 250
étoiles sur GitHub, avec paiements, tableau d'administration et envoi de fichiers inclus. Il vous
faut une alternative dans trois cas : vous vendez à des équipes (Open SaaS n'a pas
d'organisations), vous préférez ne pas bâtir sur le framework Wasp, ou vous le voulez sur votre
propre serveur. Regardez alors Seed (gratuit, MIT, avec équipes et facturation par membre) ou les
payants Makerkit et Supastarter.

Je développe Seed, je ne suis donc pas neutre. Chaque fait sur un autre produit renvoie à sa
source, et je les ai tous vérifiés le 4 novembre 2026. Une info dépassée ?
[Ouvrez une issue](https://github.com/spy4x/seed/issues), je corrige.

## Que vous apporte Open SaaS ?

[Open SaaS](https://github.com/wasp-lang/open-saas) est un modèle gratuit de l'équipe derrière le
framework Wasp. Son README en promet beaucoup pour zéro euro :

- l'inscription par e-mail avec vérification, et Google, GitHub et Discord prêts à activer dans sa
  [configuration de connexion](https://github.com/wasp-lang/open-saas/blob/main/template/app/src/auth/auth.wasp.ts) ;
- les paiements via Stripe, Polar ou Lemon Squeezy, et son code intègre aussi Paddle ;
- un tableau d'administration sur shadcn/ui, l'envoi de fichiers vers AWS S3 et l'e-mail via
  SendGrid, Mailgun ou SMTP ;
- Plausible ou Google Analytics, une app de démo avec OpenAI, un site de documentation et un blog
  sous Astro, et des tests de bout en bout avec Playwright ;
- des règles, des skills et un plugin Claude Code pour les agents de code IA.

Et il est vivant : le dernier commit date du 28 octobre 2026.

Ce qu'il n'a pas, ce sont les équipes. Son
[schéma de base de données](https://github.com/wasp-lang/open-saas/blob/main/template/app/schema.prisma)
contient un `User` avec un champ `isAdmin` et aucun modèle d'équipe ou d'organisation : un
abonnement appartient donc à une personne. Pour un outil que chacun achète pour soi, c'est
exactement ce qu'il faut. Pour un produit B2B, équipes, invitations, rôles et facturation par
siège, ce sont vos premières semaines de travail.

## Que signifie construire sur Wasp ?

Wasp est un framework full-stack : vous décrivez pages, routes, connexion, tâches et opérations
serveur dans un seul fichier, `main.wasp.ts`, et Wasp construit l'app sur React, Node.js et Prisma
([documentation de Wasp](https://wasp.sh/docs)). Il supprime beaucoup de code de liaison, c'est
tout son intérêt.

En échange, votre app prend la forme du framework. Vous apprenez sa spécification, vous mettez à
jour quand il le fait, et Wasp n'a pas encore atteint la 1.0 : sa dernière version est la
[0.26.1, du 23 octobre 2026](https://github.com/wasp-lang/wasp/releases). Beaucoup d'équipes s'en
accommodent très bien. Faites simplement ce choix en connaissance de cause.

Le déploiement est simple : `wasp deploy` envoie la base, le serveur et le client sur Fly.io ou
Railway en une commande, et la voie manuelle fonctionne chez n'importe quel hébergeur
([guide de déploiement](https://docs.opensaas.sh/guides/deploying/)). Le guide ne parle pas de
Docker.

## Les alternatives côte à côte

| Fonctionnalité   | Open SaaS                         | Seed                                        | Makerkit                                   | Supastarter                           |
| ---------------- | --------------------------------- | ------------------------------------------- | ------------------------------------------ | ------------------------------------- |
| Prix             | Gratuit                           | Gratuit                                     | 299 $ ou 599 $, une fois                   | De 349 $ à 1 499 $, une fois          |
| Licence          | MIT                               | MIT                                         | Payante ; le kit Lite est sous MIT         | Payante                               |
| Stack            | Wasp (React, Node.js, Prisma)     | Hono, Preact ; Postgres                     | Next.js 16 ou TanStack Start, entre autres | Next.js, Nuxt ou TanStack Start       |
| Équipes et rôles | Non                               | Oui, de lecteur à propriétaire              | Oui, avec invitations et permissions       | Oui, avec invitations et rôles        |
| Paiements        | Stripe, Polar, Lemon Squeezy      | Stripe, par membre                          | Non vérifié                                | Stripe, Lemon Squeezy et trois autres |
| Administration   | Tableau d'administration          | App dédiée sur son domaine, journal d'audit | Absent du kit Lite                         | Non vérifié                           |
| Hébergement      | Fly.io ou Railway en une commande | Docker Compose sur votre serveur            | Non vérifié                                | Vercel, serverless ou Docker          |

Sources : [README d'Open SaaS](https://github.com/wasp-lang/open-saas),
[tarifs de Makerkit](https://makerkit.dev/pricing), [Supastarter](https://supastarter.dev/) et le
[README de Seed](https://github.com/spy4x/seed). Les prix de Makerkit sont ses prix remisés ; les
prix catalogue sont 349 $ et 649 $. « Non vérifié » signifie que je ne l'ai pas trouvé sur les
pages lues, pas que le produit ne l'a pas.

## Quelle alternative pour un produit vendu aux équipes ?

C'est précisément le cas pour lequel j'ai fait Seed. Chaque personne reçoit un groupe à
l'inscription, les groupes ont des rôles de lecteur à propriétaire et des invitations par e-mail,
et Stripe facture par membre : la quantité suit le nombre de membres, avec un plan gratuit, 14
jours d'essai et un délai de grâce après un paiement échoué
([documentation de facturation](https://github.com/spy4x/seed/blob/main/docs/billing.md)). La
[page des groupes](/fr/features/groups) montre comment ça marche.

Le reste des fondations est prêt aussi :

- connexion par mot de passe, passkey, Google, GitHub ou code par e-mail, comptes invités et une
  app d'authentification comme second facteur ;
- une app d'administration sur son propre domaine, où chaque action va dans un journal d'audit ;
- des mises à jour en temps réel par WebSocket et une app qui s'ouvre et garde les modifications
  hors ligne ;
- un stockage de fichiers, neuf langues dont l'arabe de droite à gauche, et sauvegardes et
  supervision dans le fichier Compose.

C'est du TypeScript ordinaire sur Hono et Preact, sans fichier de spécification ni générateur de
code entre vous et votre code. Il tourne avec Docker Compose sur un serveur que vous louez, donc la
facture est un prix fixe par mois.

Côté payant, **Makerkit** et **Supastarter** ont tous deux des organisations avec invitations et
rôles, et Supastarter facture au siège. Le petit frère gratuit, Makerkit Lite, n'a ni équipes ni
facturation.

## Quand Open SaaS est-il le meilleur choix ?

- Vous vendez à des particuliers et voulez paiements, tableau d'administration et envoi de
  fichiers, gratuitement, aujourd'hui.
- Vous aimez le modèle de Wasp : un fichier de spécification et beaucoup moins de code de liaison.
- Vous voulez Polar, Lemon Squeezy ou Paddle. Seed ne facture que via Stripe ; un fournisseur
  merchant of record est une idée ouverte ([#584](https://github.com/spy4x/seed/issues/584)), pas
  un plan.
- Vous voulez déployer en une commande sur Fly.io ou Railway, sans serveur à entretenir.
- Vous voulez une grande communauté : Wasp a un [Discord](https://discord.gg/rzdnErX), et Open SaaS a bien plus d'étoiles sur
  GitHub que Seed.

Les risques de Seed, pour peser honnêtement : c'est un projet jeune avec un seul mainteneur. Son
API et son worker tournent aussi sur Node ou Bun avec une ligne dans le fichier env
([à propos du runtime](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), mais le
site et l'outillage ont encore besoin de Deno. Ses apps Android et bureau
[n'existent pas encore](https://github.com/spy4x/seed/issues/202).

## Comment les comparer en un après-midi ?

1. Créez une app Open SaaS avec `wasp new -t saas`, comme l'indique son README.
2. Ouvrez la [démo en ligne](https://app.seedsaas.com) de Seed : un clic vous connecte à un compte
   invité avec des données d'exemple.
3. Dans les deux, testez ce que vos clients feront le premier jour. S'ils arrivent en équipe,
   invitez un collègue et ouvrez la facturation.

Mes autres comparatifs : [alternatives à ShipFast](/fr/blog/alternatives-a-shipfast) met sept
starters dans un tableau, et [le guide du boilerplate SaaS gratuit](/fr/blog/boilerplate-saas-gratuit)
explique ce qu'un starter gratuit devrait déjà contenir. Si Seed vous va,
[le dépôt](https://github.com/spy4x/seed) est à un clone de vous.
