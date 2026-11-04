---
slug: saas-multi-locataire-groupes-roles-postgres
language: fr
translationOf: multi-tenant-saas-groups-roles-postgres
title: "SaaS multi-locataire : groupes, rôles et contrôle des droits dans Postgres"
seoTitle: "SaaS multi-locataire avec Postgres : groupes, rôles et droits"
description: "Comment Seed isole ses locataires dans une seule base Postgres : un id de groupe sur chaque ligne, quatre rôles fixes, le rôle vérifié dans chaque gestionnaire et relu sous verrou à chaque écriture."
tldr:
  - "Dans Seed, le locataire est un groupe. Chaque ligne porte un group_id, et l’accès d’une personne est une ligne de group_members avec un rôle de 1 à 4."
  - "Qui peut faire quoi est un ensemble de petites fonctions pures. Chaque gestionnaire lit le rôle et en appelle une ; le WebSocket et HTTP partagent les mêmes gestionnaires."
  - "Chaque écriture relit le rôle dans sa propre transaction, sous verrou : un membre retiré un instant plus tôt ne peut pas glisser une dernière écriture."
  - "Pas de row-level security. Un inconnu reçoit 404, jamais 403, et des tests vérifient qu’un groupe ne voit jamais les données d’un autre."
topic: En détail
intro: "Tout SaaS pour équipes répond à la même question à chaque requête : cette personne a-t-elle le droit de toucher cette ligne ? Voici comment Seed y répond dans une seule base Postgres, avec le vrai code, et le seul endroit où il échange de la sûreté contre de la simplicité."
coverAlt: "Une serre divisée en pièces de verre, chacune avec ses plantes et sa porte violette, une clé suspendue à côté de chaque porte."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

Comment construire un SaaS multi-locataire (multi-tenant) sur Postgres pour qu’une équipe ne voie
jamais les données d’une autre ? Dans Seed, le locataire est un **groupe**. Chaque ligne qui
appartient à un locataire porte un `group_id`, l’accès d’une personne est une ligne de
`group_members` avec un rôle, et chaque requête vérifie ce rôle dans le code avant de lire ou
d’écrire. Les écritures le vérifient deux fois : dans le gestionnaire, puis dans leur propre
transaction, sous verrou. Une base partagée, un schéma, pas de row-level security.

