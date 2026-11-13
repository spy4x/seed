---
slug: facturation-par-utilisateur-stripe-webhooks
language: fr
translationOf: per-seat-billing-stripe-webhooks-retries
title: "Facturation par utilisateur avec Stripe, et des webhooks qui résistent aux renvois"
seoTitle: "Facturation par utilisateur Stripe : webhooks sûrs face aux renvois"
description: "Comment Seed facture une équipe par membre avec Stripe : le nombre de sièges suit la liste des membres grâce à une tâche relancée, et chaque webhook est appliqué une seule fois, jamais à rebours."
tldr:
  - "Dans Seed, la quantité de l’abonnement Stripe est le nombre de membres du groupe, propriétaire compris. Stripe calcule le prorata ; l’application ne calcule aucun montant."
  - "Le membre rejoint d’abord, la facture suit : une tâche du worker transmet le nouveau nombre à Stripe et réessaie avec la même clé d’idempotence tant que Stripe est indisponible."
  - "L’id de chaque événement est enregistré dans la transaction qui l’applique : un renvoi ne change rien, et un échec annule les deux pour que Stripe réessaie."
  - "Un événement plus ancien ne fait jamais reculer un plan, et une tâche de nuit corrige tout nombre de sièges qui a dérivé."
topic: En détail
intro: "La facturation par utilisateur ressemble à un seul nombre : membres fois prix. Le plus dur est de garder ce nombre juste pendant que des gens arrivent, que Stripe tombe et que les webhooks arrivent en double ou dans le désordre. Voici comment Seed s’y prend, avec le vrai code."
coverAlt: "Une rangée de fauteuils de théâtre violets, chacun portant une plante en pot, tandis qu’une jeune pousse descend au bout d’un fil vers un fauteuil de plus."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: true
---

Comment facturer un SaaS par utilisateur avec Stripe sans que la facture s’éloigne de l’équipe
réelle ? Dans Seed, la quantité de l’abonnement est tout simplement le nombre de membres du groupe,
et l’application ne compte ni sur un seul appel ni sur un seul webhook pour l’y maintenir. Le
changement de membres est enregistré d’abord ; une tâche relancée transmet ensuite le nouveau nombre
à Stripe ; chaque webhook est enregistré par son id d’événement dans la transaction qui l’applique ;
et une tâche de nuit rattrape ce qui a glissé.

