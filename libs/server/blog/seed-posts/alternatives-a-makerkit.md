---
slug: alternatives-a-makerkit
language: fr
translationOf: makerkit-alternatives
title: "Alternatives à Makerkit : boilerplates SaaS gratuits, et quand payer"
seoTitle: "Alternatives à Makerkit : boilerplates SaaS gratuits et open source"
description: "Makerkit coûte 299 dollars ou plus, et son kit Lite gratuit n'a ni facturation ni équipes. Les alternatives gratuites qui ont les deux, et quand Makerkit vaut son prix."
tldr:
  - Les kits payants de Makerkit coûtent 299 ou 599 dollars en une fois ; Lite, gratuit, n'a ni facturation, ni équipes, ni admin.
  - Un projet sur un kit payant ne peut pas être publié en open source, et un freelance doit acheter une licence par client.
  - Seed est gratuit et sous MIT, avec équipes, facturation par membre et appli d'admin, sur votre serveur.
  - Choisissez Makerkit pour Supabase, Next.js ou React Router et ses outils pour agents de code.
topic: Questions
intro: "Makerkit est un kit payant soigné avec une édition Lite gratuite, et l'écart entre les deux est exactement ce dont un produit pour équipes a besoin. Voici les alternatives gratuites qui le comblent, une source pour chaque fait, et les cas où payer Makerkit est le bon choix."
relatedFeature: deploy
coverAlt: "Une grande caisse à outils violette ouverte, ses plateaux pleins d'outils, à côté d'une petite caisse grise fermée par un cadenas."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

L'alternative gratuite à Makerkit qui garde ce qu'ajoutent ses kits payants, à savoir les équipes,
la facturation et un panneau d'administration, c'est Seed : un boilerplate sous licence MIT avec
groupes et rôles, facturation Stripe par membre et une application d'admin sur son propre domaine.
Le kit gratuit de Makerkit, Lite, laisse ces trois-là de côté. Pour une base gratuite plus petite,
il y a le Next.js SaaS Starter, et parmi les kits payants, Supastarter. Les kits payants de
Makerkit coûtent 299 ou 599 dollars, payés une fois.

