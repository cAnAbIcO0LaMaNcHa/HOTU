# REVISIÓN DE LA SESIÓN NOCTURNA

Nada se pusheó. Nada se tocó en main ni en producción. Todo corrió contra dev con
el candado puesto, y todas las migraciones nuevas quedaron en tramos propios sin
correr allá.

**Leé primero la sección 3 (decisiones tuyas) y la 4 (plan de subida).** El resto es
detalle de lo hecho.

---

## 1. QUÉ QUEDÓ HECHO

### Tarea 1 — AGENTS.md y CLAUDE.md sincronizados · `2472ae8`

Los dos archivos se contradecían **consigo mismos**: el schema de arriba decía
`residente` y MODELO DE PERFILES abajo seguía describiendo `casa` y el flujo viejo
donde el DJ elegía. Eso es peor que contradecirse entre ellos, porque es el archivo
que se autocarga.

Corregido: el vocabulario y el handshake completo (el dueño ofrece, el DJ acepta, un
solo colectivo, qué pasa con un fundador que ya es residente en otro lado, y por qué
la oferta vive en `residency_offers`), el carrusel RESIDENTES, la atribución como
POSPUESTA, Credentials como HECHO, `VENTA_ONLINE`, `door_price_cop` sin tope,
`starts_at` con la regla de madrugada, el registro obligatorio de ediciones con su
excepción de `/api/upload`, y las tres puertas.

**Cada afirmación nueva verificada contra la base**, no de memoria: el conteo de tablas,
`actor_rol` con `'moderador'`, `starts_at` timestamptz nullable sin default, el CHECK
del precio sin tope.

Y el conteo de tablas lo tuve que corregir **otra vez más tarde**, porque la tarea 5 lo
invalidó esa misma noche. Está contado en la sección 5.

Dejé intacto todo `'casa'` que es **marca** y todo el que es **historia de los
nombres** — esa palabra cambió de significado tres veces y el registro tiene que
quedar legible. md5 de los dos archivos idéntico.

### Tarea 2 — Hora de inicio · `84ac242`

**Y acá apareció un bug de cinco horas que YA ESTABA EN PRODUCCIÓN.** `end_at`
llegaba de un `datetime-local` como `"2026-11-16T06:00"` —sin offset— y se parseaba
con `new Date()`, que interpreta un string así en la zona del **servidor**. Vercel
corre en UTC, así que una fiesta que cerraba 06:00 en Bogotá quedaba guardada como
06:00 UTC, o sea 01:00 de Bogotá. Sin error en ningún lado, y todas las validaciones
de año y día pasaban porque el problema no era el día.

Lo que hay ahora:

- El formulario manda **día y dos horas** `HH:MM`; el lib arma los instantes con
  `-05:00` explícito.
- **La regla de la madrugada en UNA función**, `armarInstante` en `date-utils`, que es
  pura y la usa también el formulario para decir *"empieza la madrugada del domingo
  16"* antes de guardar. Dos copias de esa regla es cómo la pantalla y la base
  terminan diciendo días distintos.
- **Dos horas sueltas en vez de un `datetime-local`**: ese campo obligaba al
  organizador a elegir el día del cierre, que es justo lo que se equivoca.
- **Si se corrige la FECHA, las horas se mudan con ella.** Conservar el timestamp
  viejo dejaría una fiesta anunciada para el 22 con su inicio el 15 — un evento que
  para la agenda ya pasó.
- Agenda por `event_date, starts_at NULLS LAST`. Hora y duración **solo si existen
  los datos**; nada se estima.

Pruebas: **34 OK, 0 MAL**, con tus cuatro casos, la zona medida en UTC, y que editar
el título no borre `starts_at` ni `door_price_cop`.

### Tarea 3 — Cédula · `2049dda`

**No había código que sacar:** nada lee ni escribe `cedula`, solo quedan comentarios.
La migración `setup-borrar-cedula` la vacía contando con `RETURNING` y después quita
la columna, los dos pasos en una transacción.

