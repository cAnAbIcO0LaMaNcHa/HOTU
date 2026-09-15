# PROGRESO — taxonomía, venues y alta de DJ

Todo contra la branch **dev** de Neon. **Nada tocó main.** Nada se pusheó:
**17 commits locales** por delante de `origin/main`, desde `0ac63de`.

Verificación: `npx tsc --noEmit` limpio después de cada pieza, y curl
contra `npm run dev`. Nunca se corrió `next build`.

---

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

## DECISIONES PENDIENTES

1. **Verificación de email y límite por IP.** Van juntos, con
   almacenamiento compartido. Hoy cualquiera se registra con un correo
   que no controla. Lo que contiene el daño es la aprobación manual: un
   registro basura sin perfil aprobado no llega a ningún lado.
2. **Recuperar contraseña.** No existe, y con Credentials en producción
   se vuelve necesaria.
3. **El género del contenido.** HOTFIX §3 quiere filtro de branch y tag
   en `/noticias`, `/eventos`, `/sets` y `/discografia`, pero el modelo
   de género es solo para artistas y colectivos. Eso lo cubría `district`.
4. **`/mi-perfil` vs `/perfil`.** Sigue sin respuesta. Trabajé sobre
   `/perfil`, que es lo que existe.

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
