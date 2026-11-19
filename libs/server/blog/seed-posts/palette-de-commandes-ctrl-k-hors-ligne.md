---
slug: palette-de-commandes-ctrl-k-hors-ligne
language: fr
translationOf: ctrl-k-command-palette-offline
title: "Comment créer une palette de commandes Ctrl+K qui marche hors ligne"
seoTitle: "Palette de commandes Ctrl+K hors ligne : comment la créer"
description: "Une palette de commandes Ctrl+K doit piloter toute l’app, pardonner les fautes et la mauvaise disposition de clavier, et marcher hors ligne. Voici comment Seed la construit à partir d’une seule liste de commandes."
tldr:
  - "Une palette de commandes sert à piloter l’app, pas seulement à chercher. Pages, créations et réglages sont tous des commandes, et un réglage s’applique dès qu’on appuie sur Enter."
  - "Comparer les débuts de mots, tolérer une faute par mot et relire la requête dans l’autre disposition de clavier. Alors « notse » trouve Notes et « ntvf » trouve Theme."
  - "Ne jamais finir sur « No results ». Proposer de créer ce qui a été tapé, chercher dans la copie locale quand le serveur est injoignable, griser ce qui exige une connexion."
  - "Une seule liste pure : l’état de l’app entre, les commandes sortent. Les touches viennent de l’unique liste de raccourcis de l’app, donc la palette et la fenêtre des raccourcis concordent."
topic: En détail
intro: "La palette Ctrl+K de Seed pilote toute l’app, retrouve ce qu’on cherche malgré les fautes de frappe et la mauvaise disposition de clavier, et continue de marcher sans réseau. Voici ce qu’elle fait et le seul fichier dont elle est faite."
relatedFeature: shortcuts
coverAlt: "Une touche de clavier violette, vierge, brille sur un bureau à côté d’un câble débranché, et quatre cartes en papier s’en élèvent : une lune, un soleil, une page et une maison."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-19T08:00:00Z
newsletter: true
---

Comment créer une palette de commandes Ctrl+K que les gens continuent d’utiliser ? Il faut qu’elle
fasse trois choses. Elle pilote l’app : chaque page, chaque « New… » et chaque réglage est une
commande. Elle pardonne la façon dont on tape vraiment : une faute, un demi-mot, la mauvaise
disposition de clavier. Et elle ne vous laisse jamais dans une impasse : quand rien ne correspond,
elle propose de créer ce que vous avez tapé, et sans réseau, elle cherche dans la copie stockée sur
votre appareil. Dans Seed, tout cela vient d’une seule liste de commandes, dans un seul fichier.

Cet article s’adresse aux développeurs qui ajoutent Ctrl+K à leur propre application web. Je
montre d’abord ce que fait la palette, puis le fichier dont elle est faite, avec le vrai code.

![La palette de commandes de Seed avec « ntvf » tapé dans le champ de recherche. La première ligne, en surbrillance, est Theme, sous Settings, avec sa valeur actuelle « System » à côté.](/shots/palette-dark-800.webp)

## Que doit faire Ctrl+K, à part chercher ?

Ouvrez la palette sans rien taper. Elle sert déjà : vos cinq derniers choix sous Recent (récents),
les commandes de la page où vous êtes, vos dernières notes, et Create (créer). La plupart des
passages par une palette, c’est « ramène-moi à ce truc » ou « fais l’évidence ici », et ni l’un ni
l’autre ne devrait demander de taper.

Ensuite, elle liste tout ce que l’app sait faire, sous cinq titres : This page (cette page), Go to
(aller à), Create, Settings (réglages) et Account (compte). Les exemples utilisent l’app en
anglais, d’où ces noms. Quelques choix qui ont payé :

- **Les réglages agissent tout de suite.** Tapez `light`, appuyez sur Enter : la page passe en
  clair et la palette reste ouverte. Tapez `dark`, Enter, et vous revoilà. Pas besoin d’aller sur
  une page de réglages pour voir si ça vous plaît.
