# PROGRESO — tanda 5: HOTU deja de ser un CMS

La gente sube su contenido, la plataforma lo organiza, y el admin solo
modera. Los cuatro pasos están hechos.

**Producción está al día hasta `c98f129`.** Las DOS migraciones de esta
tanda están corridas y verificadas en main. Quedan **3 commits locales**
sin pushear — ver PARA LLEVARLO A PRODUCCIÓN, abajo.

Verificación: `npx tsc --noEmit` limpio después de cada pieza, y curl
contra `npm run dev`. Nunca se corrió `next build`.

---

## LOS CUATRO PASOS

**PASO 1 — cuentas dueñas.** `cbafe70`, `3a7b319`. Los 12 artistas y 6
colectivos sin dueño tienen una cuenta a su nombre, en `@perfil.hotu.local`
y **sin contraseña**: existen, son dueñas, y no pueden entrar hasta que
haya flujo de reclamo. Eso convierte "recuperar contraseña" en requisito,
no en pendiente anotado (ver más abajo).

**PASO 2 — los cuatro paneles.** `ad816b3`, `3224771`. `/perfil` se
parte en MI PERFIL · ARTISTA · COLECTIVO · VENUE. El panel que NO tenés
tampoco desaparece: es el único lugar donde alguien se entera de que
puede tenerlo.

**PASO 3 — el botón de publicar.** `709821a`, `11b2d5b`, `014ad86`,
`f27de44`, `a83b9a7`. El "+" ofrece lo que esa cuenta puede hacer y nada
más. Eventos salen publicados; noticias pasan por cola. Las convocatorias
quedaron FUERA a pedido tuyo: no existe el modelo.

**PASO 4 — el admin se vacía.** `5c19ff4`, `6b01acf`, `c98f129`,
`81f7ee1`, `a81edfd`, `cb9f78f`. Quedan tres colas (DJs, noticias,
lineups), censurar y banear. Se fueron `/admin/eventos`,
`/admin/colectivos`, `/admin/eventos-pasados` y `lib/db-write.ts` entero.

### Lo que hay que saber del paso 4

- **Censurar no reusa `status`.** Es una marca propia que solo pone y
  saca un moderador. Si ocultar fuera `status='draft'`, el autor lo
  leería como borrador suyo y lo republicaría sin enterarse.
- **El ban se deriva, no se copia.** Banear escribe UNA fila. Que el
  perfil y sus piezas dejen de verse lo calculan las lecturas.
- **Un moderador no banea a otro moderador ni a sí mismo.** Sacar un rol
  es de ROLES, que es de un SUPER_ADMIN.
- **El rol MODERATOR existe** porque antes la única forma de dar acceso
  al panel era hacer a alguien SUPER_ADMIN — o sea, darle también los
  roles y la plata de PEDIDOS.
- **El admin no edita NADA.** Su única palanca sobre un evento o una
  noticia ajena es censurar: bajarla del sitio, con motivo, reversible,
  sin borrar nada. Ese es el estado "archivado".

---

## PARA LLEVARLO A PRODUCCIÓN

**Las dos migraciones ya están corridas en main y verificadas.** No queda
ninguna pendiente.

Falta **un push**, de `c98f129` a `cb9f78f` (3 commits): los filtros de
lectura, el admin vaciado, y el editor de eventos del organizador.

    git push origin cb9f78f:main

**No necesita migración previa**: las columnas que ese código lee ya
están en main desde `setup-moderation`.

### Qué mirar cuando el deploy esté arriba

1. `/api/events/1` con DELETE y sin sesión tiene que dar **401**, no 404.
   Eso prueba que el código nuevo está desplegado sin preguntarle nada a
   la base.
2. `/admin/eventos`, `/admin/colectivos` y `/admin/eventos-pasados`
   tienen que dar **404**.
3. `/admin/moderacion` y `/admin/lineups` tienen que **abrir**.
4. Las nueve páginas públicas en **200**.
5. En `/admin`, las tres colas con sus números. Lineups va a marcar
   varios: los eventos viejos nunca se revisaron.

---

