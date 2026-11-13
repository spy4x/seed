---
slug: seed-tourne-sur-deno-node-et-bun
language: fr
translationOf: seed-runs-on-deno-node-and-bun
title: "Seed tourne désormais sur Deno, Node et Bun"
seoTitle: "Boilerplate SaaS pour Node.js, Bun et Deno : Seed tourne sur les 3"
description: "Le boilerplate SaaS gratuit Seed tourne sans modification sur Deno, Node.js et Bun : démarrer sur votre runtime, migrer un produit, ce qui demande encore Deno."
tldr:
  - L'API, le worker, la migration et le site de Seed démarrent sans modification sur Deno, Node et Bun, et la CI les teste sur les trois à chaque pull request.
  - "Une ligne du fichier env, APP_RUNTIME=node ou bun, change le runtime de vos serveurs. Sans elle, Deno reste : un produit qui ne touche à rien continue de tourner."
  - Le site public a quitté Fresh pour une petite couche aux mêmes routes, pages et îlots. Chaque page charge moins de JavaScript.
  - Les tâches et les tests restent sur Deno ; npm ou Bun l'installent pour vous.
topic: Nouveautés
intro: "Seed ne dépend plus d'un seul runtime. Ses serveurs démarrent sans modification sur Deno, Node et Bun, et une ligne du fichier env choisit lequel. Voici ce que cela change pour un nouveau produit, et quoi faire dans celui qui tourne déjà."
coverAlt: "Une pousse violette dans un pot au sommet d'une colline, vers laquelle montent trois chemins : en pas japonais, en planches de bois et en gravier."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-14T09:00:00Z
newsletter: true
---

Seed, le boilerplate SaaS gratuit, tourne désormais sur Deno, Node.js et Bun. L'API, le worker en
arrière-plan, la migration de la base et le site public démarrent sur chacun sans changer une ligne
de code, et la CI lance l'API, le worker et le site sur les trois à chaque pull request. Une ligne du
fichier env choisit le runtime des serveurs de votre produit ; sans elle, tout reste sur Deno.

Ce billet s'adresse à deux personnes : celle qui choisit un starter et ne veut pas lier son produit à
un seul runtime, et celle qui fait déjà tourner un produit sur Seed et va recevoir ce changement à la
prochaine synchronisation. Chaque section répond à une chose que vous voulez faire. Le récit de la
migration, erreurs comprises, est
[sur mon blog](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun) (en anglais).

## Comment démarrer un nouveau produit sur mon runtime ?

