---
slug: copias-de-seguridad-y-restauracion-saas-autoalojado
language: es
translationOf: self-hosted-saas-backup-and-restore
title: "Copias de seguridad de un SaaS autoalojado, y cómo demostrar que la restauración funciona"
seoTitle: "Copias de seguridad de un SaaS autoalojado: Postgres y restauración"
description: Cómo hacer copias de un SaaS autoalojado (base de datos, archivos, claves) fuera del servidor y probar la restauración antes de necesitarla.
tldr:
  - Guarda la base de datos, los archivos subidos y toda clave que solo existe en el servidor en un bucket de otro proveedor.
  - Una copia solo se demuestra restaurándola. Ensaya una restauración en una base de repuesto; en Seed son cuatro comandos.
  - Seed guarda cada día un pg_dump, los archivos y las claves de notificaciones push con restic, y avisa cuando la última copia tiene dos días.
  - No tiene recuperación a un punto en el tiempo, así que se puede perder hasta un día de escrituras, y no verifica por sí solo los datos guardados.
topic: Guías
intro: "Un SaaS en tu propio servidor sale barato hasta que muere el disco. Aquí va qué copiar, dónde guardarlo y cómo demostrar que la restauración funciona, con la copia que trae Seed como ejemplo."
relatedFeature: deploy
coverAlt: "Una planta violeta crece de una torre de servidor en una isla pequeña y, en otra isla al otro lado del agua, un frasco de cristal cerrado guarda un esqueje de la misma planta junto a una maceta donde lo están trasplantando."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-08T09:00:00Z
newsletter: true
devto: false
---

Para hacer copias de seguridad de un SaaS autoalojado, guarda cada día tres cosas en un
almacenamiento de otro proveedor: un volcado de la base de datos, los archivos que subieron tus
usuarios y cada clave que solo existe en el servidor. Cifra la copia, guarda su contraseña fuera del
servidor y haz que te avisen cuando una ejecución falle. Después viene lo que casi todos se saltan:
restaura una copia en una base de repuesto y comprueba que las tablas están. Hasta que lo hagas,
tienes una carpeta llena de esperanza.

Un servidor de precio fijo es toda la idea de Seed, y lo que frena a la gente para autoalojar es el
miedo a perder los datos. Por eso este post trata de la copia que trae Seed: qué guarda, cómo
ensayar la restauración y, con la misma claridad, lo que no hace. Los comandos salen de la
[guía de copias de seguridad](/es/docs/backups) y de la
[guía de restauración](/es/docs/restore).

## ¿Qué tiene que copiar un SaaS autoalojado?

Todo lo que no puedes reconstruir desde git. Esta es la lista de Seed, de
[docs/backups.md](/es/docs/backups):

| Qué                                             | ¿En la copia? | Por qué                                                                        |
| ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| La base Postgres, como `pg_dump`                | Sí            | Cuentas, grupos y todo lo que crearon los usuarios.                            |
| Los archivos subidos (Garage incluido)          | Sí            | Sus bloques de datos y las dos copias horarias más recientes de sus metadatos. |
| Las claves de notificaciones push, `vapid.json` | Sí            | Solo existen en el servidor; sin ellas dejan de llegar los push.               |
| Valkey                                          | No            | Es una caché; se vuelve a llenar sola.                                         |
| El archivo de entorno de producción             | No            | Contiene las claves de la propia copia. Guarda tu copia aparte.                |
| Archivos en otro almacenamiento S3              | No            | Los cubren las copias de ese almacenamiento.                                   |

El archivo de entorno es el que más se olvida. Lleva la clave del almacén de archivos y la
contraseña de la copia, así que una copia que lo incluyera daría ambas a quien la leyera. Guárdalo
en tu gestor de contraseñas o cifrado en git, pero no solo en el servidor.

## ¿Dónde deben vivir las copias?

No en el mismo servidor, y mejor no en el mismo proveedor. Una copia en el disco que murió no es una
copia, y una copia en la misma cuenta cae con una cuenta bloqueada. La copia de Seed escribe en
cualquier bucket compatible con S3. El
[post sobre el despliegue](/blog/deploy-saas-to-one-hetzner-server) calcula el coste con Hetzner
Object Storage, que está fuera del servidor; un bucket en un segundo proveedor sobrevive además a
los problemas con el primero.

