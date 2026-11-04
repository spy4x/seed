---
slug: alternatives-a-nextjs-saas-starter
language: fr
translationOf: nextjs-saas-starter-alternatives
title: "Alternatives au Next.js SaaS Starter : que prendre quand il devient trop petit"
seoTitle: "Alternatives au Next.js SaaS Starter, gratuites et payantes"
description: "Le Next.js SaaS Starter est gratuit et volontairement minimal : pas de réinitialisation de mot de passe ni d'e-mail d'invitation. Des alternatives plus complètes."
tldr:
  - Le Next.js SaaS Starter est gratuit et sous MIT, avec des équipes propriétaire et membre et Stripe Checkout.
  - "Il n'envoie aucun e-mail : invitations, réinitialisation du mot de passe et vérification sont à votre charge."
  - Gratuit avec tout cela prêt, c'est Seed ; pour rester sur Next.js avec plus de choses prêtes, Makerkit ou Supastarter.
  - Gardez le starter si vous voulez un petit code pour apprendre, ou écrire la connexion à votre façon.
topic: Questions
intro: "Le Next.js SaaS Starter est une base propre et petite, et son propre README dit qu'il sert à apprendre. Voici ce qui lui manque, et quel starter choisir quand vous avez besoin de ces briques toutes prêtes."
relatedFeature: sign-in
coverAlt: "Un petit cadre en bois autour d'une seule pousse, devant une serre en verre terminée et pleine de plantes violettes."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

Le Next.js SaaS Starter est un modèle gratuit sous licence MIT : connexion par e-mail et mot de
passe, Stripe Checkout et équipes avec les rôles propriétaire et membre. Son README le dit
volontairement minimal, une ressource pour apprendre. Les alternatives servent quand vous voulez
plus de briques prêtes : Seed est gratuit et sous MIT, avec invitations, réinitialisation du mot de
passe, passkeys et facturation par membre, et Makerkit et Supastarter sont des kits payants qui
vous gardent sur Next.js.