El `UPDATE` previo no es redundante: es la única forma de saber **cuántas** cédulas
había, porque después del `DROP` nadie va a poder preguntarlo.

Dev, con una fila plantada para que el conteo tuviera algo que contar: dryRun reportó
2, la corrida vació 2 y quitó la columna, la segunda es idempotente, las 20 cuentas
intactas. Sin índices, constraints ni vistas dependientes.

### Tarea 5 — Deuda de schema · `2049dda` y el commit siguiente

Dos migraciones, preparadas y **sin correr en main**:

- `setup-borrar-collective-ownership` — borra la tabla, y **se niega si tiene filas**.
  PROGRESO.md ya tenía escrita esa condición: filas ahí serían cesiones que el código
  viejo escribió en la ventana, y hay que copiarlas a `profile_ownership` primero.
- `setup-borrar-columnas-muertas` — las cuatro congeladas en una transacción, y
  **cuenta qué tenía cada una antes de borrarla**. Los números de dev: 12 artistas con
  `sets`, 12 con `top_tracks`, 5 colectivos con `artist_slugs`, 9 con
  `status_membership`. "Estaban vacías" conviene poder decirlo con un número.

**Verifiqué que nadie las lee, y dos greps necesitaron segunda mirada:**
`artists-write.ts` y `db.ts` leen `a.sets`, que *parece* la columna jsonb y en
realidad es `(SELECT COUNT(*) FROM dj_sets) AS sets` — un alias que sigue andando
después de borrar la columna.

---

## 2. QUÉ NO SE PUDO, Y POR QUÉ

### STATS del EPK: no se puede construir entero, y es por datos

Medido:

| lo que STATS necesita | de dónde sale | estado |
|---|---|---|
| horas tocadas | `starts_at` y `end_at` | **0 eventos tienen los dos** (y 0 tienen `starts_at`) |
| asistentes por fiesta | atribución de ventas | **pospuesta por vos** |
| promedio de asistentes | idem | **pospuesta** |

Los 9 toques de `event_lineup` existen, pero ningún evento tiene hora todavía —la
columna nació anoche— así que la sección arrancaría vacía en los tres números. Y la
regla de UI del propio AGENTS.md dice que **las secciones vacías no se muestran**.

Construirla ahora es construir algo invisible hasta que los organizadores carguen
horas. **No la hice**, y la decisión de cuándo hacerla depende de eso, no de mí.

### Galería y Prensa: necesitan tabla, y no la preparé

No existe ninguna tabla de galería ni de prensa. Necesitan una migración cada una (o
una compartida), y **el formato de las dos es decisión de producto**: cuántas fotos
por artista, si la galería tiene orden manual, si la prensa guarda el medio como texto
libre o como una lista cerrada. Preferí no inventar el schema de dos tablas nuevas en
una sesión sin supervisión.

### Rider técnico: la columna existe, el formato es tuyo

`artists.rider jsonb` existe desde la tanda 1 y está en `{}` **en los 17 artistas**. No
necesita migración. El formato es la decisión, y está en la sección 3.

### Convocatorias (§8): no llegué

Era la tarea 6, la de "si hay tiempo", y el tiempo se fue en la tarea 4 —el EPK— que
terminó siendo un relevamiento y tres decisiones tuyas en vez de código. Preferí dejar
las tres bien planteadas antes que empezar una cuarta cosa a medias.

Cuando la encaremos, ya hay un dato medido que la toca: el **umbral de condicionales de
`entity_kind`** que AGENTS.md fija en ~50 total y ~10 por archivo. Convocatorias es una
de las dos piezas que más lo puede empujar, así que ese conteo hay que correrlo **antes**
de diseñarla, no después.

---

## 3. DECISIONES QUE TE TOCAN

### 3.1 El formato del Rider

- **(a) Lista libre de líneas** — "2× CDJ-3000", "1× DJM-900NXS2". Flexible, entra
  cualquier equipo raro, pero no se puede comparar entre DJs ni filtrar.