Le démarrage rapide du README a maintenant une section par runtime :
[Node](https://github.com/spy4x/seed#node), [Bun](https://github.com/spy4x/seed#bun) et
[Deno](https://github.com/spy4x/seed#deno). Il vous faut Docker et l'un des trois. Avec Node :

```sh
npm install -g deno
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
npm run init
npm run dev
```

Oui, la première ligne installe Deno. Quitter Deno en installant Deno, c'est plus drôle que je ne
le voudrais, mais les tâches de Seed tournent encore dessus (j'y reviens plus bas), et le paquet
`deno` sur npm fait qu'une machine avec seulement Node n'a besoin de rien d'autre. Avec Bun, la
première ligne devient `bun add -g deno`, et les deux dernières `bun run init` et `bun run dev`. La
ligne `gh` est facultative : le bouton « Use this template » de GitHub suivi d'un clone fait la même
chose.

Vous avez alors toute la stack dans Docker, sur Deno. Pour que les serveurs du produit tournent eux
aussi sur Node ou Bun, ajoutez une ligne dans `infra/envs/.env` avant `dev` :

```sh
APP_RUNTIME=node   # ou bun ; deno, vide ou pas de ligne garde Deno
```

## Qu'est-ce qui tourne sur Node ou Bun, et qu'est-ce qui change ?

Avec `APP_RUNTIME=node` ou `bun`, l'API, le worker, la migration et le site tournent sur Node 26 ou
Bun 1.4, chacun depuis sa propre image Docker. Les ports, les variables d'environnement et l'ordre
des services ne changent pas. La SPA et le panneau d'administration sont des fichiers statiques : peu
leur importe. Le détail complet est dans [la section runtime de la doc](/fr/docs/apps#runtime).

Trois différences avec Deno, à connaître avant de basculer :

- **Pas de mode watch.** Le code est empaqueté dans l'image, donc sur Node ou Bun une modification
  n'apparaît qu'après une reconstruction, en développement aussi. Le développement avec rechargement
  à chaud reste sur Deno.
- **Pas de permissions runtime pour le worker.** Sous Deno, le worker ne peut lire et écrire que son
  dossier d'images et ne peut lancer que `vips`. Node et Bun n'ont pas ces limites : le worker n'y est
  confiné que par son conteneur et son utilisateur non root.
- **C'est vous qui choisissez.** Sans la ligne, avec une ligne vide ou avec `deno`, tout reste sur
  Deno.

## J'ai déjà un produit sur Seed. Que dois-je faire ?

Récupérez le changement comme d'habitude, selon [le guide des produits](/fr/docs/products) :
récupérez Seed, appliquez le patch et notez le commit :

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

Lancez ensuite `deno task check` avant d'ouvrir la pull request. J'ai essayé cette synchronisation
sur une copie de Seed datant de juste avant le changement de runtime, et le patch est passé sans
aucun conflit. Votre produit peut en avoir là où vous avez modifié des fichiers de Seed exprès :
gardez alors votre version, comme le dit le guide.

La synchronisation ajoute les images Docker pour Node et Bun, les fichiers Compose qui basculent
dessus et un `package.json` à la racine. Elle ne change pas votre runtime. Quand vous voulez
basculer, mettez `APP_RUNTIME=node` (ou `bun`) dans `infra/envs/.env` et reconstruisez les images :

```sh
deno task compose up -d --build
```

Sur le serveur, mettez la même ligne dans son fichier env et déployez comme d'habitude
([mises à jour](/fr/docs/deploy-updates)) : chaque déploiement construit les images que cette ligne
désigne.

## Qu'est-ce qui a changé sur le site public ?

Le site ne tourne plus sur Fresh. Il utilise maintenant
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server), une petite couche open source qui
reprend les routes, les pages et les îlots de Fresh 2 ; le code du site a donc à peine bougé. J'ai
comparé toutes les routes sur les deux builds : 419 réponses sur 423 étaient identiques. Les quatre
qui diffèrent sont la date de modification et l'ETag d'une vidéo, et une adresse malformée qui
recevait une erreur brute et reçoit maintenant la page 404 du site.

Les pages se sont aussi allégées. JavaScript par page après gzip, mesuré avec Lighthouse en mobile :

| Page                     | Nouvelle couche | Fresh   |
| ------------------------ | --------------- | ------- |
| Accueil                  | 24.0 KB         | 32.1 KB |
| Billet de blog avec îlot | 29.9 KB         | 38.0 KB |
| Documentation            | 8.6 KB          | 19.4 KB |

Sur le billet avec un curseur interactif, la page bloque la saisie pendant 5 ms, contre 48 ms avec
Fresh. Ma première version de la couche était justement plus lente que Fresh à cet endroit, et la CI
ne l'a pas vu ; comment je l'ai trouvé est raconté dans
[l'histoire complète](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun).

Si vous avez modifié le site de votre produit, il peut rester après la synchronisation des fichiers
qui importent encore Fresh. Trouvez-les depuis la racine du dépôt :

```sh
grep -rlE 'from "fresh' apps/mpa
```

Faites pointer chaque import vers `@spy4x/preact-server` (`fresh/runtime` compris) et renommez
`FreshContext` en `Context`. Le dossier de build s'appelle maintenant `dist`, plus `_fresh`. Les
pages n'ont plus de script en ligne, donc les en-têtes de sécurité n'ont plus besoin d'un nonce par
requête. La couche est une première version : ce qu'elle offre et ce qu'elle laisse de côté est
dans [sa documentation](https://github.com/spy4x/seed/blob/main/docs/website-server.md).

## Qu'est-ce qui a encore besoin de Deno ?

L'outillage : formatage, linter, vérification des types, tests et les scripts derrière
`deno task`. Le `package.json` à la racine transmet les tâches courantes à Deno, donc `npm run test`
et `bun run dev` fonctionnent aussi. Les tests restent sur le test runner de Deno. Une révision
prévue le 10 janvier 2027 décidera si cela change
([la politique des runtimes](https://github.com/spy4x/seed/blob/main/docs/runtime-policy.md)). Rien
de tout cela n'attache à Deno le runtime que vos utilisateurs atteignent.

## Pourquoi Seed ne dépend-il plus de Deno ?

Le 9 octobre 2026, l'équipe de Deno a [annoncé](https://deno.com/blog/cloudflare) une année de plus
de correctifs de bugs et de sécurité, après quoi elle arrête son propre développement. Deno reste
open source, et je l'apprécie toujours. Mais un starter sur lequel on bâtit une entreprise ne devrait
pas parier votre produit sur la feuille de route d'un seul runtime, la mienne comprise. Seed était
déjà construit sur les standards du web (Fetch, Web Crypto, WebSocket, modules ES) : le plus dur a
été de servir les fichiers, les types de Deno dans les signatures publiques et la couche du site, pas
une réécriture.

Essayez le [démarrage rapide](https://github.com/spy4x/seed#quick-start) sur le runtime que vous
utilisez déjà. Si une étape échoue, [ouvrez une issue](https://github.com/spy4x/seed/issues) avec ce
que vous avez lancé, et je corrige.
