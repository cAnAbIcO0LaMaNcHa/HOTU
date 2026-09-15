# HOTU — Alta de cuenta y de perfil de DJ

Spec. Nada de esto está construido todavía.

## Por qué

Hoy **nadie puede crearse una cuenta en HOTU**, ni de DJ ni normal.
`upsertAccount` en `lib/accounts.ts` crea la fila de `user_profiles` pero
nunca escribe `password_hash`, y el único lugar del repo que lo escribe
es el seed de desarrollo. El Credentials provider solo puede autenticar a
las cinco cuentas del fixture, y la única puerta real es Google.

Los artistas, además, solo nacen por migración o por seed. Toda la
aplicación está construida sobre perfiles de DJ y no hay forma de crear
uno.

Son dos escalones distintos y siguen separados, porque el modelo del
proyecto ya lo dice: **una sola cuenta con roles activables**.
Registrarse no te convierte en DJ.

---

## Decisiones tomadas

1. **Crear libre, publicar aprobado.** Cualquiera crea su perfil al
   instante y lo llena sin esperar. Lo que se aprueba es publicarlo.
2. **Verificación de email: después.** No entra en esta pieza. Queda
   anotado que hasta que exista, cualquiera se registra con un correo que
   no controla.
3. **Una cuenta de Google entra por Google.** Ver la sección propia: no
   es un caso borde, es toma de cuenta.
4. **La aprobación es un interruptor**, no un cimiento. Apagarlo tiene
   que bastar para pasar a aprobación automática.

---

## Pantalla 1 — `/auth/registro`

La cuenta. No pide nada de género ni de artista.

| Campo | Obligatorio | Validación | Destino |
|---|---|---|---|
| Email | sí | formato, normalizado a minúsculas | `user_profiles.email` (PK) |
| Contraseña | sí | mínimo 10 caracteres | `password_hash` vía `hashPassword` |
| Repetir contraseña | sí | igual a la anterior, se compara en el cliente y en el servidor | — |
| Nombre para mostrar | sí | 2 a 60 caracteres | `display_name` |
| Fecha de nacimiento | sí | fecha válida y **18 años cumplidos** | `birth_date` |
| Autorizo el tratamiento de datos | sí | tiene que estar marcada | `consent_at = now()` |

También escribe `auth_provider = 'credentials'`.

**No pide cédula.** Es dato sensible bajo la Ley 1581 y `birth_date`
cubre lo único para lo que servía, que es la mayoría de edad.

Código nuevo: `createAccount()` en `lib/accounts.ts` y `POST
/api/accounts`. Un enlace desde `/auth/signin`, que hoy no ofrece
ninguno.

### Un email que ya existe

Esto no es validación de formulario, es seguridad. Si el formulario
dejara poner contraseña a un email que ya es cuenta de Google, cualquiera
que sepa tu correo se queda con tu cuenta.

La regla: **la respuesta es siempre la misma, exista o no la cuenta.**

- Si el email no existe, se crea.
- Si existe con `auth_provider = 'google'`, **no se toca nada**.
- Si existe con `auth_provider = 'credentials'`, **no se toca nada**.

En los tres casos la pantalla dice lo mismo: *"Si ese correo no tenía
cuenta, ya está creada. Entrá abajo."*, con el formulario de ingreso
debajo, y ofreciendo también el botón de Google.

Y en los tres casos se paga el costo de un `scrypt`, aunque no se vaya a
guardar. Sin eso, el tiempo de respuesta delata cuál de los tres casos
fue, que es exactamente el ataque. Hay precedente en el repo:
`verifyCredentials` ya usa un `DUMMY_HASH` por esta misma razón.

**Costo consciente:** el registro NO inicia sesión solo. Iniciarla
automáticamente solo cuando la cuenta es nueva sería la filtración
misma. El usuario entra a mano en el paso siguiente, lo cual funciona si
la cuenta es suya y falla si no, y ese fallo ya es indistinguible de una
contraseña equivocada.