- **(b) Campos fijos** — CDJs (marca, modelo, cantidad), mixer, monitores, extras.
  Comparable, y un organizador puede ver si su cabina alcanza. Lo que no entra en los
  campos no entra.
- **(c) Híbrido** — campos fijos para CDJs, mixer y monitores, más una línea libre de
  "otros".

**Recomiendo (c).** El 90% de los riders de la escena son CDJs y mixer, y ese 90%
conviene que sea comparable; el 10% raro necesita el campo libre para no quedar afuera.

### 3.2 Galería y Prensa: qué guardar

- **Galería**: ¿tope de fotos por artista? ¿orden manual o por fecha de subida? ¿pie
  de foto o solo la imagen? Recomiendo: tope de 12, orden manual con `sort_order`
  —igual que `dj_sets` y `tracks`—, y sin pie, porque una foto para armar un flyer no
  necesita texto.
- **Prensa**: ¿el medio es texto libre o una lista? Recomiendo **texto libre**: la
  escena publica en blogs y en Instagram, y una lista cerrada deja afuera justo lo que
  más hay.

### 3.3 STATS: qué mostrar mientras no haya datos

- **(a) No mostrar la sección** hasta que haya horas cargadas. Es lo que dice la regla
  de UI.
- **(b) Mostrar solo el conteo de toques**, que sí existe —en dev hay 9 que salen del
  lineup y 2 declarados, repartidos entre los artistas— y agregar horas y asistentes
  cuando haya.

**Recomiendo (b)**: un conteo con la forma *"N EVENTOS, M EN 2026"* ya es información
real —los números salen de los toques que existen, no de una estimación— y es lo que el
EVENTS del EPK promete en AGENTS.md. Las horas y los asistentes se suman cuando haya con
qué calcularlos.

### 3.4 HIEDRA y el distrito verde

AGENTS.md dice que el distrito verde (03 MUSE) lleva **hojas de hiedra sin flor**, y
marca *"PENDIENTE DE CONFIRMAR: esta regla estaba atada al personaje HIEDRA, que era
el 04 cuando era verde"*. O sea: la regla se escribió para un personaje que ya no está
en ese distrito.

**Decidí vos en una línea**: o MUSE hereda la hiedra porque la regla era del color, o
MUSE lleva flor como los demás y la hiedra se va con HIEDRA. Yo me inclino por lo
segundo —la regla parece haber sido del personaje, no del color— pero es estética y es
tuya.

### 3.5 `lib/crypto.ts`: ¿se borra?

Después de la migración de la cédula queda sin ningún uso. **Recomiendo NO borrarlo**:
es un sobre AES-256-GCM reutilizable y no está acoplado a esa columna. Borrarlo es
decidir que HOTU no va a volver a cifrar un campo, que es una decisión de producto y no
una consecuencia técnica.

Le corregí la cabecera, que prometía algo falso: decía que la migración de borrado
necesitaría `decryptField` "para confirmar qué borra". **No descifra a propósito**:
descifrar para loguear qué se borra pondría las cédulas en los logs del servidor —PII
sacada de una columna que nadie lee y puesta donde nadie controla, un paso antes de
borrarla.

---

## 4. PLAN DE SUBIDA A PRODUCCIÓN, EN ORDEN

### Paso 1 — El código que ya tiene su migración corrida

`setup-event-time` **ya está en main**, así que esto sube solo.

```
git push origin main
```

No es un commit, son varios, y NO voy a poner un total ni un hash de tip: este archivo
es uno de los commits que se van en ese push, así que cualquier número o hash que
escriba acá lo invalida el commit siguiente. Es la misma falla que la sección 5 cuenta
sobre AGENTS.md, y no la voy a repetir en el plan para arreglarla.

Lo que sí importa es QUÉ va, en dos grupos:

- **Código y contexto**: `cf76695` (registro obligatorio), `a9b9054` (organizador),
  `2472ae8` y `3b2e30e` (AGENTS/CLAUDE), `84ac242` (la hora de inicio), más los de este
  archivo.