Cet article s’adresse aux développeurs d’un produit pour équipes qui veulent voir une réponse
complète qui fonctionne, pas un schéma au tableau. Tout est dans le
[code de Seed](https://github.com/spy4x/seed), sous licence MIT, et les extraits sont les vraies
lignes, un peu raccourcies.

## Qu’est-ce qu’un locataire dans Seed ?

Un groupe. Il n’existe pas de type « personnel » à part : l’inscription crée un groupe ordinaire
nommé « Personal », dont vous êtes le seul membre. Un utilisateur seul et une équipe de 50 passent
donc par le même code, et rien n’est à migrer quand quelqu’un invite un collègue. Une personne peut
appartenir à autant de groupes qu’elle veut.

L’appartenance tient dans une table
([la migration](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)) :

```sql
CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INT2 NOT NULL,
    ...
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role_check CHECK (role BETWEEN 1 AND 4)
);
```

Postgres tient lui-même deux règles : un rôle va de 1 à 4, et un index unique partiel autorise
exactement un propriétaire par groupe. Un transfert de propriété rétrograde l’ancien propriétaire
avant de promouvoir le nouveau, dans une transaction, car cet index refuse deux propriétaires même
un instant. Chaque ligne d’une fonctionnalité (une note, une étiquette, un fichier) a sa propre
colonne `group_id`.

## Quels rôles existent, et que peut faire chacun ?

Quatre, fixes et ordonnés : viewer (1), editor (2), admin (3), owner (4). Grâce à l’ordre, presque
chaque règle est une comparaison : « editor ou plus » s’écrit `role >= 2`.

| Quoi                                           | Viewer | Editor | Admin | Owner |
| ---------------------------------------------- | ------ | ------ | ----- | ----- |
| Lire les notes du groupe                       | oui    | oui    | oui   | oui   |
| Créer, modifier et supprimer des notes         | non    | oui    | oui   | oui   |
| Inviter en tant que viewer ou editor           | non    | non    | oui   | oui   |
| Renommer le groupe, voir l’e-mail des membres  | non    | non    | oui   | oui   |
| Nommer quelqu’un admin                         | non    | non    | non   | oui   |
| Payer, supprimer le groupe, céder la propriété | non    | non    | non   | oui   |

Un admin gère les viewers et les editors, jamais un autre admin, et seul le propriétaire touche au
propriétaire. Sur le plan Free, une invitation n’ajoute que des viewers : attribuer d’autres rôles,
c’est ce que vend le plan payant. Je reviens plus bas sur la façon dont plan et rôle restent séparés.

## Où se trouve le contrôle des droits ?

Dans de petites fonctions pures de la bibliothèque de domaine, une par question
([`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)). La plus
délicate, qui peut changer le rôle de qui, est la plus longue :

```ts
export function canManageMember(actor: GroupRole, target: GroupRole, next?: GroupRole): boolean {
  if (!isGroupRole(actor) || !isGroupRole(target) || (next !== undefined && !isGroupRole(next))) {
    return false
  }
  if (actor === GroupRole.OWNER) return true
  if (actor !== GroupRole.ADMIN || target > GroupRole.EDITOR) return false
  return next === undefined || next <= GroupRole.EDITOR
}
```

Ni base, ni requête, ni framework : un test unitaire l’appelle avec chaque combinaison de rôles. Un
gestionnaire lit le rôle de l’acteur et le passe au contrôle voulu avant d’appeler le dépôt :

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

Les transports ne contiennent aucune règle. Un appel arrive par le WebSocket ou en
`POST /api/call/<name>`, les deux atteignent le même gestionnaire et reçoivent la même réponse.
C’est ce qui permet au [temps réel de se replier sur HTTP](/blog/realtime-websocket-with-http-fallback)
sans second jeu de contrôles à tenir à jour.

## Pourquoi vérifier le rôle deux fois ?

Parce qu’un rôle lu avant l’écriture peut être périmé au moment du commit. Imaginez : le
propriétaire retire une éditrice à l’instant même où elle enregistre une note. Le gestionnaire a lu
« editor » une milliseconde plus tôt, le retrait est validé, et la note atterrit dans un groupe dont
son autrice ne fait plus partie.

Chaque écriture dans un groupe appelle donc d’abord `lockActorRole`, dans sa propre transaction
([`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)) :

```ts
const active = await sql`
  SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
`
if (active.length === 0) throw new GroupNotActiveError(groupId)
const member = (await sql`
  SELECT group_members.role
  FROM group_members
  INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
  WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${actorId}
  FOR SHARE OF group_members
`)[0]
return member?.role ?? null
```

La ligne du groupe est verrouillée en premier, dans le même ordre que pour tout changement de
membres, si bien que les deux opérations s’attendent au lieu de s’interbloquer. La ligne
d’appartenance est lue `FOR SHARE` : un retrait validé avant est vu, un retrait venu après attend la
fin de l’écriture. Le dépôt vérifie ensuite le rôle obtenu, donc le second contrôle coûte une
lecture par index dans une transaction déjà ouverte.

Un test le prouve pour chaque type d’écriture de note : il garde ouvert un retrait ou une
rétrogradation, lance l’écriture, constate qu’elle attend, valide le changement et s’attend à ce que
l’écriture soit refusée sans rien enregistrer (« note update: refused when a removal commits while
the write waits », dans `tests/integration/group-write-race.integration.test.ts`).

## Pourquoi un inconnu reçoit-il 404 et non 403 ?

Parce qu’un 403 dit « ce groupe existe, mais pas pour vous ». Une personne qui n’est pas membre
reçoit `GROUP_NOT_FOUND`, exactement comme pour un groupe qui n’a jamais existé, donc personne ne
peut essayer des ids pour savoir lesquels sont réels. Un membre sans le rôle requis reçoit 403
`ROLE_INSUFFICIENT`, puisqu’il sait déjà que le groupe existe.

Le plan suit la même logique. Quand un groupe atteint la limite de son plan, la réponse est **402
Payment Required**, pas 403, pour que l’application distingue « demandez au propriétaire de passer à
Pro » de « vous n’avez pas le rôle ». Le rôle décide qui peut agir ; le plan, ce que reçoit le
groupe. La facturation par siège et ses webhooks ont
[leur propre article](/fr/blog/facturation-par-utilisateur-stripe-webhooks).

## Pourquoi pas la row-level security de Postgres ?

Je l’ai envisagée et j’ai consigné le compromis dans la
[conception de la synchronisation des groupes](https://github.com/spy4x/seed/blob/main/docs/design/group-sync.md#9-tradeoffs).
La row-level security mettrait une seconde copie des règles de droits dans la base, en politiques
SQL, à côté de la copie dont les gestionnaires ont de toute façon besoin pour répondre « vous êtes
viewer » avec une erreur utile. Deux copies d’une règle finissent par diverger. Il faudrait en plus
que chaque connexion porte la personne courante, ce qui complique le pool de connexions, les tâches
de fond et les migrations.

Le coût honnête : avec des filtres dans le code applicatif, une requête qui oublie `group_id` peut
divulguer des données. Seed y répond de trois façons :

- **Des signatures avec le groupe.** Une méthode du dépôt prend l’id du groupe en argument, comme
  `get(groupId, id)`, et sa requête filtre sur les deux. Il n’existe pas de « lire une note par id »
  à mal utiliser.
- **Une seule liste de règles pour chaque fonctionnalité.** [docs/aggregates.md](/fr/docs/aggregates)
  liste ce que copie une nouvelle fonctionnalité : elle vit dans un groupe, chaque ligne a un
  `group_id`, chaque écriture relit le rôle.
- **Des tests entre groupes.** Les tests d’intégration tournent sur un vrai Postgres avec un inconnu
  dans son propre groupe, dans des étapes comme « never counts a note of another group » et « a
  person who is not a member is told the group does not exist ».

Si votre produit exige une garantie au niveau de la base, pour un audit de conformité par exemple,
la row-level security est un bon choix, et vous pouvez l’ajouter par-dessus. Pour un modèle de
départ, j’ai choisi un seul endroit pour les règles.

## Que ne fait pas Seed ?

- **Pas de rôles personnalisés.** Quatre rôles fixes. Un produit qui a besoin d’un « responsable de
  la facturation » ajoute un rôle et ses contrôles.
- **Pas de droits par enregistrement.** Un rôle vaut pour tout le groupe ; impossible de partager
  une note avec une seule personne.
- **Pas de row-level security**, comme expliqué plus haut.
- **Pas de schéma ni de base par locataire.** Tous les groupes partagent les tables.

## Essayez

Ouvrez la [démo](https://app.seedsaas.com), créez un groupe, invitez un second compte en tant que
viewer et essayez de modifier une note depuis celui-ci. La version courte est sur la
[page des groupes](/fr/features/groups), et [votre première fonctionnalité](/blog/your-first-feature-copy-the-notes-aggregate)
montre comment un nouveau type d’enregistrement hérite de tout cela en copiant le code des notes. Si
votre application ne vérifie le rôle qu’une fois, avant la transaction, c’est la course que je
fermerais en premier.
