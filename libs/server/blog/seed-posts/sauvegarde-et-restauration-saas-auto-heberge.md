---
slug: sauvegarde-et-restauration-saas-auto-heberge
language: fr
translationOf: self-hosted-saas-backup-and-restore
title: "Sauvegarder un SaaS auto-hébergé, et prouver que la restauration fonctionne"
seoTitle: "Sauvegarde d'un SaaS auto-hébergé : Postgres, fichiers, restauration"
description: Comment sauvegarder un SaaS auto-hébergé (base, fichiers, clés) hors du serveur, et prouver la restauration avant d'en avoir besoin.
tldr:
  - Sauvegardez la base, les fichiers envoyés et chaque clé qui n'existe que sur le serveur, dans un bucket chez un autre fournisseur.
  - Seule une restauration prouve une sauvegarde. Répétez-en une dans une base de secours ; dans Seed, c'est quatre commandes.
  - Seed enregistre chaque jour un pg_dump, les fichiers et les clés des notifications push avec restic, et prévient quand la dernière sauvegarde a deux jours.
  - Pas de restauration à un instant donné, donc jusqu'à une journée d'écritures peut être perdue, et il ne relit pas lui-même les données stockées.
topic: Guides
intro: "Un SaaS sur son propre serveur coûte peu, jusqu'au jour où le disque meurt. Voici quoi sauvegarder, où le ranger et comment prouver que la restauration marche, avec la sauvegarde fournie par Seed comme exemple."
relatedFeature: deploy
coverAlt: "Une plante violette pousse d'une tour de serveur sur un petit îlot et, sur un second îlot de l'autre côté de l'eau, un bocal en verre fermé garde une bouture de la même plante à côté d'un pot où on la replante."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-08T09:00:00Z
newsletter: true
devto: false
---

Pour sauvegarder un SaaS auto-hébergé, enregistrez chaque jour trois choses dans un stockage chez un
autre fournisseur : un dump de la base de données, les fichiers que vos utilisateurs ont envoyés et
chaque clé qui n'existe que sur le serveur. Chiffrez la sauvegarde, gardez son mot de passe ailleurs
que sur le serveur et faites-vous prévenir quand une exécution échoue. Vient ensuite l'étape que
presque tout le monde saute : restaurez une sauvegarde dans une base de secours et vérifiez que les
tables sont là. Tant que vous ne l'avez pas fait, vous avez un dossier rempli d'espoir.

Un seul serveur à prix fixe, c'est toute l'idée de Seed, et ce qui retient les gens d'héberger
eux-mêmes, c'est la peur de perdre leurs données. Ce billet présente donc la sauvegarde fournie par
Seed : ce qu'elle enregistre, comment répéter la restauration et, tout aussi franchement, ce qu'elle
ne fait pas. Les commandes viennent du [guide des sauvegardes](/fr/docs/backups) et du
[guide de restauration](/fr/docs/restore).

## Que doit sauvegarder un SaaS auto-hébergé ?

Tout ce que vous ne pouvez pas reconstruire depuis git. Voici la liste de Seed, tirée de
[docs/backups.md](/fr/docs/backups) :

| Quoi                                          | Sauvegardé ? | Pourquoi                                                                               |
| --------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| La base Postgres, en `pg_dump`                | Oui          | Les comptes, les groupes, tout ce que les utilisateurs ont créé.                       |
| Les fichiers envoyés (Garage intégré)         | Oui          | Ses blocs de données et les deux copies horaires les plus récentes de ses métadonnées. |
| Les clés des notifications push, `vapid.json` | Oui          | Elles n'existent que sur le serveur ; sans elles, plus de push.                        |
| Valkey                                        | Non          | C'est un cache, il se remplit tout seul.                                               |
| Le fichier d'environnement de production      | Non          | Il contient les clés de la sauvegarde elle-même. Gardez-en une copie ailleurs.         |
| Les fichiers sur un autre stockage S3         | Non          | Les sauvegardes de ce stockage s'en chargent.                                          |

Le fichier d'environnement est le plus souvent oublié. Il contient la clé du stockage de fichiers et
le mot de passe de la sauvegarde ; une sauvegarde qui l'inclurait livrerait les deux à quiconque la
lit. Rangez-le dans votre gestionnaire de mots de passe ou chiffré dans git, mais pas seulement sur
le serveur.

## Où ranger les sauvegardes ?