## PARA §8 — DECIDIR, NO ASUMIR

**Borrar un colectivo permanentemente ya no lo puede hacer nadie.**

`/admin/colectivos` era el único lugar que exponía `deleteCollective`, y
se fue con el CMS en el paso 4. Lo encontró el tester.

Qué SÍ está cubierto: esconder un colectivo problemático. Eso es la
censura — con motivo, reversible, sin borrar nada.

Qué NO: borrar de verdad uno espurio o duplicado. Hoy no lo puede hacer
ni un SUPER_ADMIN desde la UI.

Las dos salidas contradicen algo, y por eso no se eligió sola:

- **Devolvérselo al admin** contradice "el admin no es un perfil
  interactuable": borrar contenido ajeno es interactuar con él.
- **Dárselo al dueño** es una pieza nueva, con sus propias guardas —
  `deleteCollective` se negaba por noticias publicadas, por eventos
  organizados y por `content_placements`, y todo eso habría que
  reconstruirlo en el camino del dueño.

Mientras tanto no bloquea nada: un colectivo mal creado se puede
RENOMBRAR (el nombre es editable desde el panel), así que nadie queda
encerrado por el "uno por cuenta".

---

## PARA §8 — EL TOGGLE `featured`, INERTE

Vivía solo en las páginas del admin que se borraron. Verificado por el
tester: `featured` ya no se lee en ninguna parte de la UI, solo existe
en `lib/db.ts`. La pérdida no la nota nadie porque la función ya no
hacía nada. Queda anotado para cuando se decida si destacar algo en la
home vuelve a existir, y de qué forma.

---

## LO PRIMERO QUE TENÉS QUE HACER EN PRODUCCIÓN

**Date el rol MODERATOR a vos mismo no hace falta** — sos SUPER_ADMIN y
`isModerator` te incluye. Pero si querés sumar a alguien a moderar,
ahora se puede sin darle las llaves de todo: `/admin/roles`, rol
MODERADOR.

---

# ================================================================
# DE ACÁ PARA ABAJO: TANDA 4, YA EN PRODUCCIÓN
# ================================================================
#
# Se deja como histórico y porque varias secciones siguen vigentes
# (los datos que esperan tu mano, lo que falta modelo, lo bloqueado).
#
# PERO OJO CON DOS COSAS QUE YA NO APLICAN:
#
#   - "LLEVARLO A PRODUCCIÓN" de abajo son los pushes de la tanda 4.
#     Ya están hechos. El push que falta es el de arriba.
#   - "MIGRACIÓN PENDIENTE EN MAIN — TANDA-3 §7" YA SE CORRIÓ.
#     Verificado: /artistas/groove-norte responde 200 en producción, y
#     esa página consulta event_lineup para armar los toques. Si la
#     tabla no estuviera, daría 500.
#
# ================================================================

## LO QUE QUEDÓ HECHO

**Los dos agentes** (`.claude/agents/`). El `migration-reviewer` auditó un
arreglo mío y encontró que abría un agujero peor que el que cerraba. El
`tester` encontró que `address` y `capacity` eran columnas muertas.

**La taxonomía completa.** 34 branches, 719 tags, 50 cross-tags, 6 alias.
`GENEROS.md` es la fuente de verdad y `lib/genre-taxonomy.ts` se genera
desde él con `node scripts/genre-taxonomy-from-md.mjs`.

**Venues** (tanda 3 §5), compartiendo tabla con colectivos vía
`entity_kind`, con los once puntos de contacto y los dos bugs silenciosos
que traía: `createCollective` contaba venues para el "uno por cuenta", y
nada impedía poner la casa de un DJ en un venue.

**El alta de DJ completa** (ALTA-DJ.md), en seis pasos:

| | |
|---|---|
| Migración | `district` con default, `status` a `draft`, cinco columnas de revisión, dos CHECK |
| `/auth/registro` | crear cuenta con email y contraseña, que antes era imposible |
| Alta de DJ | dos pasos, una sola escritura al final, nace en borrador |
| Visibilidad | el dueño y un SUPER_ADMIN ven el borrador, el resto recibe 404 |
| Franja | qué falta, enviar a revisión, y el motivo del rechazo ahí mismo |
| `/admin/artistas` | la cola, con todo para decidir de un vistazo |