- **Rutas de migración de los pasos 2, 3 y 4**: `2049dda` y `a4d46a2`. Tienen que estar
  desplegadas para poder llamarlas, y **desplegar una ruta de migración no la corre**:
  las corrés vos, en los pasos que siguen.

Corré `git log --oneline origin/main..HEAD` antes de pushear: eso es la lista de verdad,
y el tip que ahí salga primero es el que tiene que quedar READY en Vercel.

**Qué verificar en producción:**
- `node scripts/post-deploy.mjs` → **27 lecturas, 0 rotas**, y **sin deriva de
  esquema**. Si alguna sale *omitida* la página pasa a `dudosas`, que no es lo mismo que
  rota: hay dos lecturas que se saltean solas si no hay con qué probarlas —los lineups
  cuando no hay eventos, y el filtro de artistas si falla el índice de géneros.
  Ojo: dev ahora tiene MENOS columnas que main (le borré las muertas y la cédula), y el
  comparador recorre dev buscando qué le falta a main, así que eso **no** va a dar
  alarma. Si da una, leela con cuidado.
- `/eventos` en 200, y los eventos sin hora **sin mostrar hora ni duración**.
- `/admin/organizadores` carga para tu sesión y lista los eventos sin organizador.
  Main tiene 4 eventos; si alguno ya tiene organizador, va a aparecer menos.
- Editá un evento desde tu panel, ponele hora de inicio **01:00**, y verificá que la
  página diga que empieza **la madrugada del día siguiente**. Es el único camino para
  comprobar la regla en producción, porque main no tiene horas cargadas.

### Paso 2 — Cédula

```
/api/setup-borrar-cedula?secret=$MIGRATE_SECRET&dryRun=1
/api/setup-borrar-cedula?secret=$MIGRATE_SECRET
/api/setup-borrar-cedula?secret=$MIGRATE_SECRET
```

**Qué espero ver, y acá el número SÍ está medido:** vos lo contaste directo en Neon y main
tiene **exactamente 1 fila con cédula**, tu propio perfil, el único. Así que:

- dryRun → `verificado:false` (la columna todavía está) y **`filasConCedula: 1`**.
- corrida 1 → **`vaciadas: 1`** y `verificado:true`.
- corrida 2 → `vaciadas: 0`, idempotente.
- Las cuentas totales, iguales en las tres.

**Si el dryRun dice otro número, PARÁ y no corras la real.** No es un detalle de prolijidad:
cualquier valor distinto de 1 significa que alguien escribió una cédula después de que
supuestamente se dejó de escribir la columna, y entonces la premisa de toda la migración
—"nada la toca desde hace tandas"— es falsa y hay que averiguar quién antes de borrar
nada irreversible. Un 0 tampoco es inocente: querría decir que la fila que medís se fue
sola.

El `1` de dev es una coincidencia y no vale como confirmación: allá planté una fila a mano
para que el conteo tuviera algo que contar. Los dos unos no tienen nada que ver.

**Antes de correrla**, por si alguien creó algo a mano fuera del repo:

```sql
SELECT indexname FROM pg_indexes WHERE tablename='user_profiles' AND indexdef LIKE '%cedula%';
SELECT conname FROM pg_constraint WHERE conrelid='user_profiles'::regclass
  AND pg_get_constraintdef(oid) LIKE '%cedula%';
```

Las dos tienen que dar vacío. En dev dieron vacío.

**No necesita deploy después:** ningún código la usa.

### Paso 3 — `collective_ownership`

```
/api/setup-borrar-collective-ownership?secret=$MIGRATE_SECRET&dryRun=1
```

**Mirá el conteo antes de seguir.** Si el dryRun dice 0 filas, corré las dos pasadas.
**Si dice más de 0, PARÁ**: son cesiones del código viejo y hay que copiarlas a
`profile_ownership` antes. La corrida real se niega sola con 409 y la lista, pero mejor
verlo en el dryRun.

