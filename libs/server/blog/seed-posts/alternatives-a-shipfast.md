---
slug: alternatives-a-shipfast
language: fr
translationOf: shipfast-alternatives
title: "Alternatives à ShipFast : 7 boilerplates SaaS gratuits et payants"
seoTitle: "Alternatives à ShipFast : 7 boilerplates SaaS comparés"
description: Quelle alternative à ShipFast choisir ? Sept boilerplates SaaS comparés sur le prix, la licence, la stack, les équipes et l'hébergement, chaque fait sourcé et daté.
tldr:
  - ShipFast coûte de 199 à 299 dollars en une fois et convient aux produits payés par une seule personne.
  - "Gratuits et sous licence MIT : Seed, Open SaaS, ShipFree et le Next.js SaaS Starter."
  - Si vos clients sont des équipes, prenez un modèle avec groupes, rôles et facturation par membre.
  - Freelance ou agence ? Sous MIT, le code se remet au client sans licence à racheter.
topic: Questions
intro: "ShipFast est un bon kit, mais ce n'est pas le seul, et il n'est pas gratuit. J'ai comparé sept boilerplates sur le prix, la licence, la stack, les équipes et l'hébergement, avec une source pour chaque fait."
coverAlt: "Sept voiliers de formes différentes alignés sur une eau calme, dont un violet."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T09:00:00Z
newsletter: false
---