Tres reglas nuevas en AGENTS.md, todas salidas de errores reales: los
swaps de constraint van en transacción, un renombre no actualiza sino que
inserta, y un solo dev server (con `npm run dev` que ahora se protege).

---

## LLEVARLO A PRODUCCIÓN

**Cuatro migraciones y tres pushes.** El orden importa y no es opcional:
dos de los cortes evitan que páginas públicas tiren 500.

### Push 1 — hasta `63fb632`

```
git push origin 63fb632:main
```

Lleva las tres primeras rutas de migración y **nada que dependa de
ellas**. Verifiqué que ninguna página lee `entity_kind`, las tablas de
género ni `review_status` en ese punto.

**Después de que despliegue, corré 1 y 2.** No corras `seed-genres`
todavía: en este commit el archivo de taxonomía está vacío y escribiría
cero branches.

### Migración 1 — `/api/setup-genres`

Las diez tablas de la taxonomía. No toca ninguna tabla existente.

```
https://hotu-one.vercel.app/api/setup-genres?secret=TU_SECRET&dryRun=1
https://hotu-one.vercel.app/api/setup-genres?secret=TU_SECRET
https://hotu-one.vercel.app/api/setup-genres?secret=TU_SECRET
```

- **dryRun:** `seCrearian` con las diez tablas y `estado.tablas` vacío. Si
  lista menos de diez hay algo preexistente: mirá `forma` antes de seguir.
- **Real:** once líneas de log. En `estado.forma`, los cuatro índices que
  importan: `artist_genres_one_primary_idx`,
  `collective_genres_one_primary_idx`,
  `artist_genre_tags_one_per_tag_idx`,
  `collective_genre_tags_one_per_tag_idx`.
- **Segunda:** idéntica a la primera, palabra por palabra.

### Migración 2 — `/api/setup-venues`

**Toca `collectives`, que tiene datos reales de producción.**

```
https://hotu-one.vercel.app/api/setup-venues?secret=TU_SECRET&dryRun=1
https://hotu-one.vercel.app/api/setup-venues?secret=TU_SECRET
https://hotu-one.vercel.app/api/setup-venues?secret=TU_SECRET
```

- **dryRun:** `seAgregarian` con `entity_kind`, `address` y `capacity`, y
  `estado.filas.total` en **6**. Anotá ese número. En `estado.checks`
  tiene que estar solo `collectives_status_membership_check`; si aparece
  un `collectives_entity_kind_check`, pará y avisame.
- **Real:** en `despues.columnasNuevas`, la línea de `entity_kind` tiene
  que decir **`"aceptaNull": false`** y **`"default": "'collective'::text"`**.
  Esos dos campos son el punto: una `entity_kind` que acepte NULL deja
  pasar filas que el CHECK **no** rechaza, porque `NULL IN (...)` es NULL
  y no false, y esa fila sería un colectivo publicado invisible en
  `/colectivos` y en `/venues` a la vez, sin un error en ningún log.
- `despues.filas.porTipo` tiene que ser exactamente `{"collective": 6}` y
  `sinTipo` **0**. Si el total cambió, el log trae una línea con
  **ALERTA**.
- **Segunda:** su `antes` idéntico al `despues` de la primera.

### Push 2 — hasta `29292b5`

```
git push origin 29292b5:main
```

Ahora sí la sección de venues, que lee `entity_kind`. Si esto fuera antes
de la migración 2, `/colectivos` y `/colectivos/[slug]` tirarían **500
para cualquier visitante**.

También lleva `GENEROS.md` con los 719 tags de verdad y la ruta de la
migración 4.

**Después corré 3 y 4.**

### Migración 3 — `/api/seed-genres`

El vocabulario. Va después de la 1 o contesta 409.

```
https://hotu-one.vercel.app/api/seed-genres?secret=TU_SECRET&dryRun=1
https://hotu-one.vercel.app/api/seed-genres?secret=TU_SECRET
https://hotu-one.vercel.app/api/seed-genres?secret=TU_SECRET
```