Tres ajustes importan más que el proveedor:

1. **Una clave solo para ese bucket**, que pueda leer, escribir y borrar ahí y en ningún otro sitio.
2. **Versionado u object lock en el bucket**, si el proveedor lo tiene. La clave está en el
   servidor, y quien se haga con el servidor podría borrar también las copias. Este ajuste convierte
   «me borraron el servidor» en una mala tarde y no en una empresa cerrada.
3. **La contraseña del repositorio fuera del servidor.** Sin ella no se puede leer ninguna
   instantánea, ni un atacante ni tú.

## ¿Cómo hace Seed la copia?

Con `backup` en `COMPOSE_PROFILES`, un contenedor `backup` se ejecuta una vez al arrancar y luego
cada 24 horas
([infra/backup/backup.sh](https://github.com/spy4x/seed/blob/main/infra/backup/backup.sh)). Guarda
en un repositorio de [restic](https://restic.net), que cifra cada instantánea y solo transfiere lo
que cambió desde la anterior.

Unas cuantas decisiones de ese script marcan la diferencia entre una copia y un archivo que lo
parece:

- **restic lanza `pg_dump` él mismo** y no guarda nada si `pg_dump` falla, así que un volcado
  cortado a medias nunca se convierte en instantánea. `pg_dump` exporta de forma consistente
  mientras la app sigue leyendo y escribiendo, y no bloquea a otros usuarios
  ([documentación de Postgres](https://www.postgresql.org/docs/current/app-pgdump.html)), así que
  la app no se para.
- **El volcado usa la versión de Postgres del propio servidor.** La imagen de la copia se construye
  sobre la imagen de la base
  ([infra/backup/Dockerfile](https://github.com/spy4x/seed/blob/main/infra/backup/Dockerfile)), así
  que `pg_dump` y `pg_restore` nunca van por detrás del servidor.
- **El volcado no se comprime.** Comprime restic, y solo encuentra lo que no cambió en datos sin
  comprimir, así que el volcado diario de una base que apenas cambia ocupa poco.
- **Las instantáneas viejas se van aclarando.** Se quedan todas las de los últimos dos días, luego
  una por día durante una semana, una por semana durante un mes y una por mes durante medio año
  ([`forget` de restic](https://restic.readthedocs.io/en/stable/060_forget.html)).
- **Una ejecución interrumpida recoge lo suyo.** Un reinicio o el OOM killer pueden dejar un
  bloqueo de restic; cada ejecución quita primero los bloqueos caducados, y la que encuentra uno
  vivo lo vuelve a intentar en una hora.

Activarla es el perfil `backup` y cuatro variables en el archivo de entorno, y luego un despliegue. El perfil está apagado
hasta que lo configuras, así que un producto nuevo no tiene copia hasta entonces.

## ¿Cómo sabes que la copia sigue funcionando?

Una copia que se paró en marzo se descubre en junio, el día que la necesitas. Seed lo avisa de tres
maneras:

- `docker ps` muestra el contenedor de la copia como unhealthy cuando la última copia completa tiene
  más de dos días.
- La alerta `BackupMissing`
  ([infra/configs/alerts.yml](https://github.com/spy4x/seed/blob/main/infra/configs/alerts.yml))
  manda el mismo aviso a ntfy.
- La página System del panel de administración avisa cuando la última copia tiene 26 horas y muestra
  un error a partir de 48
  ([libs/domain/identity/admin-system.ts](https://github.com/spy4x/seed/blob/main/libs/domain/identity/admin-system.ts)).

El log dice la causa: una contraseña o clave equivocada, un bloqueo o un repositorio que no
responde.

## ¿Cómo demuestras que la restauración funciona?

Restaurando. No todo el servidor: una instantánea en una base de repuesto, al lado de la real,
mientras la app sigue en marcha. En Seed, en el servidor y en la carpeta de la app (`<db>` es tu
`DB_NAME`):

```sh
deno task compose exec db psql -d postgres -c 'CREATE DATABASE "<db>_restore_test"'
deno task compose run --rm backup restore
deno task compose run --rm -e PGDATABASE=<db>_restore_test backup restore <snapshot id>
deno task compose exec db psql -d <db>_restore_test -c '\dt'
```

La segunda línea lista las instantáneas y no cambia nada; la tercera carga la que indicas. La lista
de tablas debe coincidir con la de la base real. Después borra la base de repuesto. Son unos
minutos, y a partir de ahí «tenemos copias» es un hecho y no una sensación.

Hazlo una vez al activar la copia, y otra vez tras cualquier cambio grande: una versión nueva de
Postgres, un bucket nuevo, una contraseña nueva.

Seed también prueba el propio script. `deno task test:backup` y el paso `backup-restore` de la CI,
en cada pull request, copian una base con el script real, la restauran en una vacía y comparan las
filas
([infra/backup/restore.test.sh](https://github.com/spy4x/seed/blob/main/infra/backup/restore.test.sh)).
La misma prueba mata una ejecución a medias y comprueba que la siguiente sale bien, y mantiene
separados dos proyectos que comparten repositorio. Eso demuestra el script; tu bucket, tu clave y tu
contraseña solo los demuestra tu propio ensayo.

## ¿Cómo se restaura de verdad?

Despacio y sin sobrescribir nada. Todos los comandos están en la
[guía de restauración](/es/docs/restore); estas son las ideas detrás:

1. **Aparta la base dañada, nunca escribas encima.** Para la app, renombra la base y crea una vacía.
   La restauración rechaza una base con tablas, para que nunca se mezclen dos estados.
2. **Elige la instantánea por su fecha.** La más reciente no siempre es la buena: una instantánea
   hecha después del daño contiene el daño. Por eso `restore` no tiene valor por defecto y dice qué
   instantánea y de qué hora antes de cargar nada.
3. **Cárgala en una sola transacción.** Una restauración que falla a medias deja una base vacía, no
   medio llena (`pg_restore --single-transaction`,
   [documentación de Postgres](https://www.postgresql.org/docs/current/app-pgrestore.html)).
4. **Reinicia la caché y luego la app.** Las migraciones más nuevas que la instantánea se aplican
   como en cualquier arranque.
5. **Trae los archivos de la misma noche** que la base.

En un servidor nuevo, deja la copia apagada hasta terminar la restauración. Si no, el servidor nuevo
guarda cada día su base vacía en el mismo repositorio, y tras siete ejecuciones la limpieza empieza a
borrar las instantáneas del servidor viejo. Prefiero que lo leas aquí a que lo descubras tú.

## ¿Qué no hace la copia de Seed?

- **No hay recuperación a un punto en el tiempo.** Es un volcado al día, así que un fallo puede
  costar hasta un día de escrituras. Seed no archiva el WAL; si una hora de pedidos perdidos es
  demasiado para tu producto, eso lo necesitas aparte.
- **No relee por sí sola los datos guardados.** `restic check` verifica la estructura del
  repositorio y `--read-data` lee cada pack guardado
  ([documentación de restic](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)),
  pero el script no ejecuta ninguno de los dos. Puedes lanzarlo a mano:
  `deno task compose run --rm backup restic check --read-data-subset=10%`.
- **No ensaya la restauración por ti.** La CI prueba el script, no tu bucket.
- **No guarda el archivo de entorno**, a propósito, y no escribe por SSH: el repositorio tiene que
  ser un bucket S3.
- **Está apagada hasta que la enciendes.**

Es seguridad cotidiana y honesta para un servidor, no la de un banco. Para la mayoría de los
productos es la medida justa: el hueco peligroso rara vez es la hora perdida, sino la copia que nadie
restauró nunca.

## Te toca

Si ya tienes Seed en marcha, ensaya una restauración hoy: cuatro comandos, unos minutos. Si aún estás
eligiendo dónde alojarlo, empieza por
[cómo instalar Seed y ejecutarlo en local](/blog/install-seed-and-run-it-locally), luego
[llévalo a un servidor de Hetzner](/blog/deploy-saas-to-one-hetzner-server) y activa la copia en la
misma sesión. ¿Algo de las guías no está claro?
[Abre un issue](https://github.com/spy4x/seed/issues) y lo arreglo.