Les principales alternatives à ShipFast sont des starters gratuits sous licence MIT (Seed, Open
SaaS, ShipFree, le Next.js SaaS Starter et le SaaS Boilerplate d'Ixartz) et des kits payants plus
chers (Makerkit et Supastarter). Lequel vaut mieux que ShipFast pour vous dépend d'une question :
qui paie votre produit, une personne ou une équipe ? ShipFast est fait pour le premier cas ; les
autres se distinguent par ce qu'ils apportent tout prêt pour le second.

Je développe Seed, l'un des sept, je ne suis donc pas neutre. C'est pourquoi chaque fait sur un
autre produit renvoie à la page d'où il vient, et qu'une section dit quand ShipFast est le meilleur
choix. J'ai lu toutes les pages le 3 novembre 2026. Un fait n'est plus à jour ?
[Ouvrez une issue](https://github.com/spy4x/seed/issues), je le corrige.

## Que contient ShipFast ?

ShipFast est un boilerplate Next.js créé par Marc Lou. Sa [page de vente](https://shipfa.st/)
affiche 199 dollars pour Starter et 249 pour All-in, payés une fois, et 299 avec sa formation
CodeFast. On y trouve la connexion par Google ou par lien magique (NextAuth), MongoDB ou Supabase,
le paiement par Stripe ou Lemon Squeezy, l'e-mail par Mailgun ou Resend, un blog et des outils SEO.

La [licence](https://shipfa.st/license) autorise des projets illimités, commerciaux compris, mais
interdit de revendre ou redistribuer le modèle, et le code reste la propriété de ShipFast. Elle ne
dit rien de l'open source : demandez avant de publier un produit construit dessus.

Ce que la page ne mentionne pas : groupes ou organisations, rôles, second facteur, passkeys,
espace d'administration, traductions. Pour un outil payé par une seule personne, cela peut ne
jamais manquer. Pour un produit B2B, c'est le premier mois de travail.

## ShipFast et ses alternatives dans un tableau

| Modèle                                                                | Prix                         | Licence                      | Stack                                    | Équipes et rôles            | Hébergement                             |
| --------------------------------------------------------------------- | ---------------------------- | ---------------------------- | ---------------------------------------- | --------------------------- | --------------------------------------- |
| [ShipFast](https://shipfa.st/)                                        | 199 ou 249 USD, une fois     | Payante, sans redistribution | Next.js ; MongoDB ou Supabase            | Non mentionnés              | Vercel cité comme option gratuite       |
| [Seed](https://github.com/spy4x/seed)                                 | Gratuit                      | MIT                          | Deno, Hono, Preact ; Postgres            | Oui, facturation par membre | Un serveur Linux à vous, Docker Compose |
| [Open SaaS](https://github.com/wasp-lang/open-saas)                   | Gratuit                      | MIT                          | Wasp (React, Node.js, Prisma) ; Postgres | Non mentionnés              | Railway ou Fly.io en une commande       |
| [ShipFree](https://github.com/revokslab/shipfree)                     | Gratuit                      | MIT                          | Next.js, Bun, Drizzle ; Postgres         | Non mentionnés              | Vercel ou Docker                        |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)        | Gratuit                      | MIT                          | Next.js, Drizzle ; Postgres              | Owner et Member             | Vercel                                  |
| [Ixartz SaaS Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) | Gratuit ; éditions payantes  | MIT (édition gratuite)       | Next.js, Clerk, Drizzle                  | Oui                         | Non précisé ; Node.js 24+               |
| [Makerkit](https://makerkit.dev/pricing)                              | 299 ou 599 USD, une fois     | Payante ; Lite sous MIT      | Next.js, React Router ou TanStack Start  | Oui                         | Non précisé                             |
| [Supastarter](https://supastarter.dev/)                               | De 349 à 1 499 USD, une fois | Payante                      | Next.js, Nuxt ou TanStack Start          | Oui, facturation par siège  | Vercel, serverless ou Docker            |

« Non mentionnés » signifie que les pages du produit n'en parlent pas, pas qu'on ne peut jamais
l'ajouter. Les prix de Makerkit sont remisés ; sans remise, 349 et 649 dollars. L'édition gratuite
d'Ixartz n'a pas Stripe : le paiement arrive avec les éditions payantes Pro et Max.

## Freelance ou agence : à qui appartient le code livré ?

Si vous construisez des SaaS pour des clients, la licence compte autant que les fonctionnalités.
ShipFast garde la propriété de son code et interdit de le redistribuer, ce qui pose la question de
ce que vous remettez au client. Supastarter vend une offre Agency à 1 499 dollars pour les projets
clients, jusqu'à dix développeurs.

Avec un modèle sous MIT, comme Seed, Open SaaS ou ShipFree, la question disparaît : le client reçoit
le code, peut le confier à quelqu'un d'autre plus tard, et personne n'a de licence à racheter.
Seed parle aussi français, dans l'application, l'administration, le site et les e-mails, parmi
neuf langues ; ShipFree propose l'anglais, le français et l'espagnol.

## Quelle alternative gratuite ressemble le plus à ShipFast ?

**ShipFree** est la copie la plus directe de l'idée : un kit Next.js gratuit qui se présente comme
une alternative à ShipFast, désormais sur Bun, Drizzle et Better Auth, avec Stripe et cinq autres
prestataires de paiement. Environ 1 700 étoiles sur GitHub.

**Open SaaS** est le modèle gratuit le plus populaire ici, avec environ 16 200 étoiles. Il repose
sur le framework Wasp et apporte un tableau de bord d'administration, l'envoi de fichiers vers S3,
Stripe, Polar ou Lemon Squeezy, et un site de documentation.

**Le Next.js SaaS Starter**, environ 16 200 étoiles lui aussi, est petit à dessein : connexion par
e-mail, Stripe Checkout, équipes avec les rôles Owner et Member. Il se lit en un après-midi.

## Et si vos clients sont des équipes ?

C'est là que Seed est le plus fort. Chaque personne reçoit un groupe à l'inscription, les groupes
ont des rôles de lecteur à propriétaire, et Stripe facture par membre : le prix suit la taille de
l'équipe. La connexion est faite : mot de passe, passkeys, lien par e-mail, Google et GitHub, et
une application d'authentification en second facteur. L'administration, sur son propre domaine,
retrouve une personne, rembourse un paiement et inscrit chaque action dans un journal d'audit.
L'application fonctionne hors ligne et se met à jour en temps réel.

Le tout tourne sur un serveur que vous louez, avec Postgres et la supervision dans Docker Compose,
pour un prix fixe par mois et des données là où vous les hébergez. Le
[tableau comparatif complet](/fr/compare) couvre 19 fonctionnalités sur six starters. Parmi les
kits payants, **Supastarter** et **Makerkit** ont aussi des organisations.

## Quand ShipFast reste-t-il le meilleur choix ?

- Vous travaillez en Next.js et React et voulez y rester.
- Vous vendez à des particuliers et voulez une landing page, le paiement et un blog en ligne ce
  week-end.
- Vous voulez une grande communauté : son Discord (plus de 5 000 makers selon sa page) et la
  formation font partie de l'achat.
- Il vous faut Lemon Squeezy aujourd'hui. Seed ne facture que par Stripe ; un prestataire merchant
  of record est une idée ouverte ([#584](https://github.com/spy4x/seed/issues/584)), pas un plan.
- Vous déployez sur Vercel ou en fonctions serverless. Seed demande un serveur que vous contrôlez.

Et les risques de Seed, sans fard : c'est un projet jeune, avec un seul mainteneur, qui tourne
aujourd'hui sur Deno ; Node.js et Bun restent à venir.

## Choisir en dix minutes

1. Notez qui paie : une personne, ou une équipe avec un administrateur.
2. Pour une équipe, rayez du tableau tout ce qui n'a ni groupes ni rôles.
3. Si vous livrez à des clients, relisez la licence avant le prix.
4. Ouvrez la démo ou le dépôt et inscrivez-vous avant de dépenser un centime.

La démo de Seed est l'application que vous avez le premier jour, avec des personnes et des données
inventées : [essayez-la sur app.seedsaas.com](https://app.seedsaas.com), puis voyez
[ce que coûte son hébergement](/fr/pricing).
