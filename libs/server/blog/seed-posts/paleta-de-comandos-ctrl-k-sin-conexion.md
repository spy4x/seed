---
slug: paleta-de-comandos-ctrl-k-sin-conexion
language: es
translationOf: ctrl-k-command-palette-offline
title: "Cómo crear una paleta de comandos Ctrl+K que funcione sin conexión"
seoTitle: "Cómo crear una paleta de comandos Ctrl+K que funcione sin conexión"
description: "Una paleta de comandos Ctrl+K debe manejar toda la app, perdonar erratas y la distribución de teclado equivocada, y seguir funcionando sin conexión. Así la construye Seed a partir de una sola lista de comandos."
tldr:
  - "Una paleta de comandos debe manejar la app, no solo buscar en ella. Páginas, acciones de crear y ajustes son comandos, y un ajuste cambia en cuanto pulsas Enter."
  - "Busca por inicio de palabra, admite una errata por palabra y lee la consulta también en la otra distribución de teclado. Así «notse» encuentra Notes y «ntvf», Theme."
  - "Nunca acabes en «No results». Ofrece crear lo que se ha escrito, busca en la copia del dispositivo si el servidor no responde y atenúa lo que necesita conexión."
  - "Que sea una sola lista pura: entra el estado de la app y salen comandos. Las teclas vienen de la única lista de atajos de la app, así que la paleta y el diálogo de atajos nunca discrepan."
topic: A fondo
intro: "La paleta Ctrl+K de Seed maneja toda la app, encuentra cosas a pesar de las erratas y de la distribución de teclado equivocada, y sigue funcionando sin red. Esto es lo que hace y el único archivo del que sale."
relatedFeature: shortcuts
coverAlt: "Una tecla violeta sin rotular brilla sobre un escritorio junto a un cable desenchufado, y de ella se elevan cuatro tarjetas de papel con una luna, un sol, una página y una casa."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-19T08:00:00Z
newsletter: true
---

¿Cómo se crea una paleta de comandos Ctrl+K que la gente siga usando? Haciendo que cumpla tres
cosas. Maneja la app: cada página, cada «New…» y cada ajuste es un comando. Perdona cómo escribe la
gente de verdad: una errata, media palabra, la distribución de teclado equivocada. Y nunca te deja
en un callejón sin salida: si nada coincide, ofrece crear lo que has escrito, y sin red busca en la
copia que hay en tu dispositivo. En Seed todo eso sale de una sola lista de comandos en un solo
archivo.

Este artículo es para quien está añadiendo Ctrl+K a su propia app web. Primero enseño lo que hace la
paleta y después el archivo del que sale, con el código real.

![La paleta de comandos de Seed con «ntvf» escrito en el campo de búsqueda. La primera fila, resaltada, es Theme, bajo Settings, con su valor actual «System» al lado.](/shots/palette-dark-800.webp)

## ¿Qué debe hacer Ctrl+K además de buscar?

Abre la paleta y no escribas nada. Ya es útil: tus cinco últimas elecciones bajo Recent (recientes),
los comandos de la página en la que estás, tus últimas notas y Create. Casi todas las visitas a una
paleta son «llévame otra vez a aquello» o «haz lo obvio aquí», y ninguna de las dos debería exigir
escribir.

Luego lista todo lo que puede hacer la app, bajo cinco encabezados: This page (esta página), Go to
(ir a), Create, Settings y Account. Algunas decisiones que salieron bien:

- **Los ajustes actúan al momento.** Escribe `light`, pulsa Enter: la página se vuelve clara y la
  paleta sigue abierta. Escribe `dark`, Enter, y vuelves a estar como antes. No hace falta ir a una
  página de ajustes para ver si te gusta.
- **Las teclas están junto a los comandos.** New note muestra su tecla, N, en su fila. Un atajo de
  dos teclas, como G y luego N para la página de notas, aparece en el diálogo Keyboard shortcuts,
  que lee la misma lista de comandos. Nadie necesita una chuleta.
- **`>` significa solo comandos.** Empieza la consulta con `>` y las notas y los grupos dejan de
  estorbar.
- **Enter espera la respuesta.** La paleta da una sola respuesta por consulta, notas incluidas. Si
  pulsas Enter antes de que el servidor conteste, espera, así que nunca abres la fila que por
  casualidad iba primera hace medio segundo.

Un buscador que solo encuentra notas es media paleta. La otra mitad es la razón por la que la gente
no quita las manos del teclado.

## ¿Cómo encuentra cosas a pesar de las erratas y de la distribución de teclado equivocada?