### Paso 4 — Las columnas muertas

```
/api/setup-borrar-columnas-muertas?secret=$MIGRATE_SECRET&dryRun=1
```

**Leé los cuatro números del dryRun antes de correrla.** `sets` y `top_tracks` no
existen en ningún otro lado: lo que digan esas dos líneas es lo que desaparece para
siempre. En dev eran 12 y 12 de placeholders del prototipo.

Si estás de acuerdo con perderlos, las dos pasadas. **No necesita deploy.**

### Paso 5 — El cierre, que es el único que mide si los cuatro pasos salieron

```
node scripts/post-deploy.mjs
```

**Recién acá el comparador de esquemas sirve de verdad.** Mientras dev va adelante, su
diff es ruido esperable; después de los pasos 2, 3 y 4 **las dos bases quedan en la misma
forma**, y entonces "0 faltantes, 0 distintas" pasa a ser una afirmación con contenido.
La única diferencia que tiene que quedar es `zz_test_lock`, informada como solo-dev.

Si después de esto el comparador nombra **cualquier** columna, no la ignores: significa
que una de las tres migraciones no hizo lo que su log dijo.

Y el smoke tiene que seguir en **27 lecturas, 0 rotas**. Es el chequeo que importa de los
pasos 3 y 4: varias lecturas hacen `SELECT *` sobre `artists` y `collectives`, así que si
borrar esas columnas rompiera algo, se cae acá. **En dev ya corrió así** —la suite
completa, después de los drops— pero main tiene datos distintos.

### Después de eso

Nada más está listo para subir. Galería, Prensa, Rider y STATS esperan las decisiones
de la sección 3.

---

## 5. COSAS RARAS QUE ENCONTRÉ

**El dev server parpadea, y lo hizo dos veces con dos caras distintas.** Primero un 404
con cuerpo vacío en el caso de las `06:00` de la batería de la hora; reproducido aislado
en 05:59, 06:00 y 06:01 —los tres 201— y limpio al re-correr. Después, en la corrida
completa de la suite, `registro-obligatorio` murió a mitad con `ECONNREFUSED`, y las dos
baterías que vinieron **después** pasaron sin problema, así que el server estaba vivo:
fue un bache de un instante. Re-corrida sola, dio 18 OK, 0 MAL.

Las dos veces el síntoma tenía forma de hallazgo —un 404 se lee como ruta que no existe,
un ECONNREFUSED como server caído— y las dos veces era el entorno. **Si ves un MAL raro y
aislado, re-corré esa batería sola antes de investigar el código.**

**El clasificador de Bash falló varias veces durante la sesión**, con un error
transitorio que no es un juicio sobre el comando. Cuando pasó seguí con lecturas y
ediciones, que no lo necesitan, y volví después.

**EL UMBRAL DE CONDICIONALES DE `entity_kind` YA SE CRUZÓ — Y LA MÉTRICA NUEVA ESTÁ
DEFINIDA, CORRIDA Y PROBADA, PERO NO APLICADA.**

Decidiste no separar venues de colectivos, y pusiste la condición correcta: cambiar cómo
se mide no puede ser una forma de apagar la alarma. Así que la métrica nueva está escrita
como código corrible y no como un criterio mío, en
[scripts/metrica-entity-kind.mjs](scripts/metrica-entity-kind.mjs):

```
node scripts/metrica-entity-kind.mjs            # el informe
node scripts/metrica-entity-kind.mjs --detalle  # los 60 casos, uno por uno
node scripts/metrica-entity-kind.mjs --probar   # se prueba a sí misma
```

**Tres cosas para que no sea un apagador de alarmas**, y están puestas en ese orden a
propósito:

1. **La medición vieja se sigue imprimiendo, con su límite y con su estado.** No se
   reemplaza ni se corrige: el informe arranca diciendo `60 líneas, PASADA (total 60 > 50)
   (un archivo 14 > 10)` y abajo `DECISIÓN TOMADA: no separar`. Si alguna vez el script
   dejara de imprimir eso, la métrica nueva pierde todo su valor como argumento.