Falta también límite de intentos por IP, porque sin eso la enumeración se
hace igual a fuerza bruta aunque cada respuesta sea idéntica.

---

## Pantalla 2 — Crear el perfil de DJ

Desde `/perfil`, al lado de CREAR COLECTIVO y CREAR VENUE, que ya
funcionan así. Dos pasos, **una sola escritura al final**: un alta
abandonada a mitad no puede dejar una fila, ni un slug ocupado, ni un
`dj_code` reservado.

### Paso 1 — identidad

| Campo | Obligatorio | Validación | Destino |
|---|---|---|---|
| Nombre artístico | sí | 2 a 80 caracteres | `artists.name` |
| Dirección del perfil | derivado | se propone del nombre, editable, único | `artists.slug` (PK) |
| Código de DJ | sí | solo letras, 3 a 12, único sobre `upper()` | `artists.dj_code` |
| Ciudad donde vivís | sí | 2 a 80 | `artists.city` |
| De dónde sos | no | 2 a 80 | `artists.origin` |

El slug se muestra antes de confirmar y **no se puede cambiar después**:
es la PK y la URL que la gente comparte. Mismo criterio que colectivos.

El `dj_code` es lo que se dicta en la puerta y lo que va a atribuir las
ventas, así que solo letras, sin guiones ni números, y con chequeo de
disponibilidad en vivo. El índice único es sobre `upper(dj_code)`: CAMILA
y camila son el mismo código.

### Paso 2 — género

| Campo | Obligatorio | Regla |
|---|---|---|
| Branch primario | sí | uno solo, de 34 |
| Branches secundarios | no | hasta 3, distintos del primario |
| Tags | sí | de 3 a 8; los 3 primeros son los primarios |

Elegir el branch primero es lo que hace navegables 719 tags: al elegirlo,
la lista se reduce a los de esa rama, unos 20.

**Pero el selector no puede quedar encerrado en el branch elegido.** 71
slugs de tag viven en más de una rama y `electro-house` vive en tres. Un
DJ de TECHNO tiene que poder tomar `acid-techno` desde ACID. El buscador
de tags mira las 719 y muestra de qué rama viene cada una.

Esto escribe `artist_genres` y `artist_genre_tags` con `setGenres()`, que
ya existe en `lib/genres-write.ts` y ya hace cumplir las cuatro reglas.

### Dos columnas viejas que hay que resolver antes

`artists` tiene siete columnas NOT NULL sin default, y dos no salen del
formulario:

- **`genre`** se llena con el nombre del branch primario. Así la columna
  sigue significando algo y el filtro actual de `/artistas` sigue
  andando hasta que la pieza 3 lo reemplace por el filtro de branch.
- **`district`** no tiene de dónde salir. Migración chiquita que le ponga
  `DEFAULT 'D00'`, para que el formulario nunca lo mencione. Se va a
  borrar igual en la pieza 3.

El resto: `bio` arranca vacía, `joined_at` es hoy, `owner_email` es el
email de la sesión.

### El vínculo con la cuenta

`artists.owner_email` es todo el vínculo. `canEditArtist` compara contra
él y `getMyArtistSlug` lo usa para saber si la cuenta es DJ. No hay tabla
intermedia ni columna de rol: sos DJ porque tenés un artista a tu nombre,
igual que sos dueño de colectivo porque tenés un colectivo a tu nombre.

**Uno por cuenta**, como colectivos y venues.

Una cuenta de Google puede crear su perfil de DJ sin problema: no hace
falta contraseña para nada de esto.

Esto además ordena una secuencia que hoy deja a una cuenta nueva sin nada
que hacer: `createCollective` exige perfil de DJ, y `/perfil` solo
muestra ese botón si ya sos DJ.

---

## Pantalla 3 — El perfil en borrador

El perfil nace con `status = 'draft'` y un `review_status` propio.

**Por qué dos columnas y no una:** `status` es la visibilidad editorial y
la comparten las seis tablas de contenido; meterle un valor nuevo como
`rechazado` afectaría a eventos, noticias y todo lo demás.
`review_status` es dónde está en la cola. Es la misma separación que el
proyecto ya hizo entre `status` y `status_membership`.

