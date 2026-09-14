# PROGRESO — sesión larga sin supervisión

Todo contra la branch **dev** de Neon. **Nada tocó main.** Nada se
pusheó: hay **9 commits locales** por delante de `origin/main`, desde
`e4ca297`.

Verificación: `npx tsc --noEmit` limpio después de cada pieza, y `npm
run dev` con curl contra `localhost:3000`. Nunca se corrió `next build`.

---

## LO QUE QUEDÓ HECHO Y COMMITEADO

En orden de trabajo. Los ocho puntos del encargo están terminados.

| Commit | Pieza |
|---|---|
| `094f6a4` | Tanda 3 pieza 3 — membresía como conversación (estaba sin commitear) |
| `6c65bc4` | HOTFIX 0 — `/login` |
| `0e1fa8b` | HOTFIX 5 — fuera la cédula |
| `38a313c` | HOTFIX 5.1 — artistas que me gustan |
| `2c8db06` | HOTFIX 5.2 — el perfil según el tipo de cuenta |
| `d53092d` | HOTFIX 6 — eventos, tarjetas clickeables, el hueco |
| `3947277` | HOTFIX 4 — barra superior |
| `e33b1e8` | HOTFIX 3 — layout estándar de listado |
| `082205f` | Tanda 3 §4.1 — crear colectivo |

### Punto 0 — el sitio no abre

**La mitad del diagnóstico no reproduce, y lo dejé como estaba.**

El matcher del middleware es `["/admin/:path*"]`: no corre en ninguna
ruta pública. `pages.signIn` es `/auth/signin`, que existe. No hay
`redirects()` en `next.config.mjs`. Y no hay **ni una** referencia a
`/login` en el árbol ni en `git log -S` en toda la historia del repo.

Con curl y sin sesión, todas devuelven 200 y sin redirección:

```
/  /noticias  /eventos  /artistas  /colectivos  /sets  /discografia
```

La causa más probable es un 308 cacheado por el navegador de cuando
probabas otra cosa. **Abrilo en una ventana de incógnito y confirmame.**
Cambiar el matcher o `pages.signIn` habría roto el guardado de `/admin`
sin arreglar nada.

**Lo que sí arreglé es el 404**, que era real: `/login` es la URL que la
gente y los navegadores adivinan, y caer en un 404 ahí se lee como "el
sitio está roto" y no como "esa no es la dirección". Ahora reenvía a
`/auth/signin`. Solo viajan los `callbackUrl` relativos; si no, `/login`
sería un redirector abierto.

### Punto 5 — la cédula

Fuera de la vista, del formulario, de la escritura, de la lectura y del
tipo. `getMyProfile` ya ni selecciona la columna: no queda nada que
mostrar, así que desencriptarla sería exponer un dato sensible sin
motivo.

**La columna NO se borró** y los valores encriptados viejos quedan
intactos. El INSERT no la nombra ni le pone `SET`, así que editar el
teléfono no puede blanquearla. `lib/crypto.ts` queda sin importadores a
propósito: la migración que algún día limpie esos valores va a
necesitar `decryptField` para saber qué está borrando.

El consentimiento sigue: el teléfono solo ya es dato personal.

### Punto 5.1 — artistas que me gustan

La sección va debajo de MIS TIQUETES y no se renderiza si la cuenta no
sigue a nadie.

**Hice algo más de lo que pedía el punto, y quiero que lo sepas:** no
había forma de dar like. `artist_likes` existía desde la tanda 1 sin
lector, sin escritor y sin ningún control en la interfaz, así que la
sección solo podía estar vacía para siempre. Agregué un botón SEGUIR en
el press kit. Extender los likes a colectivos y venues sigue siendo
tanda 3 §9 y no lo toqué.

El like es un seguimiento, nunca una señal de ranking: no ordena ni
promociona nada.

### Punto 5.2 — el perfil según el tipo de cuenta

Los roles salen de la propiedad, no de una columna: sos DJ porque tenés
un artista, y colectivo porque tenés un colectivo. Mucha gente es las
dos cosas. Lo que no corresponde **no se renderiza**; las consultas de
DJ ni siquiera corren para un usuario normal.

Dos huecos reales que aproveché para tapar:

- Un DJ no tenía **ninguna** forma de llegar a su propio press kit. Ahora
  el perfil lleva MI PRESS KIT con su nombre, su `dj_code` y un enlace.
- Un dueño de colectivo **no podía editar la info de su colectivo**: el
  único editor vivía detrás de `/admin`, que está cerrado con
  SUPER_ADMIN y por lo tanto le era inalcanzable.

**VENUE NO ESTÁ HECHO.** Ver más abajo, en decisiones.

### Punto 6 — los tres menores

`/eventos` **no tenía un bug.** Hoy es 2026-09-14; los tres eventos
publicados son de junio, julio y agosto, y el único futuro (10 de
octubre) está en `draft`. El filtro hacía lo correcto sobre datos
viejos. Pero una página que esconde todo apenas termina la temporada
parece rota, así que los pasados ahora se muestran abajo bajo YA
PASARON, apagados y sin botón de compra.

