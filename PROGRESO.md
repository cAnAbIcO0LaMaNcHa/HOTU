# PROGRESO — sesión de tanda 4 y venues

Todo contra la branch **dev** de Neon. **Nada tocó main.** Nada se pusheó:
hay **6 commits locales** por delante de `origin/main`, desde `0ac63de`.

Verificación: `npx tsc --noEmit` limpio después de cada pieza, y curl
contra `npm run dev`. Nunca se corrió `next build`.

---

## HECHO Y COMMITEADO

| Commit | Pieza |
|---|---|
| `f9673fe` | Pieza 0 — los dos agentes |
| `b097f4c` | Tanda 4 pieza 1 — modelo de la taxonomía (SIN datos) |
| `81aa0ee` | Tanda 4 pieza 2 — reglas de género en el write path |
| `5f2467f` | Migración de venues (entity_kind, address, capacity) |
| `63fb632` | Reglas nuevas en AGENTS.md + `npm run dev` que se protege |
| `c68597c` | Venues completo, con los once puntos de contacto |

### Los dos agentes

`.claude/agents/tester.md` y `.claude/agents/migration-reviewer.md`.
Ninguno puede editar ni ejecutar: solo leen y reportan, que es lo que
"reporta, no arregla" significa cuando se hace cumplir.

**Ojo:** las definiciones de `.claude/agents/` se cargan al arrancar la
sesión, así que en la sesión donde los creé no estaban disponibles por
nombre. Corrí las revisiones igual, pasándoles el archivo como
especificación. Mañana ya salen por nombre.

**Valieron la pena de inmediato.** El migration-reviewer auditó un
arreglo MÍO en la migración de venues y encontró que abría un agujero
peor que el que cerraba: yo había separado un `DROP CONSTRAINT` de su
`ADD CONSTRAINT`, y con el driver HTTP de Neon son dos requests, así que
un corte entre los dos dejaba la tabla **sin ningún CHECK**. Está
arreglado con `sql.transaction` y la regla quedó en AGENTS.md.

El tester encontró que `address` y `capacity` eran columnas muertas: se
leían y se dibujaban, pero ningún camino de escritura las nombraba.
También arreglado.

### Venues (tanda 3 §5)

Comparten la tabla `collectives` con una columna `entity_kind`. Para el
usuario son dos secciones separadas: `/venues` y `/colectivos`, con su
propia navegación, y cruzar slugs da 404 en los dos sentidos.

**Los once puntos de contacto entraron en el mismo commit que la primera
fila venue**, incluidos los dos bugs que fallaban en silencio:

- `createCollective` contaba venues para el "uno por cuenta". Tener un
  venue te negaba el colectivo con un mensaje falso.
- Nada impedía que un DJ pusiera su casa en un venue. El índice único
  garantiza UNA casa, no DÓNDE: vive en `artist_collectives` y no ve
  `entity_kind`. Ahora los tres caminos que pueden escribir `casa` pasan
  por una sola guarda en el write path.

---

## BLOQUEADO

### ~~Tanda 4 pieza 1 — el seed~~ DESBLOQUEADA Y SEMBRADA

Llegó el `.docx`. Está convertido a `GENEROS.md`, el binario se borró, y
el vocabulario está sembrado en dev.

Estado en dev:

| Tabla | Filas |
|---|---|
| `genre_branches` | **34** |
| `genre_tags` | **719** |
| `genre_aliases` | **6** |
| `cross_tags` | **50** |
| `artist_genres` / `collective_genres` | 0 (nadie eligió todavía) |

`GENEROS.md` es la fuente de verdad y se edita a mano.
`lib/genre-taxonomy.ts` se regenera desde él con
`node scripts/genre-taxonomy-from-md.mjs`, y después hay que volver a
correr `/api/seed-genres`.

Lo que las tres piezas de la tanda 4 tenían bloqueado por esto ya no lo
está. Las piezas 2 y 3 siguen frenadas por las razones propias que están
más abajo, no por el documento.

### Tanda 4 pieza 2 — campos obligatorios al crear cuenta

Bloqueada por dos razones, las dos de modelo y no de código.