| `review_status` | Qué significa | Quién lo mueve |
|---|---|---|
| `borrador` | recién creado, se está llenando | al crear |
| `en_revision` | el DJ lo mandó a aprobar | el DJ |
| `rechazado` | con motivo, se puede corregir y reenviar | el admin |

Aprobar pone `status = 'published'` y limpia `review_status`.

El DJ ve su press kit completo, editable como ya funciona, con una franja
arriba que dice que todavía no es público y el botón ENVIAR A REVISIÓN.
Si fue rechazado, **ve el motivo escrito**, no solo que fue rechazado.

Campos nuevos en `artists`: `review_status`, `review_note`,
`reviewed_at`, `reviewed_by`.

### El cambio que esto obliga

`getArtistBySlug` filtra `status = 'published'`, así que hoy un borrador
daría **404 para su propio dueño**. Tiene que dejar ver el borrador al
dueño y a un SUPER_ADMIN, y seguir dando 404 para cualquier otro. Es el
mismo criterio que `canEditArtist`, que ya existe.

---

## Pantalla 4 — `/admin/artistas`

No existe hoy. El admin tiene colectivos, eventos, noticias, pedidos y
roles.

La cola muestra los `en_revision` con lo que hace falta para decidir:
nombre, slug, código, ciudad, género elegido, bio, y links a sus sets y
tracks. **Se revisa un perfil lleno, no un formulario vacío**, que es el
punto de aprobar la publicación en vez de la creación.

Dos acciones: **publicar**, y **rechazar con motivo**, donde el motivo es
obligatorio y lo va a leer el DJ.

Gated con `isSuperAdmin`, como el resto de `/admin`.

---

## El interruptor

`ARTIST_APPROVAL_REQUIRED`. Apagado, el perfil nace `published` y la cola
queda vacía. Nada más en el sistema mira esta bandera: el único efecto es
el estado inicial y si la pantalla 4 tiene algo que mostrar.

La escena es Bogotá y el volumen es bajo, así que revisar a mano sale
casi gratis hoy. Si algún día no lo es, se apaga y no hay que rehacer
nada.

---

## Por qué se aprueba publicar y no crear

Lo que se lleva un impostor es un slug, que es la PK con cascadas, y un
código de DJ que mañana mueve plata. Deshacer un slug ocupado no es un
click, es una migración. Lo que cuesta la aprobación es que un DJ
legítimo espere. Lo primero es caro e irreversible, lo segundo es barato.

Aprobar antes de crear es lo peor de los dos mundos: obliga a juzgar un
formulario vacío, que no dice nada, y le impide a la persona hacer el
trabajo que haría posible el juicio.

El repo ya venía en esta dirección: `lib/artists-write.ts` excluye
`slug`, `district`, `status` y `dj_code` de lo que un DJ puede editar,
por ser *"identity and editorial decisions rather than profile content"*.

---

## Orden de construcción

1. Migración: `district DEFAULT 'D00'`, y las cuatro columnas de revisión.
   Por el reviewer antes de correrla.
2. `createAccount()` + `POST /api/accounts` + `/auth/registro`.
3. `createArtist()` + `POST /api/artists` + el alta de dos pasos.
4. `getArtistBySlug` con la excepción del dueño y del SUPER_ADMIN.
5. La franja de borrador y ENVIAR A REVISIÓN.
6. `/admin/artistas` con publicar y rechazar con motivo.

Del 2 en adelante, cada paso se puede probar entero antes del siguiente.

---

## Lo que queda anotado y no entra

- **Verificación de email.** Hasta que exista, cualquiera se registra con
  un correo que no controla.
- **Recuperar contraseña.** No existe, y con Credentials en producción se
  vuelve necesaria.
- **Cambiar el slug.** Hoy imposible por diseño. Si alguna vez hace
  falta, es una operación deliberada con `ON UPDATE CASCADE`, no un campo
  del formulario.