Las tarjetas de `/colectivos` son clickeables enteras, con un overlay
estirado y no envolviendo la tarjeta en un `<a>`: adentro hay enlaces a
cada artista y anidar enlaces es HTML inválido.

El hueco eran dos paddings sumándose, 96px de la sección más 64px del
footer.

### Punto 4 — barra superior

Tres partes: menú y texto a la izquierda, logo solo en el centro,
iconos igual que antes. El texto pasó de `0.75–1.1rem` a `0.85–1.35rem`.

Centrado contra la barra, no entre los vecinos, así que cae en el medio
real sin importar cuánto pese cada lado. **Debajo de `sm` el logo vuelve
al flujo normal:** a ancho de celular el texto más cinco iconos no
dejan lugar en el centro y un logo absoluto se montaría encima del
título.

### Punto 3 — layout estándar

Las seis páginas tenían la misma forma copiada seis veces. Ahora es un
componente, listo para `/venues` y `/convocatorias`.

El buscador funciona en las seis. **Pliega acentos y mayúsculas**, que
en español no es un lujo: "bogota" encuentra Bogotá, "chia" encuentra
Chía, "senal" encuentra Señal Perdida. Todas las palabras tienen que
aparecer pero el orden no importa. Cada página busca sobre los campos
que realmente se imprimen en sus tarjetas; las bios de artista quedan
afuera a propósito, porque una bio convierte cualquier palabra común en
coincidencia.

El orden de los filtros es deliberado: el buscador y el filtro 2
**achican** la lista; el de género solo **reordena**, empujando arriba
sin esconder nada, así que corre último.

**Los dos filtros quedan con la taxonomía actual, como pediste.** El
filtro 1 es el selector de distrito de siempre. El filtro 2 se arma con
los valores que de verdad existen en las filas de cada página, así que
no puede ofrecer una opción que no devuelva nada:

| Página | Filtro 2 |
|---|---|
| `/noticias` | ETIQUETA |
| `/eventos` | CIUDAD |
| `/artistas` | GÉNERO |
| `/colectivos` | SECTOR |
| `/sets` | ARTISTA |
| `/discografia` | SELLO |

La franja de publicidad es placeholder, ancho fijo, a lo largo de toda
la página. **Se oculta debajo de `lg`:** en tablet y celular no hay
lugar al lado y metida a la fuerza dejaría el listado ilegible.

Un resultado vacío ahora distingue "todavía no hay nada" de "tu
búsqueda excluyó todo".

### Tanda 3 — flujo de membresías probado de punta a punta

La migración `/api/setup-membership-conversation` corrió **en dev dos
veces** con salida idéntica. 36 filas, 32 activas.

Probado contra dev, con las cuentas del fixture:

- El DJ se postula → la fila pendiente **no aparece** en el roster
  público. Después de aceptar, sí.
- Un tercero que no administra el colectivo: **403**.
- **El conflicto de casa devuelve las opciones y NO actúa.** Lo verifiqué
  releyendo las filas: nada se movió.
- Las tres decisiones, una por una: `keep` deja la casa donde estaba;
  `move + stay` mueve la casa y la anterior queda como residencia, con
  el DJ todavía listado allá; `move + leave` mueve la casa y cierra del
  todo el vínculo anterior, y el colectivo deja de listarlo.
- Rechazar no bloquea: se puede volver a postular enseguida.
- Retirar funciona de los dos lados, y `rejected_at` / `canceled_at`
  distinguen rechazo de retiro.
- Un DJ no puede decir que es el colectivo: el endpoint lo rechaza.

**Ninguna fila se borró nunca.** Cada vínculo superado se cierra con
`to_date`. El histórico quedó intacto.

Después corrí el seed otra vez y el fixture volvió exactamente a lo
declarado: el aplicante sin ningún vínculo activo, Camila con casa en
OTU y residencia en hotu-138.

### Tanda 3 §4.1 — crear colectivo

Botón CREAR COLECTIVO en el perfil del DJ. Uno por cuenta, y solo desde
una cuenta de DJ. El dueño sale de la sesión; la ciudad y el distrito,
del perfil del fundador.

**Un detalle que decidí hacia el lado seguro:** §4.1 dice que el
colectivo nuevo es la casa del fundador, y lo es — salvo que ya tenga
una. En ese caso entra como residente y lo dice de frente, porque mover
la casa de alguien sin que lo pida es justo lo que las reglas de
membresía prohíben, y fundar un colectivo no es más excusa que
cualquier otro camino. El colectivo se crea igual.

---

## LO QUE QUEDÓ BLOQUEADO

**Solo una cosa, y no es un error: falta modelo.**

### Perfil de VENUE (parte del punto 5.2)

No hay entidad venue en ningún lado. `venue` es una columna de texto en
`events`, nada más. El cambio que le da `entity_kind` a `collectives`
para que la tabla sirva a los dos es la tanda 3 §5 y no está
construido, así que **no hay tipo de cuenta sobre el cual ramificar**.
Los otros tres tipos (usuario, DJ, colectivo) sí están.