Cet article s’adresse aux développeurs qui ajoutent une facturation d’équipe à un SaaS, et à ceux
dont le gestionnaire de webhooks marchait très bien jusqu’au jour où Stripe a renvoyé un événement.
Tout est dans le [code de Seed](https://github.com/spy4x/seed), sous licence MIT, et je cite les
vraies lignes.

## Que veut dire facturer par utilisateur dans Seed ?

La facturation appartient à un groupe, l’équipe de Seed. Chaque groupe a un abonnement, payé par son
propriétaire. Le catalogue compte deux plans ([`PLANS`](https://github.com/spy4x/seed/blob/main/libs/domain/billing/+lib.ts)) :

| Plan | Prix                          | Membres    | Essai    |
| ---- | ----------------------------- | ---------- | -------- |
| Free | 0                             | jusqu’à 3  | aucun    |
| Pro  | 9,00 € par membre et par mois | jusqu’à 50 | 14 jours |

« Par membre » signifie que la quantité de l’abonnement Stripe est le nombre de membres du groupe,
propriétaire compris. C’est le même nombre que celui du plafond de 50, donc un siège a une seule
définition, et non deux qui se contredisent. Une invitation en attente ne réserve aucun siège ;
l’accepter, si.

Voici ce que cela coûte à une équipe, aux prix de la démo. Déplacez le curseur :

<CostCalculator members={5} />

Cinq personnes sur Pro paient 45 € par mois. Le propriétaire voit le prix d’un siège de plus avant
d’inviter qui que ce soit : le formulaire d’invitation affiche ce que le nouveau membre ajoute et
demande de l’accepter. L’API refuse une invitation sans cette acceptation (`SEAT_PRICE_NOT_ACCEPTED`),
la règle tient donc même quand le formulaire est envoyé sans JavaScript.

## Pourquoi le membre rejoint-il avant que Stripe le sache ?

Parce qu’un Stripe lent ne doit jamais empêcher quelqu’un de rejoindre une équipe. Le code évident
appelle Stripe dans la requête « accepter l’invitation » : si Stripe ne répond pas à temps, soit la
personne ne peut pas entrer, soit elle entre et la facture reste fausse pour toujours. Les deux sont
mauvais, et le second passe inaperçu.

Seed enregistre d’abord le changement de membres, dans sa propre transaction. Son commit écrit une
ligne dans l’outbox, et le worker transforme chaque changement (arrivée, retrait, départ) en tâche
de synchronisation des sièges. La tâche lit le nombre au moment où elle s’exécute et n’appelle Stripe
que s’il diffère de celui enregistré ([`seat-sync.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/seat-sync.ts)) :

```ts
const members = await new PostgresInvitationRepository(sql).countMembers(groupId)
if (members < 1 || row.quantity === members) return
const result = await provider.updateQuantity({
  subscriptionId: row.providerSubscriptionId,
  quantity: members,
  // A retry of this row asks for the same count with the same key; a later count gets its own.
  idempotencyKey: `seats:${event.id}:${members}`,
})
if (!result.ok) {
  throw new Error(`seat sync of group ${groupId} failed: ${result.error.code} ...`)
}
```

Trois détails portent tout :

1. **Le nombre est lu à l’exécution de la tâche**, pas à sa mise en file. Cinq arrivées en une
   minute demandent un seul appel juste, pas cinq qui se doublent.
2. **La clé d’idempotence nomme la tâche et le nombre.** Si Stripe a appliqué le changement et que
   la réponse s’est perdue, la nouvelle tentative envoie la même clé, et Stripe renvoie le premier
   résultat au lieu de l’appliquer deux fois.
3. **Un échec lève une erreur.** Le système de tâches réessaie après 1 s, 2 s, 4 s et ainsi de
   suite, jusqu’à 15 minutes d’écart, sur 20 tentatives, soit environ deux heures et demie ([jobs.md](https://github.com/spy4x/seed/blob/main/docs/jobs.md)).

Le changement de quantité demande à Stripe `proration_behavior=create_prorations`, sa
[valeur par défaut](https://docs.stripe.com/billing/subscriptions/prorations) : le reste de la
période est ajouté à la prochaine facture ou déduit de celle-ci. L’application ne calcule jamais
elle-même un euro au prorata. Les calculs d’argent que je n’écris pas, je ne peux pas les rater.

## Et si la synchronisation n’aboutit jamais ?

Deux autres chemins la rattrapent, car deux heures et demie de tentatives, ce n’est pas « pour
toujours » :

- **Le webhook vérifie aussi.** Quand Stripe signale un abonnement dont la quantité ne correspond pas
  au nombre de membres, la transaction qui enregistre l’événement met une synchronisation en file.
  Un paiement ouvert avant qu’un membre arrive se corrige ainsi.
- **Une tâche de nuit compare chaque groupe payant.** À 03:00, le nettoyage cherche chaque abonnement
  par membre dont la quantité enregistrée diffère du groupe et lui met une synchronisation en file.
  Cela couvre une longue panne de Stripe et un nombre qui a bougé sans événement de groupe, comme un
  membre qui supprime son compte.

Le nombre de sièges redevient donc juste au prochain changement, au prochain webhook ou à la nuit
suivante, selon ce qui arrive en premier. Je préfère cela à une conception qui n’est juste que si
chaque appel réussit.

## Comment rendre un webhook Stripe sûr face aux renvois ?

Stripe [renvoie une livraison échouée](https://docs.stripe.com/webhooks#automatic-retries) pendant
trois jours au maximum en mode live, et prévient qu’un endpoint peut recevoir le même événement plus
d’une fois. Un gestionnaire qui ajoute un siège ou envoie un e-mail à chaque livraison finira par le
faire deux fois.

Le webhook de Seed fait trois choses dans un ordre fixe. D’abord la signature : l’adaptateur
[`@spy4x/billing`](https://jsr.io/@spy4x/billing) vérifie l’en-tête `Stripe-Signature` sur le corps
brut, avec une fenêtre de cinq minutes, avant de lire un octet de JSON. Une signature invalide reçoit
`400`. Ensuite, tout se passe dans une transaction Postgres qui commence par enregistrer l’id de
l’événement ([`postgres-billing-repository.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/postgres-billing-repository.ts)) :

```ts
return await this.sql.begin(async (transaction) => {
  const stored = await transaction`
    INSERT INTO billing_events (id, event_type) VALUES (${event.id}, ${event.type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  if (stored.length === 0) return "duplicate"
  // ... apply the subscription, queue mails and seat syncs, record the plan change
})
```

`billing_events.id` est la clé primaire : la deuxième livraison n’insère rien et repart sans toucher
à l’abonnement. Comme l’id est enregistré _dans_ la transaction, le cas inverse est sûr aussi : si
quelque chose échoue ensuite, l’id est annulé avec le reste, la route répond `500`, et le renvoi de
Stripe repart sur une base propre. Enregistrer l’id d’abord et appliquer plus tard, en deux étapes,
perdrait l’événement dès qu’un déploiement redémarre l’API entre les deux.

Les e-mails au propriétaire (paiement refusé, fin d’essai, fin de plan) sont mis dans l’outbox dans
cette même transaction, donc un événement répété n’en met jamais un second en file. Un événement que
Seed ne traite pas reçoit `200`, et Stripe cesse de l’envoyer.

## Et les événements qui arrivent dans le désordre ?

Stripe [ne garantit pas l’ordre](https://docs.stripe.com/webhooks#event-ordering) des événements. Un
`customer.subscription.updated` en retard qui dit « trialing » ne doit pas défaire le `active` arrivé
avant. Seed écrit l’abonnement avec un upsert qui ne fait qu’avancer :

```sql
ON CONFLICT (group_id) DO UPDATE SET ...
WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
    <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
```

L’heure de l’événement compte d’abord, son type départage : création, puis mise à jour, puis
suppression. Un événement plus ancien ne correspond à aucune ligne et ne change rien. Une seconde
règle dans le même `WHERE` empêche un nouvel abonnement qui ne paie pas (après un prélèvement refusé
tardif, par exemple) de remplacer un abonnement qui paie.

Je vous dis franchement la limite. La documentation de Stripe déconseille d’ordonner les événements
par `created`, exprimé en secondes entières. Seed ne s’en sert que comme garde-fou contre les retours
en arrière, jamais pour repérer les doublons, c’est le rôle de l’id d’événement. Deux événements du
même type dans la même seconde, arrivés à l’envers, laissent encore l’ancien enregistré, jusqu’au
prochain événement ou à un changement dans le portail. Ce cas est écrit dans
[la documentation de facturation](/fr/docs/billing-lifecycle#known-limits), et la correction attend
[spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380). Je préfère vous le dire plutôt que
vous le laisser découvrir.

## Les tests le prouvent-ils ?

Ils tournent sur un vrai Postgres. Les 26 étapes de la suite du webhook
(`tests/integration/billing.integration.test.ts`) comprennent « une deuxième livraison du même
événement ne change rien » et « un événement plus ancien que celui enregistré ne fait jamais reculer
le plan ». Les sièges ont leur propre suite (`tests/integration/seat-billing.integration.test.ts`),
avec des étapes comme « un membre retiré et un membre qui part le baissent chacun d’un » et « la tâche
de nuit met en file un changement de sièges pour chaque groupe qui a dérivé ».

## Que ne fait pas Seed ?

Pour que vous le sachiez avant de bâtir dessus :

- **Un seul plan payant, mensuel, par membre.** Pas de facturation à l’usage ou au compteur, pas de
  paliers. Ajouter un plan, ce sont cinq étapes dans [Plans and limits](/fr/docs/billing-plans).
- **Stripe seulement.** Le code parle à une interface de fournisseur, mais Stripe est le seul
  adaptateur existant. La facturation peut aussi être désactivée, et chaque groupe a alors toutes
  les fonctions.
- **`invoice.paid` et `invoice.payment_failed` sont enregistrés mais ne changent encore rien.** Le
  plan suit le statut de l’abonnement lui-même.
- **L’argent reste chez Stripe.** L’application garde ce que les webhooks rapportent et ne décide
  jamais d’un plan seule.

## Essayez

Ouvrez la [démo](https://app.seedsaas.com), créez un groupe et regardez son onglet Facturation ;
invitez quelqu’un et vous verrez le prix du siège avant l’envoi. La version courte est sur la
[page de la facturation](/fr/features/billing), [Set up billing](/fr/docs/billing) vous mène de zéro
à Stripe en production, en mode test d’abord, et les groupes ont [leur propre page](/fr/features/groups).
Si votre gestionnaire de webhooks enregistre l’id de l’événement en une étape et l’applique dans
une autre, c’est la première ligne que je changerais aujourd’hui.
