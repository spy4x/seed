---
slug: seed-funciona-en-deno-node-y-bun
language: es
translationOf: seed-runs-on-deno-node-and-bun
title: "Seed ya funciona en Deno, Node y Bun"
seoTitle: "Boilerplate SaaS para Node.js, Bun y Deno: Seed corre en los tres"
description: "El boilerplate SaaS gratuito Seed ya corre sin cambios en Deno, Node.js y Bun: cómo empezar en tu runtime, cambiar un producto y qué sigue pidiendo Deno."
tldr:
  - La API, el worker, la migración y la web de Seed arrancan sin cambios en Deno, Node y Bun, y la CI los prueba en los tres en cada pull request.
  - Una línea del archivo env, APP_RUNTIME=node o bun, cambia el runtime de tus servidores. Sin esa línea sigue Deno, así que un producto que no toca nada sigue funcionando.
  - La web pública dejó Fresh por una capa pequeña con las mismas rutas, páginas e islas. Cada página carga menos JavaScript.
  - Las tareas y los tests siguen en Deno; npm o Bun te lo instalan.
topic: Novedades
intro: "Seed ya no depende de un solo runtime. Sus servidores arrancan sin cambios en Deno, Node y Bun, y una línea del archivo env elige cuál. Esto es lo que significa para un producto nuevo y lo que tienes que hacer en uno que ya está en marcha."
coverAlt: "Un brote violeta en una maceta en lo alto de una colina, con tres caminos que suben hasta él: de losas, de tablones de madera y de grava."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-10T09:00:00Z
newsletter: true
---

Seed, el boilerplate SaaS gratuito, ya funciona en Deno, Node.js y Bun. La API, el worker en segundo
plano, la migración de la base de datos y la web pública arrancan en cada uno sin tocar el código, y
la CI levanta la API, el worker y la web en los tres en cada pull request. Una línea del archivo env
elige el runtime de los servidores de tu producto; si no la pones, todo sigue en Deno.

Este post sirve a dos personas: quien está eligiendo un starter y no quiere atar su producto a un
solo runtime, y quien ya tiene un producto sobre Seed y está a punto de recibir este cambio en una
sincronización. Cada sección responde a una cosa que puedes querer hacer. Cómo fue la migración, con
sus errores, lo cuento [en mi blog](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun)
(en inglés).

## ¿Cómo empiezo un producto nuevo en mi runtime?