2. **El límite nuevo se DERIVA del viejo, no se elige para que hoy pase.** El viejo daba
   1,5625× la base (50 sobre 32) y 1,4286× el peor archivo (10 sobre 7). Los mismos
   factores sobre la base nueva dan 29,7 y 7,1, y los redondeé **hacia abajo**: la misma
   holgura, medida distinto, y si hay que errar que sea por exigente.
3. **Se prueba a sí misma: 28 chequeos, 0 MAL.** Incluye una corrida de punta a punta
   contra un fixture de 8 ramas en un archivo, que verifica que sale con código 1, que
   nombra el archivo, que cuenta 8 y no el vocabulario, y que sigue imprimiendo la
   medición vieja. Existe porque un "dentro" puede significar que el código está bien o
   que el clasificador no clasifica nada, y esas dos cosas hay que poder distinguirlas —el
   mismo razonamiento que `arnes.mjs` sobre el barrido que daba cero.

**LA REGLA, QUE ES LO QUE PEDISTE POR ESCRITO.** La unidad es la línea, igual que el grep
viejo, para que los dos números se comparen. Si una línea tiene varias menciones y alguna
es rama, la línea es rama.

| clase | cuenta | qué es |
|---|---|---|
| **RAMA** | **sí** | el código hace algo distinto: un `if`, un bloque que aparece o no, campos distintos en el payload, una consulta que se saltea, datos que se filtran, otro estado inicial |
| VOCABULARIO | no | un ternario cuyas **dos** ramas son un literal de string o template: cambia la palabra, no el flujo. `esVenue ? "venue" : "colectivo"` |
| DECLARACION | no | la mención introduce o tipa la bandera: `const esVenue = …`, `esVenue?: boolean`, un default de destructuring, un campo que se mapea |
| COMENTARIO | no | no es código |

**Es conservadora a propósito: ante la duda, RAMA.** Un ternario con una sola rama
no-literal cuenta como rama aunque en los hechos sea un texto —`publicar-evento` tiene
`esVenue ? destino.name : "Dónde es"`, que es un placeholder— porque la alternativa es que
el clasificador empiece a opinar sobre qué expresión "es en el fondo" una palabra, y ahí
la métrica vuelve a ser un juicio. Una métrica nueva que se equivoca tiene que equivocarse
**disparando de más**.

**CUÁNTO DA HOY**, de los 60 que el grep viejo cuenta:

| clase | n |
|---|---|
| RAMA | **19** |
| VOCABULARIO | 25 |
| DECLARACION | 15 |
| COMENTARIO | 1 |
| total | 60 |

Las 19 ramas, por archivo: `panel-colectivo` 5, `create-collective-button` 4,
`collective-info-editor` 3, `publicar-evento` 2, y cinco archivos con 1 —
`collective-join-button`, `collective-members-editor`, `collective-metrics`,
`membership-inbox`, `lib/collectives-write`.

Fíjate en el cambio de forma: el peor archivo pasa de **14 a 5**. Los 14 de
`panel-colectivo` eran trece cambios de palabra colgados de un solo `const esVenue`.

**EL LÍMITE QUE PROPONGO: 30 ramas en total, 7 por archivo.** Hoy da 19 y 5, o sea
`dentro`. Y clasifiqué los 60 a mano ANTES de escribir el script: coinciden caso por caso,
los 60, lo que me deja algo más tranquilo de que la regla describe lo que hay y no lo que
me convenía.

**NO CAMBIÉ EL UMBRAL DE AGENTS.md.** Pediste ver el número y el límite antes, así que lo
que hay es la propuesta y la herramienta; el archivo que se autocarga sigue diciendo 32 /
50 / 10 y sigue siendo el que manda. Cuando lo confirmes, el cambio que haría es: dejar el
párrafo viejo entero —incluido que se pasó y que se decidió no separar— y agregar abajo el
límite nuevo con el comando. Tres frases, sin borrar nada.