Je développe Seed, lisez donc ceci en le sachant. Chaque fait sur un autre produit renvoie à sa
source, et j'ai lu chaque page le 4 novembre 2026. Quelque chose a changé ?
[Ouvrez une issue](https://github.com/spy4x/seed/issues), je corrigerai.

## Que propose Makerkit, et que manque-t-il à Lite ?

[Makerkit](https://makerkit.dev/) livre des kits sur trois couches de données (Supabase ; Drizzle
avec Better Auth ; Prisma avec Better Auth) pour Next.js 16, TanStack Start et, avec Supabase,
React Router 8. Sa page d'accueil liste la connexion par mot de passe, liens magiques, passkeys en
option, OAuth et application d'authentification ; des comptes d'équipe avec rôles et invitations ;
des abonnements Stripe forfaitaires, par siège ou à l'usage ; un super-admin qui peut se connecter
en tant qu'utilisateur ou le bannir ; les traductions ; un blog et une doc ; et des notifications
en temps réel dans les kits Supabase. Pour les agents de code, il fournit des règles, des skills et
un serveur MCP.

La [page des prix](https://makerkit.dev/pricing) affiche deux licences uniques, mises à jour à
vie :

- **Pro**, 349 dollars, 299 sur les cartes des kits : un développeur, projets illimités.
- **Teams**, 649 dollars, 599 sur les cartes : jusqu'à cinq personnes sur le dépôt.

## Freelance ou agence : ce que la licence change

Lisez les conditions avant d'acheter, car deux d'entre elles surprennent. Un freelance doit acheter
une licence distincte pour chaque client. Et un projet bâti sur un kit payant ne peut pas être
publié en open source : la page renvoie à Lite pour ça. Les remboursements ne sont en général pas
accordés une fois l'accès obtenu, d'où le conseil de la page d'essayer Lite d'abord.

Avec Seed, sous MIT, ces deux surprises n'existent pas : publiez votre produit en open source ou
bâtissez dix projets clients dessus, personne n'a besoin d'une seconde licence, et le client garde
un code qu'il peut confier à qui il veut. Je construis moi-même les MVP de mes clients sur Seed,
ce n'est donc pas de la théorie. Seed parle aussi français, de l'application aux e-mails.

[Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) est gratuit et sous MIT,
environ 470 étoiles sur GitHub : Next.js, connexion via Supabase, pages de profil, i18n et pages
marketing. Son README liste ce qu'il laisse de côté, et cette liste est le cœur d'un produit pour
équipes : facturation, comptes d'équipe, modèles d'e-mails, panneau super-admin, blog et doc.

## Makerkit et ses alternatives dans un tableau

| Boilerplate                                                               | Prix                                          | Licence                                | Stack                                   | Équipes et facturation            | Hébergement                                 |
| ------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------- | --------------------------------------- | --------------------------------- | ------------------------------------------- |
| [Makerkit](https://makerkit.dev/pricing)                                  | 299 ou 599 $ en une fois (catalogue 349, 649) | Payante, pas d'open source, par client | Next.js, React Router ou TanStack Start | Oui, par siège                    | Vercel recommandé ; Cloudflare, Docker, VPS |
| [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) | Gratuit                                       | MIT                                    | Next.js, Supabase                       | Non                               | Non mentionné                               |
| [Seed](https://github.com/spy4x/seed)                                     | Gratuit                                       | MIT                                    | Hono, Preact ; Postgres                 | Oui, par membre                   | Votre serveur, Docker Compose               |
| [Supastarter](https://supastarter.dev/)                                   | 349, 799 ou 1 499 $ en une fois               | Payante, pas de redistribution         | Next.js, Nuxt ou TanStack Start         | Oui, par siège                    | Vercel, Docker, Coolify et d'autres         |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)            | Gratuit                                       | MIT                                    | Next.js, Drizzle ; Postgres             | Owner et Member ; Stripe Checkout | Vercel                                      |

La ligne d'hébergement de Makerkit vient de sa
[checklist de mise en production](https://makerkit.dev/docs/next-supabase-turbo/going-to-production/checklist),
qui recommande Vercel et signale que Docker ou un VPS demandent « plus de configuration ». La
[page de comparaison](/fr/compare) aligne 19 fonctions de six boilerplates.

## Quelle alternative gratuite a ce qui manque à Makerkit Lite ?

**Seed** a les trois pièces manquantes. Chaque personne reçoit un groupe à l'inscription, avec des
rôles de lecteur à éditeur, admin et propriétaire. Stripe facture par membre, avec une offre
gratuite, 14 jours d'essai et un délai de grâce après un paiement échoué. Une application d'admin
sur son propre domaine retrouve une personne, rembourse un paiement et inscrit chaque action dans un
journal d'audit. Connexion par mot de passe, passkeys, codes envoyés par e-mail, Google et GitHub,
et une application d'authentification en second facteur. S'y ajoute ce qu'aucune page de Makerkit ne
mentionne : une application qui s'ouvre et met les écritures en file d'attente hors ligne, et une
supervision du serveur (VictoriaMetrics, Grafana) et des sauvegardes dans le fichier Compose.

**Le Next.js SaaS Starter**, environ 16 300 étoiles, se situe entre Lite et les kits payants :
équipes avec Owner et Member, Stripe Checkout et Customer Portal sur Next.js, Drizzle et Postgres,
sans panneau d'admin.

## Combien coûte l'hébergement en plus ?

La checklist de Makerkit recommande Vercel, et son kit principal tourne sur Supabase. Cette paire
se paie tous les mois, par siège de développeur et par base. Seed tourne sur un seul serveur que
vous louez. Choisissez un serveur et une taille d'équipe :

<HostingCost server="cx23" developers={1} />

Avec un développeur, Seed sur le CX23 coûte 12,48 € par mois, contre 45 dollars pour Vercel Pro et
Supabase Pro. La comparaison n'est pas à armes égales : la paire gérée met à jour, adapte et
sauvegarde pour vous. Comment mettre Seed sur un serveur : le [guide de déploiement](/fr/docs/deploy).

## Quand Makerkit vaut-il son prix ?

- **Vous voulez Supabase.** Le kit principal de Makerkit repose sur son authentification, son
  stockage et sa row-level security. Seed a son propre Postgres et sa propre connexion.
- **Vous voulez Next.js ou React Router.** Seed est en Preact partout, site public compris.
- **Il vous faut la connexion en tant qu'utilisateur, la facturation à l'usage ou un second
  prestataire de paiement.** Makerkit liste les deux premières, et sa page d'accueil cite Polar à
  côté de Stripe. Seed n'a aucun des trois ; Stripe est son seul prestataire.
- **Vous travaillez avec des agents de code.** Makerkit fournit un serveur MCP et des skills. Seed
  a des [instructions pour les agents](/fr/docs/ai-agents), mais pas de serveur MCP
  ([#211](https://github.com/spy4x/seed/issues/211)).
- **Vous voulez un mainteneur qui a de l'historique.** Makerkit dit être maintenu à plein temps
  depuis 2022. Seed est jeune et n'a qu'un mainteneur, moi.

## Comment essayer Seed avant de choisir ?

Ouvrez la [démo en ligne](https://app.seedsaas.com) : un clic ouvre un compte invité avec des
données d'exemple, et en deux minutes vous créez une équipe, invitez quelqu'un et ouvrez la
facturation. Puis clonez [le dépôt](https://github.com/spy4x/seed). Et si Makerkit vous va mieux,
commencez par Lite, comme le conseille sa propre page des prix. D'autres options :
[alternatives à Supastarter](/fr/blog/alternatives-a-supastarter).