Je développe Seed, gardez-le en tête. Chaque fait sur un autre produit renvoie à sa source, et je
les ai vérifiés le 4 novembre 2026. Une info dépassée ?
[Ouvrez une issue](https://github.com/spy4x/seed/issues), je corrige.

## Que contient le Next.js SaaS Starter ?

Le [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) se trouve dans l'organisation
Next.js sur GitHub, et la plupart de ses commits sont de Lee Robinson. Il compte environ 16 250
étoiles. Son README liste :

- une page d'accueil et une page de tarifs qui ouvre Stripe Checkout ;
- la connexion par e-mail et mot de passe, avec des JWT en cookies ;
- un tableau de bord avec équipes et rôles propriétaire et membre ;
- la gestion de l'abonnement dans le Customer Portal de Stripe ;
- un journal d'activité des utilisateurs.

La stack : Next.js, Postgres avec Drizzle, et shadcn/ui. On le lit en entier en un après-midi, et
c'est le but.

## Que lui manque-t-il ?

Il n'envoie pas d'e-mail. Son `package.json` n'a aucune bibliothèque d'e-mail, et inviter un
membre enregistre l'invitation sans rien envoyer ; le code le dit :
[`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454).
Pas de réinitialisation du mot de passe ni de vérification d'adresse non plus.

La connexion se fait uniquement par e-mail et mot de passe : ni Google, ni GitHub, ni passkeys, ni
second facteur.

La facturation, c'est un abonnement par équipe. Checkout démarre avec une quantité de un et 14
jours d'essai, et la quantité ne change que si quelqu'un la modifie dans le Customer Portal
([stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)). Ajouter un
membre ne change pas la facture.

Et il évolue lentement. Ses deux derniers commits, les 8 et 11 décembre 2025, étaient des mises à
jour de sécurité de Next.js ; le second l'a passé à Next.js `15.6.0-canary.59` pour corriger la
CVE-2025-55182. Le précédent date de juin 2025.

Rien de tout cela n'est un défaut pour ce que le starter prétend être. Cela veut juste dire que ce
dont une équipe qui paie a besoin en premier reste à écrire.

## Les alternatives côte à côte

| Fonctionnalité      | Next.js SaaS Starter   | Seed                             | Open SaaS                    | Makerkit                                   | Supastarter                           |
| ------------------- | ---------------------- | -------------------------------- | ---------------------------- | ------------------------------------------ | ------------------------------------- |
| Prix                | Gratuit                | Gratuit                          | Gratuit                      | 299 $ ou 599 $, une fois                   | De 349 $ à 1 499 $, une fois          |
| Licence             | MIT                    | MIT                              | MIT                          | Payante ; le kit Lite est sous MIT         | Payante                               |
| Stack               | Next.js, Drizzle       | Hono, Preact ; Postgres          | Wasp (React, Node.js)        | Next.js 16 ou TanStack Start, entre autres | Next.js, Nuxt ou TanStack Start       |
| Équipes et rôles    | Propriétaire et membre | De lecteur à propriétaire        | Non                          | Oui, avec invitations                      | Oui, avec invitations                 |
| E-mail d'invitation | Non envoyé             | Oui                              | Pas d'équipes                | Non vérifié                                | Non vérifié                           |
| Facturation         | Stripe, une par équipe | Stripe, par membre               | Stripe, Polar, Lemon Squeezy | Non vérifié                                | Stripe, Lemon Squeezy et trois autres |
| Hébergement         | Vercel                 | Docker Compose sur votre serveur | Fly.io ou Railway            | Non vérifié                                | Vercel, serverless ou Docker          |

Sources : [Next.js SaaS Starter](https://github.com/nextjs/saas-starter),
[Open SaaS](https://github.com/wasp-lang/open-saas),
[tarifs de Makerkit](https://makerkit.dev/pricing), [Supastarter](https://supastarter.dev/) et le
[README de Seed](https://github.com/spy4x/seed). Les prix de Makerkit sont ses prix remisés ; les
prix catalogue sont 349 $ et 649 $. « Non vérifié » signifie que je ne l'ai pas trouvé sur les
pages lues, pas qu'il manque.

## Quelle alternative choisir ?

**Vous voulez rester sur Next.js avec plus de briques prêtes.** Payez Makerkit ou Supastarter. Les
deux ont des organisations avec invitations et rôles ; Supastarter facture au siège et propose
cinq fournisseurs de paiement. Makerkit Lite est gratuit et sous MIT, mais sans équipes ni
facturation.

**Vous le voulez gratuit, avec les équipes déjà faites.** C'est Seed. Chaque compte a un groupe,
avec des rôles de lecteur à propriétaire ; les invitations partent par e-mail ; Stripe facture par
membre et la quantité suit le nombre de membres, avec un plan gratuit, 14 jours d'essai et un délai
de grâce après un paiement échoué. La connexion est prête aussi : mot de passe avec code de
confirmation, passkeys, Google, GitHub, codes par e-mail, comptes invités et une app
d'authentification comme second facteur ([la connexion dans Seed](/fr/features/sign-in)). Ajoutez
une app d'administration avec journal d'audit, le temps réel, une app hors ligne et neuf langues.
Le prix : ce n'est pas Next.js, mais Hono et Preact.

**Vous vendez à des particuliers et aimez qu'un framework fasse la liaison.** Regardez Open SaaS ;
j'ai aussi écrit sur [ses alternatives](/fr/blog/alternatives-a-open-saas).

## Combien coûte l'hébergement : Vercel ou un serveur ?

Le README du starter déploie sur Vercel et accepte n'importe quelle URL Postgres. Seed tourne sur
un serveur que vous louez. Voici les deux, avec Vercel Pro et Supabase Pro comme duo géré courant ;
choisissez un serveur et réglez le curseur selon votre équipe :

<HostingCost server="cx23" developers={1} />

Avec un développeur, Seed sur un Hetzner CX23 coûte 12,48 € par mois et le duo géré 45 $, environ
40,12 € au taux de la BCE du 2 novembre 2026. Ce n'est pas du un pour un : le duo géré vous évite
de mettre un serveur à jour, et quelqu'un d'autre sauvegarde la base. Le calcul complet, avec
chaque prix et sa source, est dans
[déployer un SaaS sur un seul serveur Hetzner](/blog/deploy-saas-to-one-hetzner-server) (en
anglais).

## Quand le Next.js SaaS Starter reste-t-il le meilleur choix ?

- Vous voulez apprendre l'App Router et les Server Actions sur un code qu'on lit en entier.
- Vous écrirez la connexion et la facturation à votre façon, et voulez supprimer le moins possible.
- Votre équipe connaît Next.js et React, et vous déployez sur Vercel.

Les risques de Seed, pour peser : il est jeune, avec un seul mainteneur. Son API et son worker
tournent aussi sur Node ou Bun avec une ligne dans le fichier env
([à propos du runtime](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), mais le
site et l'outillage ont encore besoin de Deno.

## Comment essayer Seed avant de décider ?

Ouvrez la [démo en ligne](https://app.seedsaas.com) : un clic vous connecte à un compte invité avec
des données d'exemple. Invitez un collègue et ouvrez la facturation, exactement ce que le starter
Next.js vous laisse. Si ça vous va, clonez [le dépôt](https://github.com/spy4x/seed). Pour une vue
plus large, [alternatives à ShipFast](/fr/blog/alternatives-a-shipfast) compare sept starters dans
un tableau.
