---
slug: boilerplate-saas-gratuit
language: fr
translationOf: free-saas-boilerplate
title: Existe-t-il un boilerplate SaaS gratuit et open source ? Sept options comparées honnêtement
seoTitle: "Boilerplate SaaS gratuit : 7 kits open source comparés"
description: Oui. Seed, Open SaaS, Next.js SaaS Starter, ixartz, Apptension, BoxyHQ et Makerkit Lite sont gratuits et ouverts. Ce que chacun inclut, où il s'héberge, et quand choisir lequel.
tldr:
  - Oui, plusieurs boilerplates SaaS gratuits et open source existent, avec connexion, paiements et tableau de bord.
  - Les éditions gratuites de kits payants retirent souvent les paiements ou les équipes.
  - Le code est gratuit ; l'hébergement ne l'est pas. Regardez où chaque kit veut tourner avant de choisir.
  - Seed apporte des groupes avec rôles, la facturation Stripe par membre, un panneau d'administration et neuf langues sur votre propre serveur.
topic: Questions
author: Anton Shubin
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

Oui : il existe plusieurs boilerplates SaaS gratuits et open source, et les bons incluent déjà la
connexion, les paiements et un tableau de bord. Au 3 novembre 2026, Seed, Open SaaS, le Next.js
SaaS Starter de Vercel, ixartz SaaS Boilerplate, Apptension SaaS Boilerplate, BoxyHQ SaaS Starter
Kit et Makerkit Lite sont sous licence MIT ou Apache-2.0. Ce qui les sépare, c'est ce que chacun
laisse de côté et l'endroit où il veut tourner.

Je développe Seed, donc je ne suis pas neutre. Chaque fait sur un autre projet renvoie à la page où
je l'ai lu le 3 novembre 2026, et quand un autre kit vous convient mieux, je le dis.

## Quels boilerplates SaaS gratuits existent ?

| Kit                                | Licence    | Stack                         | Équipes et rôles                                | Paiements                      | Hébergement                                            |
| ---------------------------------- | ---------- | ----------------------------- | ----------------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| [Seed][seed]                       | MIT        | Deno, Hono, Preact, Postgres  | Groupes : lecteur, éditeur, admin, propriétaire | Stripe, par membre             | Docker Compose sur n'importe quel serveur Linux à vous |
| [Open SaaS][opensaas]              | MIT        | Wasp : React, Node.js, Prisma | Non mentionnés                                  | Stripe, Polar ou Lemon Squeezy | Fly.io ou Railway en une commande, ou tout hébergeur   |
| [Next.js SaaS Starter][next]       | MIT        | Next.js, Postgres, Drizzle    | Owner et Member                                 | Stripe                         | Vercel, d'après son guide                              |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js, Drizzle, Clerk       | Organisations avec rôles, via Clerk             | Pas dans l'édition gratuite    | Non précisé                                            |
| [Apptension SaaS Boilerplate][app] | MIT        | React, Django, Postgres       | Tenants : Owner, Admin, Member                  | Stripe                         | AWS, via AWS CDK                                       |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js, Prisma, Postgres     | Équipes avec rôles                              | Abonnements Stripe par équipe  | Boutons Vercel, Heroku et DigitalOcean                 |
| [Makerkit Lite][mk]                | MIT        | Next.js, Supabase             | Pas dans Lite                                   | Pas dans Lite                  | Tout hébergeur qui fait tourner Next.js                |

« Non mentionnés » signifie que la page du projet n'en parle pas. Ce n'est pas la preuve que ça
manque, mais n'y comptez pas.

## Gratuit, mais qui héberge, et qui paie l'hébergement ?

La licence est gratuite ; la facture d'hébergement, elle, arrive chaque mois. Et c'est là que les
kits diffèrent le plus.

- **Un serveur à prix fixe.** Seed tourne entièrement en Docker Compose sur un seul serveur Linux :
  base Postgres, stockage de fichiers (Garage, un stockage S3 inclus), supervision. Vous le posez
  chez l'hébergeur de votre choix, en France ou ailleurs en Europe, et vous savez où sont les
  données pour votre registre RGPD.
- **Une plateforme facturée à l'usage.** Le guide du Next.js SaaS Starter déploie sur Vercel,
  l'infrastructure d'Apptension est écrite pour AWS, et Makerkit Lite s'appuie sur Supabase.
  Pratique au début ; surveillez la facture quand le trafic monte.
- **Un service tiers pour la connexion.** ixartz authentifie les utilisateurs via Clerk, un service
  hébergé : leurs comptes vivent chez Clerk, pas dans votre base. À noter dans votre registre de
  traitements.

Stripe est [disponible][stripe-global] en France, en Belgique, en Suisse, au Luxembourg et au
Canada, donc la partie paiement fonctionne pour la plupart des lecteurs francophones. Pour le
Maghreb, ce n'est pas le cas : ni le Maroc, ni la Tunisie, ni l'Algérie ne sont dans la liste
(vérifié le 3 novembre 2026).

## Quand un autre kit est-il le meilleur choix ?

- **Open SaaS**, si vous vendez à des particuliers et voulez Polar ou Lemon Squeezy en plus de
  Stripe. En échange, vous adoptez le framework Wasp.
- **Next.js SaaS Starter**, si vous voulez une base Next.js courte, lisible en un après-midi.
- **ixartz**, si Clerk vous va et que vous voulez équipes et traductions gratuitement ; les
  paiements sont dans ses éditions payantes Plus, Pro et Max.
- **Apptension**, si votre équipe code en Python et Django : double authentification, passkeys,
  SSO, trois rôles, Stripe et administration.
- **BoxyHQ**, si vous vendez à de grands comptes qui exigent SAML SSO et SCIM dès le premier jour.
  Il inclut aussi des abonnements Stripe par équipe.

## Que contient Seed ?

Seed vise un produit payé par des équipes, sur un serveur que vous contrôlez. Sur `main`
aujourd'hui : connexion par mot de passe, passkeys, Google, GitHub et lien par e-mail, second
facteur par application d'authentification, groupes à quatre rôles avec invitations, facturation
Stripe par membre avec plan gratuit et 14 jours d'essai, panneau d'administration sur son propre
domaine, notifications dans l'application, par web push et sur Telegram, application qui marche
hors ligne, et neuf langues, français compris.

Ses limites, franchement : Stripe uniquement, serveurs sous Deno 2 (Node et Bun sont
[prévus][runtime], sans date), pas de serverless, et un seul mainteneur : moi.

## Par où commencer ?

Deux questions suffisent : qui vous paie, une personne ou une équipe, et où vos données doivent
vivre. Le tableau se réduit alors à une ou deux lignes. Si la réponse est « des équipes, sur mon
serveur », essayez la [démo](https://app.seedsaas.com) en français, lisez la
[comparaison avec les kits payants](/fr/compare) et partez du [dépôt][seed].

[seed]: https://github.com/spy4x/seed
[runtime]: https://github.com/spy4x/seed/issues/623
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
[stripe-global]: https://stripe.com/global