**No existe ningún flujo de alta de artista.** Los artistas solo nacen
por migración o por seed; no hay ningún momento en la aplicación en el
que se cree uno, así que no hay dónde exigir nada.

**Y exigir género con el vocabulario vacío no haría cumplir una regla,
haría imposible crear una cuenta**, porque no habría de dónde elegir.
Los colectivos sí tienen flujo de alta y se romperían.

Lo que sí quedó hecho es la lógica: `lib/genres-write.ts` hace cumplir
1 branch primario, hasta 3 secundarios y de 3 a 8 tags, con diez casos
probados. `genreVocabularyReady()` es el interruptor que se activa solo
cuando la taxonomía esté sembrada.

### Tanda 4 pieza 3 — sacar los distritos

**NO se hizo. Los distritos siguen enteros en la UI.**

La pieza está definida como un *reemplazo*: el filtro 1 pasa a ser
Main/Branch y el filtro 2 pasa a ser Tag. Sin taxonomía sembrada, sacar
la mitad que existe dejaría las seis páginas de listado **sin ningún
filtro de género**, que es peor que como están.

Hoy siguen: 18 archivos importan `lib/districts`, el selector de
distrito es el filtro 1 de las seis páginas (vía `listing-layout`), y el
distrito se muestra en la cabecera del perfil de colectivo y en "Sobre
mí" del EPK. El agrupador de `/discografia` y `/sets` también sigue.

---

## DECISIONES QUE NECESITO

1. **El mínimo de tags.** HOTFIX.md se contradice: §2.3 pide "al menos un tag" y §2.4 pide "de 3 a 8". El documento original zanja: "Allow 3-8 genre Tags per DJ". Quedó en 3, y ahora con respaldo. Confirmame que va así.
2. **Las décadas de ERA** quedaron confirmadas por el documento: las seis, más Old School, Classic, Current / New Music y Throwbacks. Ya no es una lectura mía.
3. **El género del contenido.** HOTFIX §3 quiere filtro de branch y tag
   también en `/noticias`, `/eventos`, `/sets` y `/discografia`, pero el
   modelo de género es solo para artistas y colectivos. Eventos, noticias,
   sets y tracks no tienen por dónde. Hoy eso lo cubría `district`.
4. **`/mi-perfil` vs `/perfil`** sigue sin respuesta desde la sesión
   anterior. Trabajé sobre `/perfil`, que es lo que existe.

---

## MIGRACIONES PENDIENTES DE CORRER EN MAIN

**Tres, y el orden importa.** Ninguna corrió nunca en main.

### El orden de despliegue, que esta vez sale sin commit sintético

Los commits quedaron en el orden correcto por casualidad: las dos rutas
de migración están ANTES del código que las necesita.

**Paso 1 — pushear hasta `63fb632`.** Eso lleva las tres rutas de
migración y nada que dependa de ellas. `lib/genres-write.ts` consulta
`genre_branches`, pero solo cuando alguien llama `/api/genres/...`, que
no pasa en ninguna carga de página. Ninguna página pública se rompe.

**Paso 2 — correr las migraciones (abajo).**

**Paso 3 — pushear `c68597c`.** Recién ahí se despliega el código que
lee `entity_kind`. Si esto fuera antes del paso 2, `/colectivos` y
`/colectivos/[slug]` tirarían 500 para cualquier visitante, porque
`getAllCollectives` filtra por una columna que main todavía no tiene.

### 1. `/api/setup-genres` — las diez tablas de la taxonomía

```
https://hotu-one.vercel.app/api/setup-genres?secret=TU_SECRET&dryRun=1
https://hotu-one.vercel.app/api/setup-genres?secret=TU_SECRET
https://hotu-one.vercel.app/api/setup-genres?secret=TU_SECRET
```

- **dryRun:** `seCrearian` tiene que listar las diez tablas y `estado.tablas`
  venir vacío. Si lista menos de diez, hay algo preexistente: mirá `forma`
  antes de seguir.
- **Real:** `ok:true` y once líneas de log. En `estado.forma`, cada tabla
  con su cantidad de columnas y sus índices. Los que importan:
  `artist_genres_one_primary_idx`, `collective_genres_one_primary_idx`,
  `artist_genre_tags_one_per_tag_idx`, `collective_genre_tags_one_per_tag_idx`.
