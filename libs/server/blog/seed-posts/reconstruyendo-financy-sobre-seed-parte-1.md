---
slug: reconstruyendo-financy-sobre-seed-parte-1
language: es
translationOf: rebuilding-financy-on-seed-part-1
title: "Reconstruyendo Financy sobre Seed, parte 1: un producto real"
seoTitle: "Reconstruyendo Financy sobre Seed: un producto real"
description: "Estoy reconstruyendo Financy, mi gestor de finanzas de código abierto, sobre Seed. Parte 1: por qué empecé de cero, cómo nació la copia y cómo fue la primera sincronización."
tldr:
  - "Financy, mi gestor de finanzas de código abierto, empieza de nuevo como copia de Seed. La versión anterior queda congelada en una rama, como referencia de lo que hacía."
  - "Su primer commit son los archivos de Seed más 19 propios: licencia, README, reglas para agentes, documentos del producto y los dos archivos .seed."
  - "La primera sincronización, un día después de la copia y tras un cambio de marca, trajo 19 commits de Seed y 616 archivos sin ningún conflicto."
  - "Aún no hay funciones de finanzas. Lo que necesitaría cualquier producto se hace primero en Seed, y Financy lo recibe con una sincronización."
topic: Construir en público
intro: "Estoy reconstruyendo Financy, mi gestor de finanzas de código abierto para una persona o una familia, sobre Seed, y lo cuento mientras pasa. Parte 1: por qué tiré el código viejo, cómo un producto parte de Seed y cómo fue la primera sincronización."
coverAlt: "Una planta violeta joven pasa de una maceta de barro gris agrietada a una maceta violeta nueva, mientras una gran planta violeta a su lado comparte con ella su tubo de riego."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-09T09:00:00Z
newsletter: true
devto: false
---

