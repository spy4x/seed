---
slug: reconstruire-financy-sur-seed-partie-1
language: fr
translationOf: rebuilding-financy-on-seed-part-1
title: "Reconstruire Financy sur Seed, partie 1 : un vrai produit sur un SaaS starter"
seoTitle: "Reconstruire Financy sur Seed : un vrai produit"
description: "Je reconstruis Financy, mon outil open source de suivi des finances, sur Seed. Partie 1 : pourquoi repartir de zéro, comment la copie est née et comment s'est passée la première synchronisation."
tldr:
  - "Financy, mon outil open source de suivi des finances, repart de zéro comme copie de Seed. L'ancienne version est figée dans une branche, comme référence de ce qu'elle faisait."
  - "Son premier commit, ce sont les fichiers de Seed plus 19 fichiers à lui : licence, README, règles pour les agents, documents produit et les deux fichiers .seed."
  - "La première synchronisation, un jour après la copie et après un changement d'identité visuelle, a apporté 19 commits de Seed et 616 fichiers, sans aucun conflit."
  - "Aucune fonction financière n'existe encore. Ce dont tout produit aurait besoin se fait d'abord dans Seed, et Financy le récupère par une synchronisation."
topic: Construire en public
intro: "Je reconstruis Financy, mon outil open source de suivi des finances pour une personne ou une famille, sur Seed, et je le raconte au fil de l'eau. Partie 1 : pourquoi j'ai jeté l'ancien code, comment un produit naît de Seed et à quoi a ressemblé la première synchronisation."
coverAlt: "Une jeune plante violette passe d'un pot gris fendu à un pot violet neuf, arrosée par une grande plante violette à côté."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-09T09:00:00Z
newsletter: true
devto: false
---

Peut-on construire un vrai produit sur un SaaS starter et continuer à recevoir ses mises à jour ?
C'est exactement ce que je fais en ce moment avec [Financy](https://github.com/spy4x/financy), mon
outil gratuit et open source (AGPL-3.0) de suivi des finances pour une personne ou une famille.
Financy est reparti comme copie de Seed le 3 novembre 2026 et, le 4 novembre, il a reçu son premier
lot de changements de Seed : 19 commits, 616 fichiers, aucun conflit. Cette série suit la
reconstruction au moment où elle se fait.

Elle s'adresse aux développeurs qui choisissent un SaaS starter et veulent en voir un servir à autre
chose qu'une démo, et à tous ceux que Financy intrigue. Tout est public : chaque chiffre vient des
deux dépôts sur GitHub, et vous pouvez tous les recompter avec git.

## Pourquoi reconstruire Financy plutôt que le réparer ?

Le premier Financy est né en avril 2025 et a atteint 157 commits. Il gérait des comptes dans
plusieurs devises, convertissait entre elles et avait des tests de bout en bout. Il avait aussi du
code auquel je ne fais plus confiance : une bonne partie a été écrite vite, avec les modèles d'IA de
l'époque, et sa structure, sa gestion d'état et sa synchronisation auraient de toute façon dû changer
pour devenir le produit que je veux.

L'autre moitié de la réponse, c'est ce qui manquait à Financy. Un outil de finances pour un foyer a
besoin d'une connexion avec double authentification, de groupes avec des rôles, de mises à jour en
direct sur chaque appareil, d'une app qui marche hors ligne, d'un panneau d'administration et d'un
site public. C'est la plomberie de n'importe quel SaaS, pas de la finance, et je venais de passer
octobre à en construire l'essentiel dans Seed ([ce qui est arrivé en octobre](/blog/whats-new-in-seed-october-2026),
en anglais). La réécrire dans Financy serait précisément l'erreur que Seed existe pour éviter.