- **dryRun:** tiene que decir **34 branches, 719 tags, 6 alias y 50
  cross-tags**, con `antes` todo en 0.
- **Real:** esos mismos cuatro números y `faltaElDocumento: false`.
- **Segunda:** `antes` y `despues` iguales entre sí. **Si algún conteo
  SUBE cuando esperabas que quedara igual, hubo un renombre y quedó un
  huérfano**: el conflicto se resuelve por slug y el slug sale del
  nombre. Pasó en dev con tres cross-tags y se vio solo porque el total
  dio 53 donde tenía que dar 50.
- Tarda: son 809 filas de a una.

### Migración 4 — `/api/setup-artist-signup`

**Toca `artists`, que tiene datos reales.**

```
https://hotu-one.vercel.app/api/setup-artist-signup?secret=TU_SECRET&dryRun=1
https://hotu-one.vercel.app/api/setup-artist-signup?secret=TU_SECRET
https://hotu-one.vercel.app/api/setup-artist-signup?secret=TU_SECRET
```

- **dryRun:** `seAgregarian` con las cinco columnas de revisión. Mirá
  `filas.porStatus`: **si hay artistas que no están publicados**, el log
  lo avisa, porque el backfill los deja en `'borrador'` y su dueño va a
  poder mandarlos a revisión. Si alguno estaba retirado a propósito,
  miralo antes.
- **Real:** en `despues.columnas`, `status` tiene que quedar con
  **`"default": "'draft'::text"`** y `review_status` con
  **`"aceptaNull": false`** y default `'borrador'`. Ese cambio de default
  es la compuerta: con `'published'`, un INSERT que se olvide de nombrar
  `status` publica al instante y la aprobación entera es decorativa.
- `despues.filas.porRevision` tiene que ser `{"aprobado": N}` con N igual
  al total, y **cero en `en_revision`**. El log trae una ALERTA si la cola
  creció.
- **Segunda:** `backfill: 0 y 0`, y `antes` igual a `despues`.

### Push 3 — todo lo que falta

```
git push origin main
```

El alta de DJ, la franja y la cola de aprobación. Recién acá, porque todo
eso lee las tablas de género y `review_status`.

### Después del push 3, en producción

1. **Date el rol de SUPER_ADMIN** si no lo tenés en `user_roles`, o
   confirmá que tu mail está en `ADMIN_EMAILS`. Sin eso no entrás a
   `/admin/artistas`.
2. **Probá el alta con una cuenta de verdad**, de punta a punta: registro,
   crear perfil, completarlo, enviarlo, y aprobarlo desde el admin.
3. Los 17 artistas que ya existen quedan en `'aprobado'` y publicados. No
   entran en la cola.

---

## REQUISITO BLOQUEANTE — EL FLUJO DE RECLAMO DE PERFIL
#
# SIGUE VIGENTE Y AHORA ES MÁS URGENTE: la tanda 5 paso 1 creó las 18
# cuentas dueñas en main, SIN contraseña. Existen, son dueñas de perfiles
# de artistas reales de la escena, y hoy no hay ningún camino por el que
# esa gente pueda entrar a lo suyo. Hasta que exista el reclamo, esos
# perfiles los administra solamente un SUPER_ADMIN.

**Sin esto, 12 perfiles de producción no se pueden entregar a nadie.**
Dejó de ser deuda anotada: es un requisito.

Los 12 artistas y 6 colectivos que entraron por `/api/migrate` ahora
tienen cuenta dueña —`<slug>@perfil.hotu.local`— pero esas cuentas
nacen **sin contraseña**. `verifyCredentials` devuelve null cuando no hay
`password_hash`, así que existen, son dueñas, satisfacen el FK, y **nadie
puede iniciar sesión con ellas**.

Se descartó ponerles una contraseña común por tres razones que se suman:

1. **No habría forma de cambiarla.** No existe ninguna ruta en el repo
   que escriba `password_hash` sobre una cuenta viva: `createAccount` es
   `INSERT ... ON CONFLICT DO NOTHING`, incapaz por diseño de pisar una
   fila existente. Serían doce contraseñas permanentes.
2. **El email es deducible.** El patrón es `<slug>@dominio` y los slugs
   están en la URL de cada perfil. Usuario adivinable más contraseña
   compartida es una puerta abierta.
3. **Son perfiles de artistas reales de la escena.** El día que alguno
   reclame el suyo, el camino tiene que ser reclamarlo, no que alguien le
   pase una clave que comparte con otros once.

**Consecuencia aceptada mientras tanto:** esos perfiles solo los puede
editar un SUPER_ADMIN — `canEditArtist` cae a `isSuperAdmin` cuando quien
mira no es el dueño. No quedan inalcanzables, quedan **reservados**.

**Qué hace falta**, como mínimo:
- Una ruta que permita fijar contraseña sobre una cuenta que no tiene.
- Alguna prueba de identidad para reclamar un perfil. No alcanza con
  conocer el email, porque es deducible.
- O, más simple: que el reclamo lo apruebe un SUPER_ADMIN a mano, igual
  que la cola de aprobación de perfiles de DJ que ya existe.

Relacionado y del mismo problema: **recuperar contraseña** tampoco
existe para ninguna cuenta, ni las normales. Con Credentials en
producción ya era necesario; ahora además bloquea esto.

---

## DECISIONES PENDIENTES

1. **Verificación de email y límite por IP.** Van juntos, con
   almacenamiento compartido. Hoy cualquiera se registra con un correo
   que no controla. Lo que contiene el daño es la aprobación manual: un
   registro basura sin perfil aprobado no llega a ningún lado.
2. **Recuperar contraseña.** Ver la sección REQUISITO BLOQUEANTE de
   arriba: dejó de ser un pendiente suelto.
3. **El género del contenido.** HOTFIX §3 quiere filtro de branch y tag
   en `/noticias`, `/eventos`, `/sets` y `/discografia`, pero el modelo
   de género es solo para artistas y colectivos. Eso lo cubría `district`.
4. **`/mi-perfil` vs `/perfil`.** Sigue sin respuesta. Trabajé sobre
   `/perfil`, que es lo que existe.

---

## REQUISITOS DEL WRITE PATH DE §6 — NO SON IDEAS, SON CONDICIONES

La migración `/api/setup-republication` crea el schema de la
republicación, pero hay cuatro estados que el schema PERMITE y las
reglas PROHÍBEN. Ninguno se puede expresar como CHECK: todos miran filas
de otra tabla. Los tiene que hacer cumplir el código, igual que la
casa-en-venue. Los encontró el migration-reviewer antes de que la
migración corriera en ningún lado.

**1. Una pieza `is_fixed=true` sin ningún placement es INVISIBLE en
todas partes.** No entra por el camino vivo —la excluye `is_fixed`— ni
por el fijo —no tiene filas—. Queda publicada, editable por su dueño, y
sin existir para nadie más.

Publicar una colaboración son tres statements, y cada `sql` del driver
HTTP de Neon es su propio request: si el tercero falla por un timeout,
la pieza queda así para siempre, sin un error en ningún log. El usuario
ve un 500, reintenta, y `uniqueSlug` le da un slug nuevo: queda la
pieza huérfana invisible MÁS la buena.

→ El publicar va ENTERO en `sql.transaction([...])`, con la misma
justificación que los swaps de constraint.
→ El admin necesita esta consulta, porque sin ella el estado es
indetectable por construcción:

```sql
SELECT slug FROM tracks t WHERE t.is_fixed
  AND NOT EXISTS (SELECT 1 FROM content_placements p WHERE p.track_slug = t.slug)
-- y su gemela para dj_sets
```

**2. `deleteCollective()` fabrica ese huérfano con un click. SE ARREGLA
EN D4, NO SE ANOTA.** Ya existe y es un botón de admin desplegado.
`content_placements.collective_slug` va ON DELETE CASCADE, así que
borrar el colectivo se lleva el placement y deja la pieza fija sin
destino: invisible en todas partes, sin error, para siempre.