¿Se puede construir un producto real sobre un SaaS starter y seguir recibiendo sus actualizaciones?
Es justo lo que estoy haciendo con [Financy](https://github.com/spy4x/financy), mi gestor de
finanzas gratuito y de código abierto (AGPL-3.0) para una persona o una familia. Financy empezó de
nuevo como copia de Seed el 3 de noviembre de 2026, y el 4 de noviembre recibió su primer lote de
cambios de Seed: 19 commits, 616 archivos, cero conflictos. Esta serie sigue la reconstrucción a
medida que ocurre.

Es para desarrolladores que están eligiendo un SaaS starter y quieren verlo usado en algo más que
una demo, y para quien sienta curiosidad por Financy. Todo es público: cada cifra sale de los dos
repositorios en GitHub, y puedes contarlas tú mismo con git.

## ¿Por qué reconstruir Financy en lugar de arreglarlo?

El primer Financy nació en abril de 2025 y llegó a 157 commits. Llevaba cuentas en varias monedas,
convertía entre ellas y tenía pruebas de extremo a extremo. También tenía código en el que ya no
confío: buena parte lo escribí deprisa con los modelos de IA de entonces, y su estructura, su manejo
del estado y su sincronización habrían tenido que cambiar igualmente para ser el producto que quiero.

La otra mitad de la respuesta es lo que le faltaba. Un gestor de finanzas para un hogar necesita
inicio de sesión con doble factor, grupos con roles, cambios en vivo en todos los dispositivos, una
app que funcione sin conexión, un panel de administración y una web pública. Eso es la fontanería de
cualquier SaaS, no finanzas, y acababa de pasar octubre construyendo casi toda en Seed
([lo que llegó en octubre](/blog/whats-new-in-seed-october-2026), en inglés). Escribirla otra vez
dentro de Financy sería justo el error que Seed existe para evitar.

Así que el Financy antiguo queda congelado en su rama
[`legacy`](https://github.com/spy4x/financy/tree/legacy). Sirve de referencia para **qué** hace
Financy (sus funciones, sus reglas de dinero, sus casos límite) y nunca para **cómo**: no se porta
ni una función auxiliar. Una regla de dinero sacada de ahí es una hipótesis: primero se convierte en
prueba y después en código nuevo.

## ¿Cómo empezó Financy a partir de Seed?

Con un solo pull request, [financy#83](https://github.com/spy4x/financy/pull/83): los archivos de
Seed más los 19 que hacen de la copia Financy. Los conté comparando el primer commit de Financy con
el commit de Seed que tiene registrado:

```sh
git fetch https://github.com/spy4x/seed main
git diff --stat "$(git show 3d267c6f:.seed/commit)" 3d267c6f
```

Esos 19 archivos son: la licencia AGPL-3.0, con el aviso MIT de Seed en un archivo aparte; un README
que dice claramente que la app aún no está lista; el `AGENTS.md` de Financy, las reglas que sigue
cada agente y cada persona que trabaja en él; los documentos del producto; el nombre de imagen del
pipeline de releases, para que una etiqueta de Financy nunca sobrescriba las imágenes de Seed; la
eliminación de los cuatro archivos cifrados de configuración del servidor de Seed; y los dos
archivos que hacen posible sincronizar.

Esos dos son todo el truco. `.seed/commit` guarda el commit de Seed al que corresponde la copia, y
`.seed/skip` lista las rutas de Seed cuyos cambios Financy nunca acepta, como su README. Sincronizar
es entonces un `git diff` desde ese commit hasta el `main` actual de Seed, aplicado con una fusión a
tres bandas. La receta completa está en
[Start a product from Seed and keep getting its updates](/blog/start-a-product-from-seed-and-keep-its-updates)
(en inglés); este post cuenta qué pasó al seguirla de verdad.

## ¿Funcionó de verdad la primera sincronización?

Sí, y con una pequeña trampa puesta a propósito. Antes de sincronizar, Financy ya había cambiado
archivos de Seed: [financy#123](https://github.com/spy4x/financy/pull/123) le dio su nombre, un
icono de cartera y su propio azul en lugar del violeta de Seed, en 32 archivos. Una sincronización
que solo funciona sobre una copia intacta no demostraría nada.

Después, [financy#127](https://github.com/spy4x/financy/pull/127) llevó Seed de `ec61062b` a
`d9641f03`. Son 19 pull requests de Seed y 616 archivos cambiados, y `git apply --3way` los aplicó
sin ningún conflicto. Entre lo que llegó:

- iniciar sesión con un código enviado por correo;
- un precio anual junto al mensual;
- una zona horaria para todo el grupo;
- la API y el worker funcionando en Node y Bun además de Deno;
- un ajuste para decidir dónde empieza el changelog de un producto.

La sincronización también mostró un paso que el producto hace a mano. Seed acababa de añadir
`AGENTS.seed.md`, las reglas del propio repositorio de Seed; Financy lo borró y lo añadió a
`.seed/skip` para que ninguna sincronización posterior lo devuelva. Tras sincronizar, Financy se
diferencia de Seed en 59 archivos, y todos son archivos que Financy cambió a propósito.

## ¿Qué va a Seed en lugar de a Financy?

Todo lo que necesitaría cualquier SaaS. El `AGENTS.md` de Financy marca el orden: el código que
serviría a cualquier proyecto va a las librerías compartidas `@spy4x/*`, el que necesitaría
cualquier producto hecho con Seed va a Seed, y solo lo propio de un producto de finanzas (cuentas,
transacciones, presupuestos, tipos de cambio) se queda en Financy. Nada de parches locales «para
moverlos luego»: «luego» es como un fork se aleja.

Tres puntos de la lista de arriba son exactamente eso. Financy necesita cobro anual, el mes de un
hogar necesita una sola zona horaria para todos sus miembros, y su changelog no debe empezar con
años de commits de la app vieja. Nada de eso es sobre dinero, así que cada uno se construyó en Seed
y llegó a Financy con la sincronización. El 3 y el 4 de noviembre se abrieron en Seed 31
issues nuevas que mencionan Financy, y el 5 de noviembre 8 ya estaban cerradas.

La reconstrucción también encontró agujeros en mi propia receta. La lista de lo que un producto
quita de la web de Seed se saltaba varios archivos, y el paso 1 registraba el commit más reciente
de Seed, que puede ser más nuevo que la copia, así que la primera sincronización se saltaría en
silencio los commits intermedios. Ambos están corregidos en Seed
([seed#811](https://github.com/spy4x/seed/pull/811)), y la [guía](/es/docs/products) explica ahora
cómo encontrar el commit cuyos archivos coinciden con los tuyos. Ese arreglo te sirve más a ti
que a mí: el próximo producto hecho con Seed ya no tropezará con él.

## ¿Qué falta?

Casi todo. Mientras escribo esto, Financy es Seed con el nombre, la licencia y el color de Financy.
Todavía no hay pantallas de cuentas, transacciones ni presupuestos, así que no intentes usarlo aún.
Ni siquiera el nombre está decidido:
[financy#126](https://github.com/spy4x/financy/issues/126) pregunta si mantenerlo antes del
lanzamiento.

El plan es público: [las issues de Financy](https://github.com/spy4x/financy/issues), agrupadas en
siete hitos, desde los cimientos hasta el lanzamiento y lo que viene después. Cada hueco que
encuentren en Seed se arregla en Seed, así que esta serie mostrará las dos caras: lo que Financy
necesitó y lo que Seed aprendió de ello.

## Síguelo de cerca

[Sigue el repositorio de Financy](https://github.com/spy4x/financy) (botón Watch) para ver llegar
cada pull request, y suscríbete a este blog para recibir la parte 2 por correo. Si estás a punto de
empezar tu propio producto, [la guía](/es/docs/products) es la misma que sigue Financy, y si algún
paso te falla, [abre una issue](https://github.com/spy4x/seed/issues): significa que a la receta le
falta una línea.
