# HOTU — Modelo actualizado y plan de tandas 3 a 6

Este documento reemplaza varias decisiones de tandas anteriores.
Leerlo completo antes de tocar nada.

Qué es HOTU, en una línea: **una red social y un estándar profesional
para DJs y eventos de música electrónica.** No es una plataforma de
pagos. El press kit es el producto.

---

## 1. CAMBIOS QUE ANULAN DECISIONES ANTERIORES

### 1.1 Se eliminan los mínimos de colectivo
Ya NO existe la regla de 3 DJs / 2 residentes. No hay bloqueo para
publicar eventos. No hay estados activo / incompleto.

- `collectives.status_membership` deja de leerse y escribirse.
- **NO borrar la columna.** Solo dejar de usarla.
- Sacar `recalcMembership()` de todos los call sites.

### 1.2 Nombres nuevos de vínculo
`artist_collectives.kind` pasa de `'residente' | 'toca_con'` a:

- **`casa`** — el colectivo principal del DJ. UNO SOLO. "Mi casa".
- **`residente`** — el vínculo general. Varios a la vez.

Migración de datos: lo que hoy es `residente` pasa a `casa`, lo que
es `toca_con` pasa a `residente`. Ojo con el CHECK y con el índice
único parcial de residencia única, que ahora aplica a `casa`.

### 1.3 Se sacan los stats de convocatoria
Sin boletería obligatoria no hay dato honesto de cuánta gente lleva
un DJ. Se elimina "asistentes por fiesta" y el promedio.

Quedan: toques, horas en cabina, distritos, venues, racha.

La atribución por código y `ticket_attributions` se dejan en la base
pero no se usan por ahora. El fee del 10% por vender boletas con HOTU
es una opción futura, no parte del producto base.

### 1.4 Se elimina el agrupamiento por sector
Hoy los colectivos se agrupan por `sector` (Cartagena, Medellín...).
Eso desaparece como agrupador y pasa a ser una etiqueta simple de
ciudad dentro de la información: "Bogotá, Colombia".

---

## 2. GEOGRAFÍA

### 2.1 Ciudad obligatoria al crear
DJ, colectivo y venue deben declarar su ciudad de origen al crearse.
Es campo obligatorio.

**La ciudad es de dónde sos, no dónde estás.** Un DJ de Bogotá que
toca en Berlín sigue siendo de Bogotá.

### 2.2 Selector global
Botón al lado del selector de idioma. Por ahora dice **BOG**. Al
tocarlo despliega ciudades; solo Bogotá habilitada, el resto visible
pero inactivo.

### 2.3 Qué filtra y qué no

- **Eventos y convocatorias** → se filtran por la ciudad donde pasan.
- **Perfiles (DJ, colectivo, venue)** → NUNCA se ocultan. La ciudad
  es una etiqueta de origen, no una pared.

Si un evento de Berlín tiene un DJ de Bogotá, ese DJ se ve en el
lineup con su etiqueta de Bogotá y su press kit se abre normal. El
objetivo es conectar escenas, no separarlas.

### 2.4 Por qué importa
La visión: un DJ de Bogotá ve una convocatoria en Berlín, manda su
press kit con toques y horas verificadas, y arma un tour. El perfil
es lo que le permite conseguir fecha donde no conoce a nadie.

---

## 3. MEMBRESÍA COMO CONVERSACIÓN

Flujo completo, en los dos sentidos:

1. El DJ aplica al colectivo, **o** el colectivo invita al DJ.
2. La otra parte acepta o rechaza. Si rechaza, mensaje de no admitido.
3. **El DJ elige** si el vínculo es `casa` o `residente`.
4. Se confirma. Recién ahí la membresía cuenta.

`accepted_at IS NULL` = pendiente. Una membresía vale solo con ambas
partes de acuerdo. Un colectivo no puede listar a alguien sin permiso.

### 3.1 Cambio de casa
Si el DJ elige `casa` teniendo otra, el sistema le ofrece:

- Mantener la casa actual y entrar acá como `residente`, **o**
- Mover su casa acá. En ese caso, en la anterior elige:
  - quedarse como `residente` (se cierra la fila de casa con
    `to_date` y se abre una de residente), **o**
  - salir del todo.

Nunca hay un estado intermedio con dos casas.

### 3.2 Notificación
El dueño del colectivo siempre se entera cuando pierde a alguien.
Notificación en el panel, no push.

---

## 4. COLECTIVOS

### 4.1 Creación
Un colectivo nace desde una cuenta de DJ: botón "crear colectivo" en
su perfil. **UNO por cuenta.** El creador queda como `owner_email` y
el colectivo es su `casa`.

### 4.2 Administración
El colectivo es entidad propia con su info, pero lo administra el
dueño **sin cambiar de cuenta**: un acceso desde su perfil de DJ.

**Solo el dueño edita.** Para el resto, los controles de edición NO
se renderizan — no basta con ocultarlos.

Panel "quiénes pueden editar" que hoy lista solo al dueño. Los
co-administradores quedan para más adelante.

### 4.3 Press kit del colectivo — `/colectivos/[slug]`
En este orden:

1. Cabecera: nombre, tipo, ciudad, distrito, bio, contacto
2. Carrusel **ARTISTAS DE LA CASA** (foto + nombre)
3. Debajo, carrusel **ARTISTAS RESIDENTES**
4. Sets y tracks republicados
5. Eventos
6. Métricas: horas, eventos, distritos, venues
7. Al final: botón **ÚNETE A NOSOTROS**, visible para un DJ logueado
   que no sea miembro

Desde `/colectivos`, cada tarjeta linkea acá.