Un botón que ya existe y que rompe datos no es deuda futura. En D4,
`deleteCollective` tiene que hacer una de estas dos, y la decisión va
escrita en el código con su razón:

- **Negarse** si el colectivo tiene placements, diciendo cuántas piezas
  quedarían huérfanas. Es más ruidoso y es honesto: el admin resuelve a
  mano qué pasa con ese contenido.
- **Reasignar o marcar** las piezas afectadas antes de borrar, en la
  misma transacción.

Lo que NO puede seguir pasando es que el CASCADE decida por omisión. La
consulta de detección de arriba sigue haciendo falta igual, para las
filas que ya hubieran quedado así.

**3. El INSERT de placement al aceptar necesita `ON CONFLICT DO
NOTHING`.** Si el colaborador comparte casa con el autor, el índice
único choca y la aceptación devuelve 500 DESPUÉS de que la persona ya
dijo que sí. Ana publica con casa en Reisen, Beto también tiene casa en
Reisen, Beto acepta, revienta.

Consecuencia que se acepta explícitamente: **un placement no es
atribuible.** La fila `(T, 'reisen')` no dice si la puso Ana o Beto.
Como los placements no se borran nunca, no rompe nada — pero significa
que sacar a un colaborador jamás va a poder limpiar placements.

**4. Tres guardas más, de la misma familia:**
- `is_fixed=false` CON placements sacaría la pieza dos veces, una por
  cada rama del UNION.
- Nada impide que el autor se invite a sí mismo como colaborador.
- Nada impide que el destino sea un VENUE. §6.1 dice "artistas o
  colectivos" y los venues comparten la tabla `collectives`. Hay que
  decidirlo y escribirlo, no dejarlo caer.

---

## CONGELADO POR DEPENDENCIA DE BOLETERÍA — NO ES UN PENDIENTE

**`events.district` no se borra, y el `display_code` no se toca.**
DECIDIDO, no abierto.

`lib/tickets-write.ts` arma el código visible de cada boleta como
`HOTU-07-AD0002`, donde el `07` es el distrito del evento. Es el único
lugar del sistema donde el distrito nunca fue decorado: se imprime en la
boleta y se lee en la puerta.

Hay boletas vendidas con ese formato. Cambiar el formato de un código
impreso no se decide porque el código quedó raro, se decide cuando hay
una razón, y hoy no la hay. Así que `lib/tickets-write.ts` sigue leyendo
`events.district` a propósito, y la columna se queda.

Consecuencia aceptada: la migración que borre las columnas `district`
puede llevarse las otras seis (`artists`, `collectives`, `news`,
`dj_sets`, `tracks`, `artist_gigs`), pero NO `events`. Ese es el costo
correcto de no romper un identificador que alguien tiene en la mano.

Por eso `lib/districts.ts` también se conserva: es lo único que explica
qué significaba cada código.

---

## ~~MIGRACIÓN PENDIENTE EN MAIN~~ — TANDA-3 §7, YA CORRIDA

Una sola ruta, DOS PASOS, en este orden. Entre el paso 1 y el 2 se puede
desplegar el código sin problema: las páginas caen al texto congelado de
`events.lineup` mientras el lineup no esté importado.

### Paso 1 — la estructura

```
https://hotu-one.vercel.app/api/setup-event-lineup?secret=$MIGRATE_SECRET&dryRun=1
https://hotu-one.vercel.app/api/setup-event-lineup?secret=$MIGRATE_SECRET
```

**Qué mirar en el dryRun:** `verificado: false` con **20 problemas**,
todos diciendo **"falta"**. Si alguno dice **"EXISTE PERO"**, PARÁ: hay
algo con ese nombre y otra forma en main, y correr la migración NO lo
arregla — `IF NOT EXISTS` compara por nombre y se saltea en silencio.

