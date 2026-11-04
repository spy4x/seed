---
slug: saas-multiinquilino-grupos-roles-postgres
language: es
translationOf: multi-tenant-saas-groups-roles-postgres
title: "SaaS multiinquilino: grupos, roles y comprobación de permisos en Postgres"
seoTitle: "SaaS multiinquilino en Postgres: grupos, roles y permisos"
description: "Cómo Seed separa a sus inquilinos en una sola base de datos Postgres: un id de grupo en cada fila, cuatro roles fijos, el rol comprobado en cada handler y releído con bloqueo en cada escritura."
tldr:
  - "En Seed el inquilino es un grupo. Cada fila lleva un group_id, y el acceso de una persona es una fila en group_members con un rol del 1 al 4."
  - "Quién puede hacer qué es un conjunto de funciones puras pequeñas. Cada handler lee el rol y llama a una; el WebSocket y HTTP comparten los mismos handlers."
  - "Cada escritura vuelve a leer el rol dentro de su transacción, con un bloqueo, así que alguien a quien acaban de quitar no puede colar una última escritura."
  - "No hay row-level security. Un desconocido recibe 404, nunca 403, y hay tests que comprueban que un grupo nunca ve los datos de otro."
topic: A fondo
intro: "Todo SaaS con equipos responde a la misma pregunta en cada petición: ¿puede esta persona tocar esta fila? Así la responde Seed en una sola base de datos Postgres, con el código real, y con el único punto en que cambia seguridad por sencillez."
coverAlt: "Un invernadero dividido en salas de cristal, cada una con sus plantas y su puerta violeta, con una llave colgada junto a cada puerta."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

¿Cómo se construye un SaaS multiinquilino (multi-tenant) sobre Postgres para que un equipo nunca vea
los datos de otro? En Seed, el inquilino es un **grupo**. Cada fila que pertenece a un inquilino
lleva un `group_id`, el acceso de una persona es una fila en `group_members` con un rol, y cada
petición comprueba ese rol en el código antes de leer o escribir. Las escrituras lo comprueban dos
veces: en el handler y otra vez dentro de su propia transacción, con un bloqueo. Una base de datos
compartida, un esquema, sin row-level security.