- **Segunda:** idéntica a la primera, palabra por palabra.

### 2. `/api/seed-genres` — el vocabulario

Va **después** de la anterior; si no, contesta 409 diciendo que falta.

```
https://hotu-one.vercel.app/api/seed-genres?secret=TU_SECRET&dryRun=1
https://hotu-one.vercel.app/api/seed-genres?secret=TU_SECRET
https://hotu-one.vercel.app/api/seed-genres?secret=TU_SECRET
```

- **dryRun:** tiene que decir que escribiría **34 branches, 719 tags,
  6 alias y 50 cross-tags**, y `antes` venir todo en 0.
- **Real:** las cuatro líneas de log con esos mismos cuatro números, y
  `despues` igual a `{34, 719, 6, 50}`. `faltaElDocumento: false`.
- **Segunda:** `antes` y `despues` iguales entre sí y a los de la
  primera. **Si algún conteo SUBE cuando esperabas que quedara igual,
  hubo un renombre y quedó un huérfano** — el conflicto se resuelve por
  slug, y el slug sale del nombre. Pasó en dev con tres cross-tags
  míos y se vio solo porque el total dio 53 donde tenía que dar 50.
- Tarda bastante: son 809 filas de a una.

### 3. `/api/setup-venues` — entity_kind, address y capacity

**Es la única de las tres que toca una tabla con datos reales de
producción.** En main hay 6 colectivos publicados.

```
https://hotu-one.vercel.app/api/setup-venues?secret=TU_SECRET&dryRun=1
https://hotu-one.vercel.app/api/setup-venues?secret=TU_SECRET
https://hotu-one.vercel.app/api/setup-venues?secret=TU_SECRET
```

- **dryRun:** `seAgregarian` tiene que listar `entity_kind`, `address` y
  `capacity`, y `estado.filas.total` decir **6**. Anotá ese número.
  `estado.checks` tiene que traer solo `collectives_status_membership_check`.
  Si trae un `collectives_entity_kind_check`, pará y avisame.
- **Real:** `ok:true`, y en `despues.columnasNuevas` la línea de
  `entity_kind` tiene que decir **`"aceptaNull": false`** y
  **`"default": "'collective'::text"`**. Esos dos campos son el punto:
  una `entity_kind` que acepte NULL después deja pasar filas que el CHECK
  no rechaza (`NULL IN (...)` es NULL, no false), y esa fila sería un
  colectivo publicado invisible en `/colectivos` y en `/venues` a la vez,
  sin un error en ningún log.
- `despues.filas.porTipo` tiene que ser exactamente `{"collective": 6}` y
  `sinTipo` **0**. Si el total cambió, el log trae una línea que empieza
  con **ALERTA**.
- **Segunda:** el `antes` de la segunda corrida tiene que ser idéntico al
  `despues` de la primera. Esa igualdad es la prueba de idempotencia y se
  lee directo del JSON.

### Deuda vieja que sigue abierta

`dryRun` todavía no está en `setup-profiles` ni en `setup-epk-content`.
Las dos ya corrieron en main, así que no bloquea nada.

---

## CÓMO PROBARLO EN LOCAL

`npm run dev` ahora aborta si ya hay un server en el puerto, con las
instrucciones para limpiar. Si querés uno igual: `npm run dev:force`, o
`PORT=3001 npm run dev`.

Cuentas del fixture, contraseña `test1234`:

| Cuenta | Qué probar |
|---|---|
| `duena@test.hotu.local` | Dueña de Reisen **y** de Bodega Prueba. Los dos paneles en su perfil. Editar dirección y aforo del venue. |
| `artista@test.hotu.local` | Camila: casa en OTU, residente en hotu-138 y en el venue. En el venue NO le ofrece "hacer mi casa". |
| `aplicante@test.hotu.local` | Sin ningún vínculo. Postularse a `/venues/bodega-prueba`. |

**Lo que más me importa que mires:** entrá a `/venues/bodega-prueba` y a
`/colectivos/reisen` y fijate que son dos secciones distintas, aunque por
dentro sean la misma tabla. Y que `/colectivos/bodega-prueba` da 404.