- **Les touches sont à côté des commandes.** New note affiche sa touche, N, sur sa ligne. Un
  raccourci de deux touches, comme G puis N pour la page Notes, figure dans la fenêtre Keyboard
  shortcuts (raccourcis clavier), qui lit la même liste de commandes. Personne n’a
  besoin d’antisèche.
- **`>` veut dire commandes seulement.** Commencez la requête par `>`, et les notes et les groupes
  ne gênent plus.
- **Enter attend la réponse.** La palette donne une réponse par requête, notes comprises. Appuyez
  sur Enter avant que le serveur ait répondu, et elle attend : vous n’ouvrez jamais la ligne qui
  se trouvait par hasard en tête une demi-seconde plus tôt.

Un champ de recherche qui ne trouve que des notes, c’est la moitié d’une palette. L’autre moitié,
c’est la raison pour laquelle les gens gardent les mains sur le clavier.

## Comment trouve-t-elle malgré les fautes et la mauvaise disposition de clavier ?

Tapez `notse`, et la première ligne est la page Notes. Tapez `ntvf`, et vous obtenez Theme, comme
sur l’image plus haut. Ce deuxième-là ressemble à un chat qui a marché sur le clavier. C’est
« тема », le mot russe pour « thème », tapé avec la disposition anglaise encore active. Mon clavier
a deux dispositions, et je suis dans la mauvaise assez souvent pour que `ntvf` soit devenu un cas
de test.

Le moteur de correspondance suit quelques règles simples :

1. La casse et les accents sont ignorés.
2. Les mots peuvent venir dans n’importe quel ordre, et chaque mot tapé doit seulement commencer un
   mot du nom de la commande ou de l’un de ses autres noms. `no all` suffit pour « all notes ».
3. Un mot de quatre lettres ou plus peut porter une faute : une lettre en trop, en moins ou
   fausse, ou deux lettres inversées.
4. La requête est aussi lue comme si l’autre disposition de clavier était active, et d’un alphabet
   à l’autre, si bien que des lettres latines peuvent trouver un mot russe, et inversement.

Quand plusieurs lignes correspondent, la correspondance la plus nette gagne : d’abord un nom exact,
puis un nom qui commence par la requête, puis des mots qui correspondent, puis un alias, puis
l’autre disposition, et une faute en dernier. Pardonner une faute ne fait donc jamais descendre une
bonne réponse.

Chaque commande porte aussi les mots que les gens essaient, en anglais et en russe. Notes répond à
« all notes » et « заметки », Activity à « history », « log » et « audit ». Personne ne se
souvient du nom que vous avez donné à la page. On se souvient du nom qu’on lui aurait donné.

L’alternative habituelle, c’est une recherche floue (fuzzy matching), celle qui accepte n’importe
quelles lettres pourvu qu’elles apparaissent dans l’ordre. C’est le meilleur choix pour un
sélecteur de fichiers, où `gtn` doit trouver `go-to-notes.ts`. Pour une liste de commandes, elle
est trop généreuse : quelques lettres peuvent faire remonter des lignes sans aucun rapport avec ce
que vous vouliez, et elle ignore toujours que `ntvf` est un mot. Débuts de mots plus une faute,
c’est plus strict, et ça convient à des noms courts écrits pour des humains.