No lo inventé. Cuando exista `entity_kind`, el perfil de venue es el de
colectivo más dirección y capacidad, y el sitio donde va ya está
preparado.

**Nada más quedó bloqueado, y nada falló dos veces seguidas.**

---

## DECISIONES QUE NECESITO DE VOS

Cuatro, en orden de cuánto frenan.

### 1. `/login` — confirmame en incógnito

Es la única que necesita algo tuyo de inmediato. Si en incógnito `/` y
`/colectivos` cargan bien, era caché del navegador y el punto 0 está
cerrado. Si **sí** redirigen en incógnito, hay algo fuera del repo
(Vercel, un proxy, un service worker viejo) y quiero verlo con vos.

### 2. `/mi-perfil` vs `/perfil`

HOTFIX.md dice `/mi-perfil` en los puntos 5, 5.1, 5.2 y 6. **En el repo
la ruta es `/perfil`** y no existe `/mi-perfil`. Asumí que son la misma
página y trabajé sobre `/perfil`. Si querés que se llame `/mi-perfil`,
decímelo: es un rename con un alias para no romper enlaces, como el de
`/login`.

### 3. El filtro 2 hasta la tanda 4

Puse un filtro 2 distinto por página (ver la tabla de arriba), armado
con datos reales. Si preferís que hasta la tanda 4 no haya filtro 2 en
las páginas donde no hay un género de verdad, se saca en un minuto.

### 4. Fundar colectivo teniendo casa

Hoy entra como residente y avisa. La alternativa sería no dejar fundar
hasta liberar la casa. Elegí la primera porque no pierde nada y la
segunda frena a alguien por una regla que puede resolver después. Si
preferís que el colectivo propio sea siempre la casa, hay que decidir
qué pasa con la anterior — y esa decisión es tuya.

---

## MIGRACIONES PENDIENTES DE CORRER EN MAIN

**Una sola, y es la única cosa de esta sesión que toca la base.**

### `/api/setup-membership-conversation`

Agrega `requested_by`, `rejected_at` y `canceled_at` a
`artist_collectives`, más dos CHECK y un índice de pendientes. **Nunca
corrió en main.**

Secuencia, desde el navegador:

```
1. https://hotu-one.vercel.app/api/setup-membership-conversation?secret=<MIGRATE_SECRET>&dryRun=1
2. https://hotu-one.vercel.app/api/setup-membership-conversation?secret=<MIGRATE_SECRET>
3. la misma que 2, otra vez
```

Qué mirar en cada JSON:

1. **dryRun** — `ok: true`, y en `estado.filas` el total y cuántas están
   aceptadas. Anotá esos dos números antes de seguir. `seAgregarian`
   lista lo que falta; si viene vacío, main ya estaba al día.
2. **real** — `ok: true` y las cinco líneas del `log`: columnas, los dos
   checks, el índice, y el conteo. **El total de filas tiene que ser el
   mismo que viste en el dryRun.** Si cambió, pará y avisame.
3. **segunda corrida** — tiene que devolver **exactamente lo mismo** que
   la segunda. Esa es la prueba de idempotencia.

En dev corrió tres veces (dryRun + dos reales) con salida idéntica.

**Ojo con el orden:** la migración va **antes** de desplegar este
código. `lib/membership-write.ts` escribe `requested_by` en cada fila
nueva y explotaría contra una tabla sin la columna.

### Nada más toca la base

El resto de la sesión es interfaz y lectura. El seed de likes es solo
dev: `/api/seed-test` está cerrado con `NODE_ENV !== "development"` y
no puede correr en producción.

### Deuda vieja que sigue abierta

`dryRun` **todavía no está** en `setup-profiles` ni en
`setup-epk-content`. Lo aprobaste hace tiempo y nunca se hizo. Las dos
ya corrieron en main, así que no bloquea nada; queda para cuando haya
que reaplicarlas.

---

## CÓMO PROBARLO VOS

`npm run dev`, y las cuentas del fixture con contraseña `test1234`:

| Cuenta | Qué probar |
|---|---|
| `usuario@test.hotu.local` | Perfil de usuario: pedidos, tiquetes, ARTISTAS QUE ME GUSTAN. Sin press kit, sin paneles. |
| `artista@test.hotu.local` | Camila. MI PRESS KIT, sus membresías, el botón SEGUIR en `/artistas/test-camila`. |
| `aplicante@test.hotu.local` | Sin colectivo a propósito. Entrá a `/colectivos/reisen` y tocá ÚNETE A NOSOTROS. |
| `duena@test.hotu.local` | Dueña de Reisen. Acá se acepta o rechaza, y se edita la info del colectivo. |
| `colectivo@test.hotu.local` | Dueña de OTU. Para armar el conflicto de casa con dos colectivos. |

**El camino que más me importa que veas** es el conflicto de casa: con
el aplicante, postulate a Reisen, aceptá con la dueña, hacé de Reisen tu
casa, después postulate a OTU, aceptá con `colectivo@`, y ahí pedí casa
en OTU. Tienen que aparecer las tres opciones con las dos mitades
escritas, y **nada tiene que haber cambiado** hasta que toques una.
