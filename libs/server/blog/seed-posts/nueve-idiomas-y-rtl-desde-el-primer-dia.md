---
slug: nueve-idiomas-y-rtl-desde-el-primer-dia
language: es
translationOf: nine-languages-and-right-to-left-from-day-one
title: "Internacionalizar un SaaS desde el primer día: nueve idiomas y árabe de derecha a izquierda"
seoTitle: "Internacionalizar un SaaS: nueve idiomas y RTL desde el día uno"
description: "Cómo Seed sale en nueve idiomas desde el primer día, árabe de derecha a izquierda incluido, y qué pruebas impiden publicar un texto sin traducir o un margen que no se invierte."
tldr:
  - La app, el panel de administración, la web y los correos de Seed están en nueve idiomas, árabe incluido, con unos 3.900 mensajes en cada uno.
  - Una prueba rompe el build si falta un mensaje, está desactualizado o perdió un marcador. Otra rechaza un margen «izquierdo» o «derecho» que no se invertiría en árabe.
  - El idioma es un ajuste de cada persona, guardado en el servidor, y no va atado al formato de fecha, la zona horaria ni el reloj.
  - Añadir un décimo idioma es una entrada en una lista, un archivo por catálogo y unas pocas líneas de carga.
topic: A fondo
author: Anton Shubin
publishAt: 2026-11-02T20:00:00Z
newsletter: false
---

¿Cómo internacionalizas un SaaS, con árabe de derecha a izquierda incluido, sin tener que
reescribirlo después? Empezando desde la primera pantalla y dejando que las pruebas vigilen. Seed
sale en nueve idiomas: español, inglés, ruso, alemán, portugués de Brasil, árabe, francés, japonés
y chino simplificado. Eso vale para la app, el panel de administración, la web y los correos. En
árabe, todo el diseño se da la vuelta.

Esto es para fundadores y desarrolladores que saben que «ya lo traduciremos» significa «no lo
traduciremos nunca». Te enseño dónde viven los textos, qué atrapan las pruebas y cuánto cuesta de
verdad el RTL.

## ¿Por qué desde el primer día?

Porque traducir después obliga a pasar dos veces por cada pantalla. Hay que encontrar cada texto
metido a mano en el código, cada fecha armada a mano, cada `margin-left`, y todo eso en un código
que para entonces está lleno de funciones. Si traduces desde el principio, cada pantalla nueva se
traduce mientras se construye: unos minutos, no un proyecto que nadie quiere empezar.

Y hay una razón más sencilla: la mayoría de la gente en internet no lee primero en inglés. Un
producto que habla su idioma sale con ventaja.

## ¿Dónde viven los textos?

Cada palabra que muestran las pantallas de Seed está en un catálogo: un archivo TypeScript por
área e idioma, como `i18n/app/es.ts` o `i18n/site/ja.ts`. Son cinco áreas: la app, el panel, la
web, los correos y los mensajes de error de la API. El inglés es la fuente y los demás archivos
tienen las mismas claves.

| Área             | Mensajes por idioma |
| ---------------- | ------------------: |
| La app           |               1.503 |
| Panel de admin   |               1.487 |
| Web              |                 682 |
| Códigos de error |                 164 |
| Correos          |                  79 |

Son unos 3.900 mensajes por idioma, contados el 2 de noviembre de 2026. Los componentes de
preact-components traen además sus propios catálogos.

La app carga solo tu idioma, en un archivo pequeño aparte: quien lee en español no descarga el
japonés.

## ¿Qué impide que una traducción se quede vieja?

Una prueba, `i18n/i18n.test.ts`. Falla cuando:

- falta un mensaje en algún idioma, o sobra uno que el inglés ya no tiene;
- el inglés cambió después de traducirse (cada idioma guarda un archivo lock con la versión del
  inglés de la que salió su traducción);
- una traducción perdió o escribió mal un marcador como `{count}`, o una etiqueta alrededor de un
  enlace;
- a un plural le falta una forma que el idioma necesita. El árabe tiene seis formas;
- ningún código usa ya un mensaje en inglés.

Así no llega a producción un botón que dice `Notes.create`, ni una pantalla en alemán que va una
semana por detrás del inglés.

## ¿Qué cuesta de verdad el derecha a izquierda?

Menos de lo que parece, si el diseño nunca dice «izquierda» ni «derecha». Los estilos de Seed
usan lados lógicos: «inicio» y «fin». En una página de izquierda a derecha el inicio está a la
izquierda; en árabe, a la derecha. Le da la vuelta el navegador.

Una prueba lo convierte en regla: `tests/spacing.test.ts` recorre todas las apps y falla con
cualquier clase de espaciado que nombre un lado físico. La página pone `dir` según el idioma: la
web en el servidor y la app en el momento en que cambias de idioma.

Dos detalles más que muerden tarde si los saltas:

- **Nombres dentro de frases.** «Ana te invitó al grupo Team» mezcla direcciones en árabe, y un
  nombre en alfabeto latino puede arrastrar la puntuación al lado equivocado. Los valores de los
  usuarios van dentro de `<bdi>`, que aísla su dirección del resto.
- **Fechas, números y horas.** Toda fecha de toda pantalla pasa por un único formateador. Otra
  prueba, `tests/no-direct-date-format.test.ts`, falla con cualquier llamada directa a
  `toLocaleString()`.

## Idioma, formato regional y reloj son tres ajustes

El idioma se guarda en el servidor con el perfil, así que es el mismo en todos tus dispositivos y
en los correos. El formato regional, la zona horaria y el reloj de 12 o 24 horas son ajustes
aparte. Una mexicana que vive en Toronto quiere la app en español y la hora de Toronto. Un inglés
que vive en Madrid quiere textos en inglés y fechas como `03/11/2026`. Atar los tres es la forma
segura de mostrar la fecha mal a la mitad de tus usuarios.

En la web el idioma va en la dirección (`/es/pricing`, `/ar/pricing`), sin redirecciones por
navegador ni por IP, y cada página indica a los buscadores qué versiones existen.

## ¿Quién traduce?

Agentes de IA que siguen una guía escrita, `i18n/TRANSLATING.md`. Fija el tono de cada idioma (en
español, de tú), un glosario para que cada cosa tenga un solo nombre en todas las pantallas, y la
regla de traducir la situación y no las palabras. Un segundo agente vuelve a pasar cada traducción
nueva al inglés y compara el sentido. No es una agencia de traducción profesional, y no voy a
fingir que lo es. Pero es mucho mejor que una pantalla que nadie entiende.

## Añadir un décimo idioma

Una entrada en la lista de idiomas, un archivo de catálogo por área y unas pocas líneas en cada
app que lo cargan. Después, las pruebas listan todos los mensajes que le faltan al idioma nuevo y
siguen en rojo hasta que esté completo.

## Pruébalo

Abre la [demo](https://app.seedsaas.com), entra en tu perfil y cambia el idioma a árabe. Mira cómo
toda la app se da la vuelta y luego vuelve al español. Este artículo también está en los nueve
idiomas, y el [código](https://github.com/spy4x/seed) es MIT.