Pas sur le même serveur, et de préférence pas chez le même fournisseur. Une sauvegarde sur le disque
mort n'en est pas une, et une sauvegarde dans le même compte disparaît avec un compte bloqué. La
sauvegarde de Seed écrit dans n'importe quel bucket compatible S3. Le
[billet sur le déploiement](/blog/deploy-saas-to-one-hetzner-server) compte avec Hetzner Object
Storage, qui est hors du serveur ; un bucket chez un second fournisseur survit en plus à un souci
avec le premier.

Trois réglages comptent davantage que le fournisseur :

1. **Une clé pour ce seul bucket**, autorisée à lire, écrire et supprimer là et nulle part ailleurs.
2. **Le versionnage ou l'object lock sur le bucket**, si le fournisseur le propose. La clé est sur
   le serveur ; sans cela, celui qui prend le serveur peut aussi effacer les sauvegardes. C'est ce
   réglage qui transforme « on m'a effacé mon serveur » en mauvais après-midi plutôt qu'en
   entreprise fermée.
3. **Le mot de passe du dépôt hors du serveur.** Sans lui, aucun snapshot ne se lit, ni par un
   attaquant ni par vous.

## Comment Seed fait-il la sauvegarde ?

Avec `backup` dans `COMPOSE_PROFILES`, un conteneur `backup` tourne une fois au démarrage puis toutes
les 24 heures
([infra/backup/backup.sh](https://github.com/spy4x/seed/blob/main/infra/backup/backup.sh)). Il
enregistre dans un dépôt [restic](https://restic.net), qui chiffre chaque snapshot et ne transfère
que ce qui a changé depuis le précédent.

Quelques choix dans ce script font la différence entre une sauvegarde et un fichier qui y ressemble :

- **restic lance `pg_dump` lui-même** et n'enregistre rien si `pg_dump` échoue : un dump coupé en
  route ne devient jamais un snapshot. `pg_dump` produit un export cohérent pendant que l'application
  continue de lire et d'écrire, et ne bloque pas les autres utilisateurs
  ([documentation de Postgres](https://www.postgresql.org/docs/current/app-pgdump.html)) ;
  l'application reste donc en ligne.
- **Le dump utilise la version de Postgres du serveur.** L'image de sauvegarde est construite sur
  celle de la base
  ([infra/backup/Dockerfile](https://github.com/spy4x/seed/blob/main/infra/backup/Dockerfile)) :
  `pg_dump` et `pg_restore` ne sont jamais en retard sur le serveur.
- **Le dump n'est pas compressé.** restic compresse lui-même et ne repère ce qui n'a pas changé que
  dans des données brutes ; le dump quotidien d'une base qui bouge peu reste donc petit.
- **Les vieux snapshots sont éclaircis.** Tous ceux des deux derniers jours restent, puis un par jour
  pendant une semaine, un par semaine pendant un mois et un par mois pendant six mois
  ([`forget` de restic](https://restic.readthedocs.io/en/stable/060_forget.html)).
- **Une exécution interrompue fait le ménage.** Un redémarrage ou l'OOM killer peuvent laisser un
  verrou de restic ; chaque exécution retire d'abord les verrous périmés, et celle qui tombe sur un
  verrou actif réessaie une heure plus tard.

L'activer, c'est le profil `backup` et quatre variables dans le fichier d'environnement, puis un déploiement. Le profil est
éteint tant que vous ne l'avez pas configuré : un nouveau produit n'a donc pas de sauvegarde avant.

## Comment savoir que la sauvegarde tourne toujours ?

Une sauvegarde arrêtée en mars se découvre en juin, le jour où on en a besoin. Seed le signale de
trois façons :

- `docker ps` affiche le conteneur de sauvegarde comme unhealthy quand la dernière sauvegarde
  complète date de plus de deux jours.
- L'alerte `BackupMissing`
  ([infra/configs/alerts.yml](https://github.com/spy4x/seed/blob/main/infra/configs/alerts.yml))
  envoie la même nouvelle à ntfy.
- La page System du panneau d'administration avertit quand la dernière sauvegarde a 26 heures et
  affiche une erreur à partir de 48
  ([libs/domain/identity/admin-system.ts](https://github.com/spy4x/seed/blob/main/libs/domain/identity/admin-system.ts)).

Le journal donne la cause : un mauvais mot de passe ou une mauvaise clé, un verrou ou un dépôt qui
ne répond pas.

## Comment prouver que la restauration fonctionne ?

En restaurant. Pas tout le serveur : un snapshot dans une base de secours, à côté de la vraie,
pendant que l'application tourne. Dans Seed, sur le serveur, dans le dossier de l'application
(`<db>` est votre `DB_NAME`) :

```sh
deno task compose exec db psql -d postgres -c 'CREATE DATABASE "<db>_restore_test"'
deno task compose run --rm backup restore
deno task compose run --rm -e PGDATABASE=<db>_restore_test backup restore <snapshot id>
deno task compose exec db psql -d <db>_restore_test -c '\dt'
```

La deuxième ligne liste les snapshots sans rien changer ; la troisième charge celui que vous nommez.
La liste des tables doit correspondre à celle de la vraie base. Supprimez ensuite la base de
secours. Cela prend quelques minutes, et ensuite « nous avons des sauvegardes » est un fait, plus
une impression.

Faites-le une fois après avoir activé la sauvegarde, puis après chaque grand changement : une
nouvelle version de Postgres, un nouveau bucket, un nouveau mot de passe.

Seed teste aussi le script lui-même. `deno task test:backup` et l'étape `backup-restore` de la CI,
sur chaque pull request, sauvegardent une base avec le vrai script, la restaurent dans une base vide
et comparent les lignes
([infra/backup/restore.test.sh](https://github.com/spy4x/seed/blob/main/infra/backup/restore.test.sh)).
Le même test tue une exécution en cours de route et vérifie que la suivante réussit, et garde
séparés deux projets qui partagent un dépôt. Cela prouve le script ; votre bucket, votre clé et
votre mot de passe, seule votre propre répétition les prouve.

## Comment restaurer pour de vrai ?

Lentement, et sans rien écraser. Toutes les commandes sont dans le
[guide de restauration](/fr/docs/restore) ; voici les idées derrière :

1. **Mettez la base abîmée de côté, n'écrivez jamais par-dessus.** Arrêtez l'application, renommez
   la base et créez-en une vide. La restauration refuse une base qui contient des tables, pour que
   deux états ne se mélangent jamais.
2. **Choisissez le snapshot par sa date.** Le plus récent n'est pas toujours le bon : un snapshot
   pris après les dégâts contient les dégâts. C'est pourquoi `restore` n'a pas de valeur par défaut
   et annonce le snapshot et son heure avant de charger quoi que ce soit.
3. **Chargez-le en une seule transaction.** Une restauration qui échoue à mi-chemin laisse une base
   vide, pas à moitié remplie (`pg_restore --single-transaction`,
   [documentation de Postgres](https://www.postgresql.org/docs/current/app-pgrestore.html)).
4. **Redémarrez le cache, puis l'application.** Les migrations plus récentes que le snapshot
   s'appliquent comme à chaque démarrage.
5. **Reprenez les fichiers de la même nuit** que la base.

Sur un nouveau serveur, laissez la sauvegarde éteinte jusqu'à la fin de la restauration. Sinon, le
nouveau serveur enregistre chaque jour sa base vide dans le même dépôt, et après sept exécutions le
nettoyage commence à supprimer les snapshots de l'ancien serveur. Je préfère que vous le lisiez ici
plutôt que de le découvrir vous-même.

## Que ne fait pas la sauvegarde de Seed ?

- **Pas de restauration à un instant donné.** C'est un dump par jour : une panne peut coûter jusqu'à
  une journée d'écritures. Seed n'archive pas le WAL ; si une heure de commandes perdues est de trop
  pour votre produit, il vous faut cela en plus.
- **Elle ne relit pas d'elle-même les données stockées.** `restic check` vérifie la structure du
  dépôt et `--read-data` lit chaque pack stocké
  ([documentation de restic](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)),
  mais le script ne lance ni l'un ni l'autre. Vous pouvez le faire à la main :
  `deno task compose run --rm backup restic check --read-data-subset=10%`.
- **Elle ne répète pas la restauration à votre place.** La CI teste le script, pas votre bucket.
- **Elle n'enregistre pas le fichier d'environnement**, exprès, et n'écrit pas via SSH : le dépôt
  doit être un bucket S3.
- **Elle est éteinte tant que vous ne l'allumez pas.**

C'est une sécurité honnête, de tous les jours, pour un serveur, pas celle d'une banque. Pour la
plupart des produits, c'est la bonne mesure : le trou dangereux est rarement l'heure perdue, c'est
la sauvegarde que personne n'a jamais restaurée.

## À vous

Si Seed tourne déjà chez vous, répétez une restauration aujourd'hui : quatre commandes, quelques
minutes. Si vous choisissez encore où héberger, commencez par
[installer Seed et le lancer en local](/blog/install-seed-and-run-it-locally), puis
[déployez-le sur un serveur Hetzner](/blog/deploy-saas-to-one-hetzner-server) et activez la
sauvegarde dans la foulée. Un point des guides n'est pas clair ?
[Ouvrez une issue](https://github.com/spy4x/seed/issues) et je le corrige.