### 4.4 Métricas del colectivo
**Solo de eventos que el colectivo organizó.** NO la suma de los
toques de sus miembros — un colectivo de 10 DJs acumularía miles de
horas que no son suyas.

---

## 5. VENUES

Sección propia, cuenta propia, página propia — igual que colectivos.

- `/venues` con su listado, como `/colectivos`.
- Perfil de venue = mismo press kit, más dirección y capacidad.
- Se crea desde una cuenta de DJ, uno por cuenta, mismo modelo de
  dueño único.
- Tiene residentes igual que un colectivo.

### 5.1 Botón CONTÁCTANOS
En el perfil del venue, visible para **cualquiera** — usuario,
artista o colectivo. Para que alguien que quiere armar una fiesta
pueda escribirle. Por ahora muestra el contacto; el flujo de reserva
es de otra tanda.

### 5.2 Nota de implementación
Funcionalmente venue y colectivo son casi idénticos: nombre, bio,
contacto, ciudad, distrito, residentes, eventos, métricas, botón de
unirse. Lo único propio del venue es dirección y capacidad.

Evaluar compartir tabla con un campo de tipo, para no escribir dos
veces el código de membresías, press kit y permisos. **Si eso obliga
a llenar el código de condicionales, separar y avisar.**

Lo que NO se negocia: para el usuario son secciones distintas, con
su propia navegación y su propia identidad.

---

## 6. REPUBLICACIÓN DE CONTENIDO

- **Set o track propio de un DJ** → aparece también en su `casa`
  actual. Si cambia de casa, **migra con él**: sale de la vieja,
  entra a la nueva.
- **Con colaboradores invitados** → queda FIJO donde se publicó.
  No migra nunca.
- **Colaboración entre dos DJs** → aparece en las casas de ambos.

### 6.1 Invitar colaboradores
Al publicar un set o track, opción de invitar colaboradores:
artistas o colectivos. Tener colaboradores es lo que marca la pieza
como fija.

---

## 7. EVENTOS

Hoy `events.lineup` es texto libre — una frase, no una relación. Por
eso los nombres del flyer no son clickeables y no se pueden calcular
métricas de colectivo.

Hace falta relación real evento ↔ colectivo organizador y evento ↔
artistas, **sin perder los lineups actuales**.

---

## 8. CONVOCATORIAS

Página propia. Es un tablón de trabajo de la escena.

### 8.1 Flujo
1. Un venue o colectivo publica una convocatoria: fecha, flyer,
   género buscado, descripción.
2. A los DJs les aparece en su panel que hay convocatoria abierta.
3. El DJ se inscribe (botón tipo compra, pero es "inscríbete").
4. Quien publicó revisa los press kits de los inscritos.
5. Acepta o rechaza. Los aceptados quedan **reservados para el
   evento** — el lineup se arma desde ahí.

### 8.2 Qué mira quien decide
El press kit completo: toques, horas, distritos, likes, colectivos.

**Cuidado con los likes.** No pueden ser el único criterio visible,
o el DJ nuevo que toca bien pero tiene 12 likes desaparece. Mostrar
likes junto a toques, horas y distritos, nunca solo.

---

## 9. LIKES

Hoy `artist_likes` solo cubre DJs. Hay que extenderlo a colectivos y
venues.

El like alimenta dos cosas: notificar al usuario cuando ese DJ toca,
y el feed personalizado.

---

## 10. CHAT PRIVADO

Mensajería entre cuentas. Se dispara, entre otras cosas, cuando un
venue acepta a un DJ en una convocatoria: se abre un chat para
cuadrar los detalles.

Decisiones pendientes: ¿se puede escribir a cualquiera o solo tras
una aceptación? ¿se borra? ¿hay bloqueo?

---

## PLAN DE TANDAS

### Tanda 3 — Colectivos, venues y geografía
1. Eliminar mínimos y `status_membership`
2. Renombrar `kind` a `casa` / `residente` (migración de datos)
3. Sacar stats de convocatoria
4. Ciudad obligatoria + selector global (solo BOG activo)
5. Eliminar agrupamiento por sector
6. Crear colectivo desde cuenta de DJ
7. Press kit de colectivo `/colectivos/[slug]`
8. Membresía como conversación, en ambos sentidos
9. Sección `/venues` completa
10. Republicación de sets y tracks + invitar colaboradores
11. Extender likes a colectivos y venues

### Tanda 4 — Eventos y convocatorias
12. Relación real evento ↔ colectivo ↔ artistas
13. Métricas de colectivo y venue
14. Página de convocatorias completa
15. Aceptación que reserva al DJ para el evento

### Tanda 5 — Chat privado

### Tanda 6 — Feed personalizado por likes

---

## REGLAS QUE SIGUEN VIGENTES

- Toda ESCRITURA pasa por una ruta de API. Nunca desde un componente.
- Lógica en `lib/*-write.ts`, expuesta por la ruta.
- Nunca importar `lib/db.ts` en client components.
- Migraciones: dev primero, dos veces para probar idempotencia,
  después main, y recién ahí desplegar.
- Nada de `next build` en local.
- Datos de prueba seguros: `TEST-0001`, `+57 300 000 00XX`,
  `@test.hotu.local`. Nunca cédulas ni celulares reales.
- Nunca se borra una columna en la misma migración que deja de
  usarla.

---

## REVISIÓN VISUAL

Al terminar cada pieza de UI: levantar `npm run dev`, pedir la
página, y verificar que los elementos existan en el HTML, que las
secciones vacías no dejen huecos, que los carruseles tengan
contenido, que no haya errores de hidratación en el log, y que
funcione en ancho de celular. Si algo se ve mal, arreglarlo antes de
seguir.