El inicio rápido del README tiene ahora una sección por runtime:
[Node](https://github.com/spy4x/seed#node), [Bun](https://github.com/spy4x/seed#bun) y
[Deno](https://github.com/spy4x/seed#deno). Necesitas Docker y uno de los tres. Con Node:

```sh
npm install -g deno
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
npm run init
npm run dev
```

Sí, la primera línea instala Deno. Dejar Deno instalando Deno tiene más gracia de la que me
gustaría, pero las tareas de Seed todavía corren en él (lo explico abajo), y el paquete `deno` de npm
hace que una máquina con solo Node no necesite nada más. Con Bun, la primera línea es
`bun add -g deno` y las dos últimas, `bun run init` y `bun run dev`. La línea de `gh` es opcional: el
botón «Use this template» de GitHub y un clone hacen lo mismo.

Con eso tienes todo el stack en Docker sobre Deno. Para que también los servidores del producto
corran en Node o Bun, añade una línea a `infra/envs/.env` antes de `dev`:

```sh
APP_RUNTIME=node   # o bun; deno, vacío o sin la línea mantiene Deno
```

## ¿Qué corre en Node o Bun y qué cambia ahí?

Con `APP_RUNTIME=node` o `bun`, la API, el worker, la migración y la web corren en Node 26 o Bun 1.4,
cada uno desde su propia imagen Docker. Los puertos, las variables de entorno y el orden de los
servicios no cambian. La SPA y el panel de administración son archivos estáticos, así que les da
igual. La lista completa está en [la sección de runtime de la documentación](/es/docs/apps#runtime).

Hay tres diferencias con Deno que conviene conocer antes de cambiar:

- **Sin modo watch.** El código se empaqueta dentro de la imagen, así que en Node o Bun un cambio
  solo se ve tras reconstruirla, también en desarrollo. El desarrollo con recarga en caliente se
  queda en Deno.
- **Sin permisos de runtime para el worker.** En Deno el worker solo puede leer y escribir su
  carpeta de imágenes y solo puede ejecutar `vips`. Node y Bun no tienen esos límites: allí al worker
  solo lo limitan su contenedor y su usuario sin privilegios de root.
- **Lo eliges tú.** Sin la línea, con la línea vacía o con `deno`, todo sigue en Deno.

## Ya tengo un producto sobre Seed. ¿Qué hago?

Recibe el cambio como siempre, según [la guía de productos](/es/docs/products): trae Seed, aplica el
parche y guarda el commit:

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

Después ejecuta `deno task check` antes de abrir el pull request. Probé esta sincronización sobre
una copia de Seed de justo antes del cambio de runtime y el parche entró sin un solo conflicto. Tu
producto puede tenerlos donde cambiaste archivos de Seed a propósito: ahí quédate con tu versión,
como dice la guía.

La sincronización añade las imágenes Docker de Node y Bun, los archivos de Compose que cambian a
ellas y un `package.json` en la raíz. No cambia el runtime que usas. Cuando quieras moverte, pon
`APP_RUNTIME=node` (o `bun`) en `infra/envs/.env` y reconstruye las imágenes:

```sh
deno task compose up -d --build
```

En el servidor, pon la misma línea en su archivo env y despliega como siempre
([actualizaciones](/es/docs/deploy-updates)): cada despliegue construye las imágenes que esa línea
indica.

## ¿Qué cambió en la web pública?

La web ya no corre sobre Fresh. Ahora usa
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server), una capa pequeña y de código abierto
que copia las rutas, páginas e islas de Fresh 2, así que el código de la web apenas cambió. Comparé
todas las rutas en las dos versiones: 419 de 423 respuestas fueron idénticas. Las cuatro distintas son
la fecha de modificación y el ETag de un vídeo, y una dirección mal formada que antes recibía un
error pelado y ahora recibe la página 404 de la web.

Además, las páginas pesan menos. JavaScript por página con gzip, medido con Lighthouse en móvil:

| Página                    | Capa nueva | Fresh   |
| ------------------------- | ---------- | ------- |
| Inicio                    | 24.0 KB    | 32.1 KB |
| Un post del blog con isla | 29.9 KB    | 38.0 KB |
| Documentación             | 8.6 KB     | 19.4 KB |

En el post con un deslizador interactivo, la página bloquea la entrada 5 ms, frente a 48 ms con
Fresh. Mi primera versión de la capa era más lenta que Fresh justo ahí, y la CI no se dio cuenta;
cómo lo descubrí está en [la historia completa](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun).

Si modificaste la web de tu producto, puede que tras la sincronización te quede algún archivo que
todavía importa Fresh. Búscalos desde la raíz del repositorio:

```sh
grep -rlE 'from "fresh' apps/mpa
```

Cambia cada import a `@spy4x/preact-server` (también los de `fresh/runtime`) y renombra
`FreshContext` a `Context`. La carpeta de build ahora es `dist`, no `_fresh`. Las páginas ya no
llevan scripts en línea, así que las cabeceras de seguridad no necesitan un nonce por petición. La
capa es una primera versión: lo que ofrece y lo que deja fuera está en
[su documentación](https://github.com/spy4x/seed/blob/main/docs/website-server.md).

## ¿Qué sigue necesitando Deno?

Las herramientas: formato, linter, comprobación de tipos, tests y los scripts de `deno task`. El
`package.json` de la raíz pasa las tareas habituales a Deno, así que `npm run test` y `bun run dev`
también funcionan. Los tests siguen en el test runner de Deno. Una revisión prevista para el 10 de
enero de 2027 decidirá si eso cambia
([la política de runtimes](https://github.com/spy4x/seed/blob/main/docs/runtime-policy.md)). Nada de
esto ata a Deno el runtime que usan tus usuarios.

## ¿Por qué Seed dejó de depender de Deno?

El 9 de octubre de 2026 el equipo de Deno [anunció](https://deno.com/blog/cloudflare) un año más de
correcciones de errores y de seguridad, tras el cual deja su propio desarrollo. Deno sigue siendo
código abierto, y me sigue gustando. Pero un starter sobre el que montas un negocio no debería
apostar tu producto a la hoja de ruta de un solo runtime, ni siquiera a la mía. Seed ya estaba hecho
con estándares web (Fetch, Web Crypto, WebSocket, módulos ES), así que lo difícil fue servir
archivos, los tipos de Deno en firmas públicas y la capa de la web, no reescribirlo todo.

Prueba [el inicio rápido](https://github.com/spy4x/seed#quick-start) en el runtime que ya usas. Si
falla algún paso, [abre un issue](https://github.com/spy4x/seed/issues) con lo que ejecutaste y lo
arreglo.