L'ancien Financy est donc figé dans sa branche
[`legacy`](https://github.com/spy4x/financy/tree/legacy). Il sert de référence pour **ce que** fait
Financy (ses fonctions, ses règles d'argent, ses cas limites) et jamais pour **comment** : pas une
seule fonction utilitaire n'est reprise. Une règle d'argent tirée de là est une hypothèse : elle
devient d'abord un test, puis du code neuf.

## Comment Financy est-il parti de Seed ?

Avec une seule pull request, [financy#83](https://github.com/spy4x/financy/pull/83) : les fichiers
de Seed, plus les 19 qui font de la copie Financy. Je les ai comptés en comparant le premier commit
de Financy avec le commit de Seed qu'il enregistre :

```sh
git fetch https://github.com/spy4x/seed main
git diff --stat "$(git show 3d267c6f:.seed/commit)" 3d267c6f
```

Ces 19 fichiers sont : la licence AGPL-3.0, avec la mention MIT de Seed dans un fichier à part ; un
README qui dit franchement que l'app n'est pas prête ; le `AGENTS.md` de Financy, les règles que
suivent chaque agent et chaque personne qui y travaille ; les documents produit ; le nom d'image du
pipeline de release, pour qu'un tag de Financy n'écrase jamais les images de Seed ; la suppression
des quatre fichiers chiffrés de réglages serveur de Seed ; et les deux fichiers qui rendent la
synchronisation possible.

Ces deux-là sont tout le secret. `.seed/commit` contient le commit de Seed auquel la copie
correspond, et `.seed/skip` liste les chemins de Seed dont Financy ne prend jamais les changements,
comme son README. Une synchronisation est alors un `git diff` de ce commit jusqu'au `main` actuel de
Seed, appliqué avec une fusion à trois voies. La recette complète se trouve dans
[Start a product from Seed and keep getting its updates](/blog/start-a-product-from-seed-and-keep-its-updates)
(en anglais) ; ce billet raconte ce qui s'est passé quand je l'ai suivie pour de vrai.

## La première synchronisation a-t-elle vraiment marché ?

Oui, avec un petit piège tendu exprès. Avant la synchronisation, Financy avait déjà modifié des
fichiers de Seed : [financy#123](https://github.com/spy4x/financy/pull/123) lui a donné son nom, une
icône de portefeuille et son propre bleu à la place du violet de Seed, dans 32 fichiers. Une
synchronisation qui ne marche que sur une copie intacte ne prouverait rien.

Ensuite, [financy#127](https://github.com/spy4x/financy/pull/127) a fait passer Seed de `ec61062b`
à `d9641f03`. Cela fait 19 pull requests de Seed et 616 fichiers modifiés, et `git apply --3way` les
a appliqués sans conflit. Parmi ce qui est arrivé :

- la connexion par un code envoyé par e-mail ;
- un prix annuel à côté du prix mensuel ;
- un fuseau horaire pour tout le groupe ;
- l'API et le worker qui tournent sur Node et Bun en plus de Deno ;
- un réglage pour choisir où commence le changelog d'un produit.

La synchronisation a aussi montré une étape que le produit fait à la main. Seed venait d'ajouter
`AGENTS.seed.md`, les règles du dépôt de Seed lui-même ; Financy l'a supprimé et l'a ajouté à
`.seed/skip`, pour qu'aucune synchronisation ultérieure ne le ramène. Après la synchronisation,
Financy diffère de Seed sur 59 fichiers, et chacun est un fichier que Financy a modifié exprès.

## Qu'est-ce qui va dans Seed plutôt que dans Financy ?

Tout ce dont n'importe quel SaaS aurait besoin. Le `AGENTS.md` de Financy fixe l'ordre : le code
qu'un projet quelconque pourrait utiliser va dans les bibliothèques partagées `@spy4x/*`, celui dont
tout produit bâti sur Seed aurait besoin va dans Seed, et seul ce qu'il faut à un produit de finances
(comptes, transactions, budgets, taux de change) reste dans Financy. Pas de rustine locale « à
déplacer plus tard » : « plus tard », c'est comme ça qu'un fork s'éloigne.

Trois éléments de la liste ci-dessus sont exactement ça. Financy a besoin d'une facturation
annuelle, le mois d'un foyer a besoin d'un seul fuseau horaire pour tous ses membres, et son
changelog ne doit pas commencer par des années de commits de l'ancienne app. Rien de tout ça ne
concerne l'argent, donc chacun a été construit dans Seed et est arrivé dans Financy par la
synchronisation. Les 3 et 4 novembre, 31 nouvelles issues de Seed ont cité Financy, et au 5 novembre 8
étaient déjà fermées.

La reconstruction a aussi trouvé des trous dans ma propre recette. La liste de ce qu'un produit
retire du site de Seed oubliait plusieurs fichiers, et l'étape 1 enregistrait le commit le plus
récent de Seed, qui peut être plus récent que la copie : la première synchronisation aurait alors
sauté en silence les commits intermédiaires. Les deux sont corrigés dans Seed
([seed#811](https://github.com/spy4x/seed/pull/811)), et le [guide](/fr/docs/products) explique
désormais comment trouver le commit dont les fichiers correspondent aux vôtres. Cette correction vous
sert plus qu'à moi : le prochain produit bâti sur Seed ne tombera pas dans le piège.

## Qu'est-ce qui n'est pas encore fait ?

Presque tout. Au moment où j'écris, Financy, c'est Seed avec le nom, la licence et la couleur de
Financy. Aucun écran de comptes, de transactions ou de budgets n'existe encore, alors ne l'utilisez
pas tout de suite. Même le nom n'est pas arrêté :
[financy#126](https://github.com/spy4x/financy/issues/126) demande s'il faut le garder avant le
lancement.

Le plan est public : [les issues de Financy](https://github.com/spy4x/financy/issues), regroupées en
sept jalons, des fondations jusqu'au lancement et au-delà. Chaque manque qu'elles rencontrent dans
Seed se corrige dans Seed, donc cette série montrera les deux côtés : ce dont Financy a eu besoin et
ce que Seed en a appris.

## Suivez la suite

[Suivez le dépôt de Financy](https://github.com/spy4x/financy) (bouton Watch) pour voir arriver
chaque pull request, et abonnez-vous à ce blog pour recevoir la partie 2 par e-mail. Si vous êtes sur
le point de lancer votre propre produit, [le guide](/fr/docs/products) est celui que suit Financy,
et si une étape échoue chez vous, [ouvrez une issue](https://github.com/spy4x/seed/issues) : c'est
qu'il manque une ligne à la recette.