**Y mirá `gigsHotuAMigrarDespues`.** Se espera **0**: en main nunca hubo
importador de lineups, y ningún camino de la app escribe `source='hotu'`
(`epk-write` hardcodea `'declarado'`; el único productor es `seed-test`,
que es dev-only). **Si no es 0, pará y avisá**: esos toques dejan de
leerse de `artist_gigs` y desaparecen del press kit de su artista si no
quedan representados en `event_lineup`. El JSON dice cuáles son, con
nombre y evento.

**Las dos corridas reales:** `ok: true` **y** `verificado: true`, con
`problemas: []`. Ojo: la ruta devuelve HTTP 200 aunque `verificado` sea
false — `ok` significa "corrió", `verificado` significa "quedó bien".

### Paso 2 — el import del texto libre

```
https://hotu-one.vercel.app/api/setup-event-lineup?secret=$MIGRATE_SECRET&import=1&dryRun=1
https://hotu-one.vercel.app/api/setup-event-lineup?secret=$MIGRATE_SECRET&import=1
```

**Qué mirar en el dryRun:** el array `decisiones` trae **una línea por
nombre**, con a qué resolvió y por qué. Leelo antes de correr el real: es
la única oportunidad de ver qué va a hacer con cada nombre del flyer.
En dev dio 2 artistas, 5 colectivos, 2 sin match, 0 ambiguos y 1 repetido
descartado.

Si aparece algún **"ambiguo"**, ese nombre matchea a dos y NO se va a
asignar — queda para resolver a mano desde /admin/eventos.

**La segunda corrida real** tiene que saltear todos los eventos
("evento N salteado: ya tiene lineup cargado") e importar **0** entradas.
Eso prueba que no pisa correcciones a mano.

`events.lineup` no se toca en ninguno de los dos pasos. Es la única
prueba de qué decía el flyer.

---

## LAS TRES COSAS QUE ESPERAN DATOS TUYOS — HACELAS DE UNA SENTADA

Son tres, se cargan a mano, y **cada una destraba algo que ya está
construido y hoy no se ve**. Están juntas acá porque hacerlas en una
sentada es media hora; hacerlas de a una, tres sesiones.

Ninguna rompe nada mientras falte: todo lo que depende de ellas no se
renderiza, en vez de mostrar ceros o secciones vacías.

### 1. LAS CASAS de los colectivos

Ningún colectivo de producción tiene una 'casa' asignada. Las membresías
entraron desde el jsonb viejo como vínculo múltiple, y ese array plano
nunca dijo quién era el principal — inventarlo habría sido afirmar algo
que el dato no decía.

**Qué destraba:** el carrusel ARTISTAS DE LA CASA (hoy no se renderiza en
ningún colectivo, verificado en producción), y **SETS y TRACKS del
colectivo**, porque la consulta viva de §6 se cuelga de la casa actual
del autor. Con una sola casa asignada aparecen las tres cosas juntas.

**Dónde:** el panel del colectivo, desde tu perfil.

### 2. EL GÉNERO de artistas y colectivos

La taxonomía está sembrada —34 ramas, 719 tags— y **nadie declaró
ninguno**. Los 12 artistas y 6 colectivos de producción son anteriores a
ella y nunca pasaron por el formulario de alta.

**Qué destraba:** el bloque ENCONTRÁ TU GÉNERO de la home (hoy no se
renderiza), y los filtros de rama y tag de /artistas, /colectivos, /sets
y /discografia, que hoy caen al filtro viejo de suplente.

**Dónde:** la sección GÉNERO del press kit de cada uno, editable por su
dueño.

### 3. LOS ORGANIZADORES de los eventos

**Ninguno de los 3 eventos de main tiene organizador.** No salía del
texto del flyer: el lineup nombra a quién toca, no a quién organiza. El
import no lo pudo adivinar y no lo intentó.

**Qué destraba:** las MÉTRICAS del colectivo y del venue (§4.4), que hoy
no se renderizan porque son solo de eventos organizados. Y es lo que va a
permitir saber qué eventos armó cada colectivo.

**Dónde:** /admin/eventos, selector ORGANIZADOR en cada evento.

### De paso, si estás ahí