Une faute par mot, c’est la limite. Deux fautes dans un même mot ne trouvent rien : c’est un moteur
de correspondance, pas un médium. Il vit dans une bibliothèque partagée,
[`@spy4x/platform`](https://jsr.io/@spy4x/platform), et prépare une seule fois les noms de chaque
commande, si bien que quelques centaines de lignes sont reclassées à chaque frappe sans que
personne ne le remarque.

## Qu’affiche-t-elle quand rien ne correspond ?

« No results », c’est la palette qui vous dit d’aller voir ailleurs. Celle de Seed ne le dit
jamais, parce que ce que vous avez tapé fait un titre tout à fait correct pour la prochaine chose.

Tapez `Palette demo`. Rien ne s’appelle ainsi, donc la section Create propose
`New note: “Palette demo”`. Enter ouvre le formulaire de nouvelle note avec le titre déjà rempli.
Ctrl+Enter saute le formulaire : la note est créée et ouverte.

Ces lignes sont construites à partir de la requête, jamais comparées avec elle, donc n’importe quel
texte les obtient :

```ts
export function quickCreateRows(context: PaletteContext, query: string): PaletteOption[] {
  const { t, currentGroup } = context
  const title = query.trim()
  if (title === "") return []
  const writable = currentGroup?.canWrite && context.notes !== false ? currentGroup : null
  const row = (entity: QuickCreateEntity, key: string): PaletteOption => ({
    id: `quick-create-${entity}`,
    label: t.t(`Search.withText`, { label: t.t(key), text: isolate(quoted(title)) }),
    group: t.t(`Search.create`),
    choice: { kind: "quick-create", entity, title },
  })
  // …une note et une étiquette quand la personne peut écrire ici, et un groupe
}
```

Un lecteur (viewer) qui n’a pas le droit d’écrire n’a pas de ligne « New note ». La palette ne
propose que ce que proposeraient les boutons de la page.

## Comment continue-t-elle de marcher hors ligne ?

Sans réseau, deux choses peuvent mal tourner : la recherche n’a personne à qui demander, et
certaines commandes n’ont personne pour les exécuter. La palette traite chacune à part.

**La recherche se replie sur l’appareil.** L’app de Seed garde déjà une copie de vos notes dans la
base locale du navigateur (c’est
[la couche offline-first](/blog/offline-first-preact-signals-local-database-sync), en anglais). La
palette interroge d’abord le serveur, et quand il est injoignable, elle cherche dans cette copie à
la place :

```ts
return async (query, signal) => {
  if (query === "") return { notes: await recentNotes(sources), onDevice: !sources.canCall() }
  if (sources.canCall()) {
    try {
      const answer = await sources.server(query, signal)
      return { notes: answer.notes.map(fromWire), onDevice: false }
    } catch (error) {
      if (signal.aborted || !(isUnreachable(error) || isProxyAnswer(error))) throw error
    }
  }
  return { notes: await notesOnDevice(sources, indexOf, query), onDevice: true }
}
```

C’est
[`apps/spa/src/state/search.ts`](https://github.com/spy4x/seed/blob/main/apps/spa/src/state/search.ts).
Trois détails comptent :

- Le titre devient « Notes on this device » (notes sur cet appareil), pour que vous sachiez que la
  réponse peut être plus ancienne que celle du serveur.
- Seul un serveur injoignable déclenche le repli. Un refus, comme la limite de débit, s’affiche
  comme une erreur. Le cacher derrière des résultats locaux, ce serait mentir poliment.
- L’appareil peut encore contenir des notes d’un groupe que vous avez quitté. La recherche ne
  regarde que dans les groupes dont vous êtes membre aujourd’hui.

La recherche locale pardonne les mêmes choses. Coupez le réseau dans la démo, tapez `pallette`
avec deux l, et la note « Palette demo » est trouvée. Tout comme `зфдуееу`, le même mot tapé avec
la disposition russe.

**Les commandes qui exigent le serveur restent listées.** Hors ligne, « New group » ou « Delete my
account » pourraient discrètement disparaître de la liste. Vous vous demanderiez alors si la
fonctionnalité existe seulement. Au lieu de ça, elles restent à leur place, grisées, avec « Needs a
connection » (connexion requise) à côté :

```ts
const SERVER_ONLY = new Set(
  [
    `import-notes`,
    `new-group`,
    `keep`,
    `download-data`,
    `change-picture`,
    `delete-account`,
    `turn-off-two-factor`,
    `end-other-sessions`,
  ].map((id) => `action-${id}`),
)

function needsServer(context: PaletteContext, option: PaletteOption): PaletteOption {
  return {
    ...option,
    disabledReason: context.online ? undefined : context.t.t(`Search.needsConnection`),
  }
}
```

New note et New tag ne sont pas sur cette liste. Elles marchent hors ligne : l’écriture attend dans
une file et part quand la connexion revient.

## Comment est-elle construite ? Une seule liste de commandes

Tout le registre tient dans
[`libs/ui/palette-commands.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.ts).
C’est une fonction pure : l’état de l’app entre (qui vous êtes, quel groupe, en ligne ou non), une
liste d’options sort. Pas de store, pas de `fetch`, pas de routeur. Une commande, c’est une entrée :

```ts
{
  id: "notes",
  key: `Frame.notes`,
  href: (context) => context.notes === false ? null : NOTE_PATHS.list,
  aliases: [`notes list`, `all notes`, `заметки`, `список заметок`],
},
```

La clé de traduction du libellé, la destination, les mots qui la trouvent. `href` renvoie `null`
quand la personne ne peut pas y aller, et la commande est laissée de côté.

Regardez ce que l’entrée n’a pas : ses touches. G puis N n’est écrit nulle part dans ce fichier.
L’app a une seule liste de raccourcis, et la palette y cherche les touches par la même clé de
traduction :

```ts
function kbdOf(shortcuts: readonly ShortcutRow[], key: string): string | undefined {
  return shortcuts.find((row) => row.description === key)?.keys
}
```

La palette et la fenêtre Keyboard shortcuts ne peuvent donc pas se contredire. L’autre version,
avec les touches tapées à deux endroits, marche jusqu’au jour où l’un des deux change. La fenêtre
relit aussi le même registre et liste chaque commande avec les mots qui la trouvent.

Chaque option porte un choix, un petit objet comme `{ kind: "quick-create", entity, title }`. L’app
l’exécute par la même fonction qu’appellent ses boutons. La palette ne se dote jamais d’une seconde
implémentation de « créer une note » qui finirait par s’écarter de la vraie.

Comme elle est pure, elle se teste à peu de frais : pas de navigateur, juste un état en entrée et
des lignes en sortie. Les tests se lisent comme la liste des fonctionnalités, par exemple « put Go
to Notes first for notse and заметки » et « keep each command the server must run listed offline,
dimmed with why, and dim none online ». Ils sont dans
[`palette-commands.test.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.test.ts).

Le panneau d’administration a la même palette. Ses commandes forment une seconde liste de 268
lignes, et tout le reste est partagé.

## Comment un produit ajoute-t-il ses propres enregistrements ?

Seed est un modèle de départ, donc la palette doit trouver des choses dont je n’ai jamais entendu
parler : vos factures, vos contacts, vos projets. Un produit les lui fournit sous forme
d’enregistrements :

```ts
export interface PaletteRecord {
  /** Unique within its source. */
  id: string
  /** What the palette lists and matches, in the person's language. */
  label: string
  /** The row's second line, such as an amount or a date. It is shown, not matched. */
  detail?: string
  /** Other words that find it, such as a number or an old name. */
  aliases?: readonly string[]
  /** The page a pick opens, as a page command does. */
  href: string
}
```

Une source, c’est un titre plus une fonction qui renvoie les enregistrements que l’appareil
détient à cet instant
([`search-palette.tsx`](https://github.com/spy4x/seed/blob/main/libs/ui/search-palette.tsx)).
Ils sont comparés sur l’appareil par le même moteur que les commandes, donc une facture profite
gratuitement de la tolérance aux fautes et à la disposition de clavier, en ligne ou non. Un piège :
la fonction est appelée à chaque frappe, elle doit donc répondre depuis la mémoire, et renvoyer les
mêmes objets tant que rien n’a changé. Le moteur prépare chaque objet une seule fois et réutilise
ce travail.

## Essayez de la casser

Ouvrez la [démo en ligne](https://app.seedsaas.com/try) et appuyez sur « Try it now ». Vous
obtenez un compte invité avec des notes d’exemple. Ensuite :

1. Appuyez sur Ctrl+K (⌘K sur Mac) et tapez `notse`, puis `ntvf`.
2. Tapez `light`, appuyez sur Enter, puis `dark`, Enter.
3. Tapez un titre que personne n’a utilisé et appuyez sur Ctrl+Enter.
4. Coupez le réseau dans les outils de développement de votre navigateur et cherchez cette note
   avec une faute dedans.

Tout est sous licence MIT dans [le dépôt](https://github.com/spy4x/seed), et les touches sont
listées sur [la page des raccourcis](/fr/features/shortcuts). Si vous trouvez une faute qu’elle
aurait dû pardonner et ne l’a pas fait, c’est un test que je n’ai pas encore écrit.