**Y HAY DOS DEFECTOS DEL COMANDO VIEJO que conviene saber, aunque no cambian la
conclusión** —60 pasa de 50 con cualquier criterio:

- **Cuenta un comentario como si fuera un condicional.** El de `like-button.tsx:15` dice
  que un `if (esVenue)` ahí sería una copia disfrazada: el comentario que explica por qué
  **no** hay una rama se cuenta como rama. Es la trampa que AGENTS.md advierte en otra
  sección, y la comete el comando de AGENTS.md. Es 1 de 60.
- **Cuenta líneas y dice "condicionales".** `grep -c` cuenta líneas, no menciones: hay
  **68 menciones en 60 líneas**, medido por separado con `grep -o | wc -l` y con el script,
  que dan lo mismo. La diferencia son las ocho líneas `const esVenue = entityKind ===
  "venue"`, que matchean los dos patrones a la vez. O sea que si alguien "arreglara" el
  comando para contar menciones, el total **subiría a 68** sin que el código cambiara una
  coma. (Mi primera versión de esta línea decía 61, de memoria. Lo medido es 68.)

**Mi propia migración dejó mintiendo al archivo que se autocarga, y lo arreglé.**
AGENTS.md decía *"39 tablas en dev y 38 en main"* —medido anoche, correcto cuando lo
escribí— y después `setup-borrar-collective-ownership` dejó dev en 38. O sea que el
archivo quedó afirmando un número falso **por culpa de un commit posterior de la misma
sesión**.

Lo corregí en los dos archivos (md5 idéntico), y aproveché para escribir lo que el
número solo no decía: **ahora son 38 y 38, y no son las mismas 38.** Dev tiene
`zz_test_lock` y no tiene `collective_ownership`; main es al revés. Dos bases pueden dar
el mismo total y tener tablas distintas, que es exactamente la clase de coincidencia que
hace leer "están iguales".

**Dev y main ya no tienen el mismo esquema, y a propósito.** Dev tiene borradas la
cédula y las cuatro columnas muertas, y `collective_ownership` ya no existe allá. Es el
estado correcto —dev va adelante— pero significa que **el comparador de esquemas no es
simétrico**: recorre dev buscando qué le falta a main, así que columnas que main tiene
y dev no **no se reportan**. No es un bug del comparador, es su diseño, pero conviene
saberlo esta mañana.

**Y el CHECK de `door_price_cop` sigue siendo invisible para el post-deploy.** Ya está
anotado en PROGRESO.md: el comparador mira tablas y columnas, **no constraints**. La
migración de anoche ya lo saldó en main, así que esto es solo para que no lo busques.

---

## 6. LA SUITE Y EL TYPECHECK

`npx tsc --noEmit` → **exit 0**, sin un error.

Las 14 baterías, corridas **después** de borrar las columnas en dev, que era justamente
el punto: varias lecturas hacen `SELECT *` sobre `artists` y `collectives`.

| batería | OK | MAL |
|---|---|---|
| arnes | 24 | 0 |
| comparador | 15 | 0 |
| fks-cuenta | 11 | 0 |
| ban | 27 | 0 |
| eliminar | 38 | 0 |
| limpieza | 65 | 0 |
| reclamos | 56 | 0 |
| traspaso | 41 | 0 |
| residencias | 62 | 0 |
| organizador | 33 | 0 |
| precio-taquilla | 24 | 0 |
| registro-obligatorio | 18 | 0 |
| venta-apagada | 17 | 0 |
| hora-evento | 34 | 0 |
| **total** | **465** | **0** |

**Con una salvedad honesta sobre `registro-obligatorio`**: en la corrida completa no
llegó al final —se cayó con `ECONNREFUSED` a mitad, el bache del dev server que está en
la sección 5— y el 18 sale de **re-correrla sola** después. Las otras trece son de la
corrida de una sola pasada. Lo aclaro porque "465 OK" suena a una sola medición y no lo
es.