Las **2 entradas de lineup sin resolver** en dev ("HOTU Crew" y "xxx"):
en main van a ser las que el import no matchee. Se resuelven desde el
mismo /admin/eventos, con el texto del flyer al lado. Se puede marcar un
lineup como revisado dejando entradas sin resolver — un nombre puede no
corresponder a nadie para siempre.

---

## LO QUE NO SE PUEDE CALCULAR TODAVÍA — FALTA MODELO, NO DATOS

**Las HORAS de §4.3 punto 6.** No es que falte cargarlas: falta la
columna. `events.event_date` es un **DATE**, así que un evento no guarda
a qué hora empezó. Con solo `end_at`, la resta mide desde la medianoche
del día del evento: una prueba con un cierre ocho horas después del
inicio devolvió **13 horas**.

Un número equivocado en el press kit que un colectivo le muestra a un
organizador para que lo contrate es peor que una métrica de menos, así
que la métrica no está. Para tenerla hace falta agregar una hora de
inicio a `events`, y eso es modelo nuevo.

**Los DISTRITOS de §4.3 punto 6.** El concepto se retiró entero en la
tanda 4 §3 y las columnas quedaron congeladas. Contar distritos hoy sería
resucitar algo muerto para llenar un casillero. En su lugar la métrica
cuenta **ciudades**, que es lo que esa cifra quería decir —en cuántos
lugares distintos armaron algo— y que sí es un dato vivo.

**El GÉNERO DEL EVENTO**, y con él el filtro 1 de /eventos. Ahora que
existe `event_lineup` ya se puede derivar del género de su lineup, que
es lo que §3 decía. No entró en esta tanda porque el lineup recién se
está poblando y ningún artista declaró género: estrenar un desplegable
que no devuelve nada es justo lo que la regla de la transición prohíbe.

---

## DATO SUCIO EN MAIN — Y YA NO SE ARREGLA DESDE EL ADMIN

**`events.id = 4` tiene una dirección en la columna `city`:**
`"Calle 80 # 14 - 11"`.

El filtro CIUDAD de `/eventos` arma sus opciones con lo que hay en los
datos, así que esa dirección aparece como si fuera una ciudad en el
desplegable. La página hace lo correcto con un dato equivocado.

**CAMBIÓ CÓMO SE ARREGLA, y es consecuencia directa del paso 4.** Decía
"va a mano desde el admin". Ya no: el admin no edita contenido. Y ese
evento **no tiene organizador** —lo cargó el admin cuando era un CMS—,
así que ningún panel lo alcanza tampoco. Hoy es de nadie.

Hay cuatro eventos así en main. Tenés dos caminos:

**(a) Asignarles un organizador**, por SQL, y que ese colectivo los
corrija desde su panel:

    UPDATE events SET organizer_slug = '<slug-del-colectivo>' WHERE id = 4;

Es el camino que deja el dato bien Y el evento editable de ahí en más.

**(b) Arreglar solo la ciudad**, por SQL:

    UPDATE events SET city = 'Bogotá' WHERE id = 4;

La Calle 80 con Carrera 14 es Bogotá, pero eso lo afirma alguien que
conoce el evento, no un script — por eso no va en una migración.

Recomiendo (a) para los cuatro: mientras no tengan organizador van a
seguir siendo intocables cada vez que haga falta corregir algo.

Encontrado por el tester en la tanda 4. Es preexistente.

---

## LO QUE SIGUE BLOQUEADO

**Tanda 4 pieza 3 — sacar los distritos.** Está definida como un
*reemplazo*: el filtro 1 pasa a ser Main/Branch y el 2 pasa a ser Tag.
Ahora que la taxonomía existe, **ya no está bloqueada por datos**: es la
siguiente pieza natural. Hoy siguen 18 archivos importando
`lib/districts`, el selector de distrito como filtro 1 de las seis
páginas, y el distrito en la cabecera del perfil de colectivo y en
"Sobre mí".

Eso también limpia el `D00` que hoy hereda todo DJ nuevo, que está
anotado en ALTA-DJ.md como conocido y aceptado: es el distrito T/RAP, y
`epk-write` lo copia a cada set, track y toque que el DJ cargue.