Los ejemplos usan la app en inglés. Escribe `notse` y la primera fila es la página Notes. Escribe
`ntvf` y sale Theme, como en la imagen de arriba. Lo segundo parece obra de un gato paseándose por
el teclado. Es «тема», la palabra rusa para «tema», escrita con la distribución inglesa todavía
activa. Mi teclado tiene dos distribuciones, y me equivoco de una con la frecuencia suficiente para
que `ntvf` sea ya un caso de test.

El buscador sigue unas pocas reglas sencillas:

1. Se ignoran las mayúsculas y los acentos.
2. Las palabras pueden ir en cualquier orden, y cada palabra que escribes solo tiene que ser el
   inicio de una palabra del nombre del comando o de uno de sus otros nombres. `no all` basta para
   «all notes».
3. Una palabra de cuatro letras o más puede llevar una errata: una letra de más, de menos o
   equivocada, o dos letras intercambiadas.
4. La consulta también se lee como si estuviera activa la otra distribución de teclado, y entre
   alfabetos, así que las letras latinas pueden encontrar una palabra rusa y al revés.

Cuando coinciden varias filas, gana la coincidencia más limpia: primero un nombre exacto, luego un
nombre que empieza por la consulta, luego palabras que coinciden, luego un alias, luego la otra
distribución y, al final, una errata. Así, perdonar una errata nunca hunde una respuesta correcta.

Cada comando lleva además las palabras que la gente prueba, en inglés y en ruso. Notes responde a
«all notes» y «заметки»; Activity, a «history», «log» y «audit». Nadie recuerda cómo llamaste tú a
la página. Recuerdan cómo la habrían llamado ellos.

La alternativa habitual es un buscador difuso (fuzzy), del tipo que acepta cualquier letra siempre
que aparezcan en orden. Es la mejor opción para un selector de archivos, donde `gtn` debe encontrar
`go-to-notes.ts`. Para una lista de comandos es demasiado generoso: unas pocas letras pueden
coincidir con filas que no tienen nada que ver con lo que querías, y aun así no tiene ni idea de que
`ntvf` es una palabra. Inicio de palabra más una errata es más estricto, y eso encaja con nombres
humanos cortos.

Una errata por palabra es el límite. Dos erratas en una palabra no encuentran nada: es un buscador,
no un adivino. El buscador vive en una librería compartida,
[`@spy4x/platform`](https://jsr.io/@spy4x/platform), y prepara los nombres de cada comando una sola
vez, así que unos cuantos cientos de filas se vuelven a ordenar en cada pulsación sin que nadie lo
note.

## ¿Qué muestra cuando nada coincide?

«No results» es la paleta diciéndote que te vayas. La de Seed nunca lo dice, porque lo que sea que
hayas escrito es un título perfectamente bueno para lo siguiente.

Escribe `Palette demo`. Nada se llama así, de modo que la sección Create ofrece `New note: “Palette
demo”`. Enter abre el formulario de nota nueva con el título ya puesto. Ctrl+Enter se salta el
formulario: la nota se crea y se abre.

Estas filas se construyen a partir de la consulta, nunca se comparan con ella, así que cualquier
texto las obtiene:

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
  // …una nota y una etiqueta cuando la persona puede escribir aquí, y un grupo
}
```

Un viewer que no puede escribir no recibe la fila «New note». La paleta solo ofrece lo que
ofrecerían los botones de la página.

## ¿Cómo sigue funcionando sin conexión?

Sin red pueden fallar dos cosas: la búsqueda no tiene a quién preguntar, y algunos comandos no
tienen quién los ejecute. La paleta resuelve cada una por separado.

**La búsqueda recurre al dispositivo.** La app de Seed ya guarda una copia de tus notas en la base
de datos local del navegador (es
[la capa offline-first](/blog/offline-first-preact-signals-local-database-sync), en inglés). La
paleta pregunta primero al servidor, y cuando no puede alcanzarlo busca en esa copia:

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

Eso es
[`apps/spa/src/state/search.ts`](https://github.com/spy4x/seed/blob/main/apps/spa/src/state/search.ts).
Tres detalles importan:

- El encabezado cambia a «Notes on this device» (notas en este dispositivo), para que sepas que la
  respuesta puede ser más antigua que la del servidor.
- Solo un servidor inalcanzable activa el plan B. Un rechazo, como el límite de peticiones, se
  muestra como error. Esconderlo tras resultados locales sería mentir con educación.
- El dispositivo puede guardar todavía notas de un grupo que has dejado. La búsqueda solo mira en
  los grupos a los que perteneces ahora.

La búsqueda local perdona lo mismo. Desconecta la red en la demo, escribe `pallette` con dos eles y
la nota «Palette demo» aparece. También con `зфдуееу`, la misma palabra escrita con la distribución
rusa.

**Los comandos que necesitan el servidor siguen en la lista.** Sin conexión, «New group» o «Delete
my account» podrían desaparecer sin avisar. Entonces te preguntarías si la función existe siquiera.
En su lugar se quedan donde estaban, atenuados, con «Needs a connection» (necesita conexión) al
lado:

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

New note y New tag no están en esa lista. Funcionan sin conexión: la escritura espera en una cola y
sale cuando vuelve la conexión.

## ¿Cómo está construida? Una sola lista de comandos

Todo el registro es
[`libs/ui/palette-commands.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.ts).
Es una función pura: entra el estado de la app (quién eres, qué grupo, con conexión o sin ella) y
sale una lista de opciones. Sin store, sin `fetch`, sin router. Un comando es una entrada:

```ts
{
  id: "notes",
  key: `Frame.notes`,
  href: (context) => context.notes === false ? null : NOTE_PATHS.list,
  aliases: [`notes list`, `all notes`, `заметки`, `список заметок`],
},
```

La clave de traducción de la etiqueta, adónde lleva y las palabras que lo encuentran. `href`
devuelve `null` cuando la persona no puede ir allí, y el comando se queda fuera.

Fíjate en lo que no tiene la entrada: sus teclas. G y luego N no aparece escrito en ningún sitio de
este archivo. La app tiene una sola lista de atajos, y la paleta busca allí las teclas por la misma
clave de traducción:

```ts
function kbdOf(shortcuts: readonly ShortcutRow[], key: string): string | undefined {
  return shortcuts.find((row) => row.description === key)?.keys
}
```

Así, la paleta y el diálogo Keyboard shortcuts no pueden discrepar. La otra versión, con las teclas
escritas en dos sitios, funciona hasta el día en que una de las dos cambia. El diálogo también lee
el mismo registro y lista cada comando con las palabras que lo encuentran.

Cada opción lleva una elección, un objeto pequeño como `{ kind: "quick-create", entity, title }`.
La app la ejecuta con la misma función que llaman sus botones. A la paleta nunca le crece una
segunda implementación de «crear una nota» que se aleje de la de verdad.

Como es pura, sale barata de testear: sin navegador, solo estado que entra y filas que salen. Los
tests se leen como la lista de funciones, por ejemplo «put Go to Notes first for notse and
заметки» y «keep each command the server must run listed offline, dimmed with why, and dim none
online». Están en
[`palette-commands.test.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.test.ts).

El panel de administración tiene la misma paleta. Sus comandos son una segunda lista de 268 líneas,
y todo lo demás se comparte.

## ¿Cómo añade un producto sus propios registros?

Seed es una plantilla de inicio, así que la paleta tiene que encontrar cosas de las que nunca he
oído hablar: tus facturas, contactos, proyectos. Un producto se los entrega como registros:

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

Una fuente es un encabezado más una función que devuelve los registros que guarda el dispositivo en
ese momento
([`search-palette.tsx`](https://github.com/spy4x/seed/blob/main/libs/ui/search-palette.tsx)). Se
comparan en el dispositivo con el mismo buscador que los comandos, así que una factura recibe gratis
el perdón de erratas y de distribución, con conexión o sin ella. Un detalle: la función se llama en
cada pulsación, así que debe responder desde memoria, y debería devolver los mismos objetos mientras
nada cambie. El buscador prepara cada objeto una vez y reutiliza ese trabajo.

## Intenta romperla

Abre la [demo en vivo](https://app.seedsaas.com/try) y pulsa «Try it now». Recibes una cuenta de
invitado con notas de ejemplo. Después:

1. Pulsa Ctrl+K (⌘K en Mac) y escribe `notse`, luego `ntvf`.
2. Escribe `light`, pulsa Enter, luego `dark`, Enter.
3. Escribe un título que nadie haya usado y pulsa Ctrl+Enter.
4. Desconecta la red en las herramientas de desarrollo de tu navegador y busca esa nota con una
   errata.

Todo tiene licencia MIT en [el repositorio](https://github.com/spy4x/seed), y las teclas están en
[la página de atajos](/es/features/shortcuts). Si encuentras una errata que debería haber perdonado
y no lo hizo, es un test que todavía no he escrito.