Este artículo es para quien construye un producto para equipos y quiere ver una respuesta completa
que funciona, no un diagrama. Todo está en el [código de Seed](https://github.com/spy4x/seed), con
licencia MIT, y los fragmentos son las líneas reales, algo recortadas.

## ¿Qué es un inquilino en Seed?

Un grupo. No hay un tipo «personal» aparte: al registrarte se crea un grupo normal llamado
«Personal», contigo como único miembro. Así, un usuario solo y un equipo de 50 pasan por el mismo
código, y no hay que migrar nada cuando alguien invita a un compañero. Una persona puede estar en
todos los grupos que quiera.

La pertenencia es una tabla
([la migración](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)):

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

Postgres guarda dos reglas por sí mismo: un rol va del 1 al 4, y un índice único parcial permite
exactamente un propietario por grupo. Una transferencia de propiedad degrada al antiguo propietario
antes de ascender al nuevo, en una transacción, porque ese índice no admite dos propietarios ni por
un instante. Cada fila de una funcionalidad (una nota, una etiqueta, un archivo) tiene su propia
columna `group_id`.

## ¿Qué roles hay y qué puede hacer cada uno?

Cuatro, fijos y ordenados: viewer (1), editor (2), admin (3), owner (4). Al estar ordenados, casi
todas las reglas son una comparación: «editor o superior» es `role >= 2`.

| Qué                                             | Viewer | Editor | Admin | Owner |
| ----------------------------------------------- | ------ | ------ | ----- | ----- |
| Leer las notas del grupo                        | sí     | sí     | sí    | sí    |
| Crear, editar y borrar notas                    | no     | sí     | sí    | sí    |
| Invitar como viewer o editor                    | no     | no     | sí    | sí    |
| Renombrar el grupo, ver el correo de miembros   | no     | no     | sí    | sí    |
| Hacer admin a alguien                           | no     | no     | no    | sí    |
| Pagar, borrar el grupo, transferir la propiedad | no     | no     | no    | sí    |

Un admin gestiona viewers y editores, nunca a otro admin, y nadie salvo el propietario toca al
propietario. En el plan Free, una invitación solo añade viewers: dar otros roles es lo que vende el
plan de pago. Más abajo explico cómo se mantienen separados plan y rol.

## ¿Dónde vive la comprobación de permisos?

En funciones puras pequeñas de la librería de dominio, una por pregunta
([`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)). La más
difícil, quién puede cambiar el rol de quién, es la más larga:

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

Sin base de datos, sin petición, sin framework: un test unitario la llama con todas las
combinaciones de roles. Un handler lee el rol de quien actúa y lo pasa a la comprobación que toca
antes de llamar al repositorio:

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

Los transportes no tienen ninguna regla. Una llamada llega por WebSocket o como
`POST /api/call/<name>`, las dos llegan al mismo handler y reciben la misma respuesta. Eso permite
que [el tiempo real recurra a HTTP](/blog/realtime-websocket-with-http-fallback) sin un segundo
juego de comprobaciones que mantener al día.

## ¿Por qué comprobar el rol dos veces?

Porque un rol leído antes de escribir puede estar caducado cuando la escritura se confirma.
Imagínalo: el propietario quita a un editor en el mismo instante en que el editor guarda una nota.
El handler leyó «editor» hace un milisegundo, la eliminación se confirma y la nota acaba en un grupo
al que su autor ya no pertenece.

Por eso cada escritura en un grupo llama primero a `lockActorRole`, dentro de su propia transacción
([`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)):

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

La fila del grupo se bloquea primero, en el mismo orden que usa cualquier cambio de miembros, así
que las dos operaciones se esperan en vez de bloquearse mutuamente. La fila de pertenencia se lee
`FOR SHARE`: una eliminación confirmada antes se ve, y una posterior espera a que termine la
escritura. Luego el repositorio comprueba el rol recibido, así que la segunda comprobación cuesta una
lectura por índice en una transacción que ya estaba abierta.

Un test lo demuestra para cada tipo de escritura de notas: mantiene abierta una eliminación o una
degradación, lanza la escritura, ve que espera, confirma el cambio y espera que la escritura se
rechace sin guardar nada («note update: refused when a removal commits while the write waits», en
`tests/integration/group-write-race.integration.test.ts`).

## ¿Por qué un desconocido recibe 404 y no 403?

Porque un 403 dice «este grupo existe, pero no es para ti». Quien no es miembro recibe
`GROUP_NOT_FOUND`, exactamente lo mismo que un grupo que nunca existió, así que nadie puede probar
ids para saber cuáles son reales. Un miembro sin el rol necesario recibe 403 `ROLE_INSUFFICIENT`,
porque ya sabe que el grupo existe.

El plan sigue la misma idea. Cuando un grupo llega al límite de su plan, la respuesta es **402
Payment Required**, no 403, para que la app distinga «pide al propietario que mejore el plan» de «no
tienes el rol». El rol decide quién puede actuar; el plan, cuánto recibe el grupo. La facturación
por asientos y sus webhooks tienen [su propio artículo](/es/blog/facturacion-por-usuario-stripe-webhooks).

## ¿Por qué no row-level security de Postgres?

La consideré y dejé escrito el compromiso en el
[diseño de sincronización de grupos](https://github.com/spy4x/seed/blob/main/docs/design/group-sync.md#9-tradeoffs).
La row-level security pondría una segunda copia de las reglas de permisos en la base de datos, en
políticas SQL, junto a la copia que los handlers necesitan igualmente para responder «eres viewer»
con un error útil. Dos copias de una regla acaban divergiendo. Además, cada conexión tendría que
llevar a la persona actual, lo que complica el pool de conexiones, las tareas en segundo plano y las
migraciones.

El coste honesto: con filtros en el código, una consulta que olvide `group_id` puede filtrar datos.
Seed responde de tres formas:

- **Firmas con el grupo.** Un método del repositorio recibe el id del grupo como argumento, como
  `get(groupId, id)`, y su consulta filtra por los dos. No existe un «obtener nota por id» que usar
  mal.
- **Una lista de reglas para cada funcionalidad.** [docs/aggregates.md](/es/docs/aggregates) recoge
  lo que copia una funcionalidad nueva: vive en un grupo, cada fila tiene `group_id` y cada escritura
  vuelve a leer el rol.
- **Tests entre grupos.** Los tests de integración corren contra un Postgres real con un desconocido
  en su propio grupo, en pasos como «never counts a note of another group» y «a person who is not a
  member is told the group does not exist».

Si tu producto necesita una garantía a nivel de base de datos, por ejemplo para una auditoría de
cumplimiento, la row-level security es una buena opción y puedes añadirla encima. Para una
plantilla de inicio, elegí un solo lugar para las reglas.

## ¿Qué no hace Seed?

- **No hay roles personalizados.** Cuatro roles fijos. Un producto que necesite «gestor de
  facturación» añade un rol y sus comprobaciones.
- **No hay permisos por registro.** Un rol vale para todo el grupo; no puedes compartir una nota con
  una sola persona.
- **No hay row-level security**, como ya expliqué.
- **No hay un esquema ni una base de datos por inquilino.** Todos los grupos comparten las tablas.

## Pruébalo

Abre la [demo](https://app.seedsaas.com), crea un grupo, invita a una segunda cuenta como viewer e
intenta editar una nota desde ella. La versión corta está en la
[página de grupos](/es/features/groups), y [tu primera funcionalidad](/blog/your-first-feature-copy-the-notes-aggregate)
muestra cómo un tipo de registro nuevo hereda todo esto copiando el código de las notas. Si tu app
comprueba el rol una sola vez, antes de la transacción, esa es la carrera que yo cerraría primero.
