HOTU — Contexto del proyecto

HOTU (Houses of the Underground): plataforma de eventos de música electrónica en Bogotá. Venta de boletas + perfiles de artistas y colectivos.

Stack
Next.js 15 (App Router), TypeScript
Neon Postgres — dos branches, ver abajo
Vercel — hotu-one.vercel.app
Repo: cAnAbIcO0LaMaNcHa/HOTU
Migraciones: rutas /api/setup-X?secret=$MIGRATE_SECRET

Branches de Neon
main — producción. Es la que lee Vercel.
dev — desarrollo. Es la que apunta el DATABASE_URL de .env.local en localhost.

Orden obligatorio de toda migración: primero en dev desde localhost, verificar, y recién después en main. Nunca al revés.
Toda migración tiene que ser idempotente: se corre dos veces seguidas y la segunda devuelve ok:true igual. Esa es la prueba de que se puede reaplicar en main sin romper nada.
SCHEMA ACTUAL (18 tablas — post migración /api/setup-profiles, tanda 1)

Importante: las PKs NO son todas integer.

Contenido editorial

artists — PK es slug TEXT, no id. Campos: name, genre, district, city, photo, bio, joined_at, sets jsonb, top_tracks jsonb.
  Tanda 1 agregó: owner_email → user_profiles(email), contact_email, dj_code, bpm_min, bpm_max, origin, cover_url, socials jsonb, rider jsonb, show_sales_to_organizers.
  city = dónde vive. origin = de dónde es. Son distintos, no unificar.
  owner_email = la cuenta que puede editar el perfil. contact_email = el mail público del EPK. Tampoco son lo mismo.
  dj_code tiene índice único sobre upper(dj_code) — artists_dj_code_upper_idx. Se teclea a mano en el checkout, así que camila y CAMILA son el mismo código.
collectives — PK es slug TEXT. Campos: name, type, sector, bio, artist_slugs jsonb, district.
  Tanda 1 agregó: owner_email → user_profiles(email), status_membership ('activo' | 'incompleto').
  status_membership NO es status. status = visibilidad editorial (draft/published/archived). status_membership = si cumple el mínimo de 3 DJs con 2+ residentes y por lo tanto puede crear eventos.
events — PK id SERIAL. event_date, city, venue, title, lineup, district, flyer_url, end_at.
dj_sets — PK slug TEXT. title, artist_name, artist_slug, district, duration, recorded_at, url.
tracks — PK slug TEXT. title, artist_name, artist_slug, district, released_at, url.
news — PK id SERIAL. tag, news_date, title, excerpt, district.

Las 6 tablas editoriales (artists, collectives, events, dj_sets, tracks, news) comparten: scope, country_code, language, status, featured, priority_at.

Cuentas y perfiles

user_profiles — PK es email TEXT. ES LA TABLA DE CUENTAS. phone, cedula (deprecada), consent_at.
  Tanda 1 agregó: birth_date, display_name, avatar_url, password_hash, auth_provider ('google' | 'credentials').
  Una sola cuenta con roles activables: las credenciales viven acá y en ningún otro lado. artists NO tiene password_hash.
  password_hash queda NULL en las cuentas creadas con Google.
  cedula está deprecada: no escribirla más. La columna se borra en una migración posterior.
user_roles — email, role, country_code, UNIQUE(email, role, country_code).

Comercio y boletería

orders — PK id. user_email, kind, status, payment_provider ('bold'), amount_cop, paid_at.
order_items — PK id. order_id→orders, event_id→events, item_type, ticket_tier, merch_slug, unit_price_cop, quantity.
tickets — PK id SERIAL. ticket_code UNIQUE, order_id, order_item_id, user_email, event_id, tier, status, checked_in_at, display_code.
  Tanda 1 declaró los FK que faltaban: order_id→orders, order_item_id→order_items, event_id→events, los tres ON DELETE RESTRICT. Una boleta es prueba de un pago, nada de lo que depende se borra por debajo.
merch_items — PK id SERIAL. slug UNIQUE, name, category, price_cop, image, active, collective_slug.

Tablas nuevas de la tanda 1 — las cuatro arrancan en 0 filas

artist_collectives — id SERIAL. artist_slug→artists, collective_slug→collectives, kind ('residente' | 'toca_con'), from_date, to_date, accepted_at, created_at.
  to_date IS NULL = vínculo activo. El histórico es inmutable: se cierra con to_date, no se borra.
  Índice único parcial: un solo 'residente' activo por artista.
  Índice único parcial: no se puede repetir el mismo vínculo activo (artist_slug, collective_slug, kind).
ticket_attributions — id SERIAL. ticket_id→tickets UNIQUE, seller_artist_slug→artists (NULL = venta de HOTU), seller_collective_slug→collectives, event_id→events, amount_cop, created_at.
  event_id y amount_cop están duplicados de tickets/order_items A PROPÓSITO: la fila es un snapshot congelado al momento de la venta.
  seller_collective_slug NUNCA se recalcula al consultar. Si un DJ cambia de colectivo, sus ventas viejas siguen contando para el colectivo viejo.
  CHECK: si no hay seller_artist_slug tampoco puede haber seller_collective_slug — HOTU no tiene colectivo.
  ticket_id es UNIQUE: una boleta se atribuye una sola vez, si no se duplica la plata.
artist_gigs — id SERIAL. artist_slug→artists, event_id→events (NULL en toques externos), external_name, flyer_url, venue, city, gig_date, district, role, b2b_with, duration_minutes, source ('hotu' | 'declarado'), created_at.
  CHECK: source 'hotu' exige event_id; source 'declarado' exige external_name.
  event_id va ON DELETE CASCADE, no SET NULL, justamente porque SET NULL violaría ese CHECK.
  Índice único parcial (artist_slug, event_id) para que el importador de lineups no duplique toques.
artist_likes — PK compuesta (artist_slug, user_email), created_at.
  La PK compuesta ya garantiza un like por usuario por artista.

Otras: countries, audit_log.

Convención de FK

a artista → artist_slug TEXT REFERENCES artists(slug) ON UPDATE CASCADE
a colectivo → collective_slug TEXT REFERENCES collectives(slug) ON UPDATE CASCADE
a evento → event_id INTEGER REFERENCES events(id)
a boleta → ticket_id INTEGER REFERENCES tickets(id)
a cuenta → email TEXT REFERENCES user_profiles(email) ON UPDATE CASCADE

ON UPDATE CASCADE es obligatorio contra slug: son PKs de texto, y renombrar un slug sin cascade rompe todas las referencias.
Postgres no tiene ADD CONSTRAINT IF NOT EXISTS. Los FK y CHECK que van por ALTER TABLE se envuelven en DO $$ ... EXCEPTION WHEN duplicate_object $$, si no la segunda corrida falla. Los que van inline dentro de CREATE TABLE IF NOT EXISTS ya son idempotentes solos.
Decisiones que se derivan del schema real

PENDIENTE (tanda 2) — NO crear artist_recordings ni artist_tracks. Ya existen dj_sets y tracks con artist_slug. Reusar esas. Lo que falta: FK real a artists(slug) y campos de orden manual, sello y portada.
PENDIENTE (tanda 2) — Los jsonb artists.sets, artists.top_tracks y collectives.artist_slugs duplican datos que ya viven en tablas propias. Migrar a relaciones y dejar de escribir en los jsonb. artist_collectives ya reemplaza a collectives.artist_slugs; falta el corte de escritura.
EN CURSO (tanda 1) — user_profiles.cedula se deprecia. birth_date DATE ya existe. No borrar la columna de una: primero dejar de escribirla, después limpiarla.
EN CURSO (tanda 1) — Ya hay next-auth con Google. Para las cuentas de prueba sin Google, agregar un Credentials provider (email + contraseña), no reemplazar el existente. Los dos conviven; user_profiles.auth_provider marca el origen de cada cuenta.
HECHO (tanda 1) — tickets no tenía FK declaradas a orders/events. Ya están las tres.

Nota: más abajo, en el perfil de DJ, las secciones DJ SETS y TRACKS mencionaban tablas artist_recordings y artist_tracks. Queda sin efecto: mandan dj_sets y tracks.
Ojo con user_profiles: ahora que es la tabla de cuentas, el login con Google tiene que hacer upsert de la fila en el primer ingreso. Si no, un usuario de Google se autentica pero revienta contra el FK de artist_likes al dar el primer like.
Reglas técnicas del repo
TODA ESCRITURA pasa por una ruta de API (/api/...). Nunca se escribe desde un componente. La app móvil va a usar esta misma base y necesita los mismos endpoints; un Server Action no le sirve, solo lo puede invocar el propio front de Next. Las LECTURAS desde server components están bien y siguen como están.
La lógica de escritura vive en lib/*-write.ts (ya existe ese patrón: db-write, roles-write, tickets-write) y la ruta de API es la que la expone por HTTP. La ruta hace auth y validación; el lib hace el trabajo. Así el mismo lib sirve al sitio y a la app.
Los Server Actions que ya existen se pueden dejar andando, pero no se escriben nuevos: lo nuevo va por /api.
Nunca importar lib/db.ts en client components. Las utilidades puras (fechas, formato) van en lib/date-utils.ts. Ya hubo un bug por esto.
Correr la migración ANTES de subir código que dependa de ella. El orden completo es: correrla en dev desde localhost, correrla una segunda vez para confirmar idempotencia, después en main, y recién ahí desplegar el código que la usa.
Todo el contenido es district-aware.
Sistema de distritos

Diez distritos, cada uno con persona, color y tema visual completo:

#	Género	Personaje	Color
00	house	ID	azul
01	minimal	MINIMAL	blanco
02	techhouse	PERSONA	naranja
03	guaracha	MUSE	verde
04	hardtrance	MANIAC	rosado
05	hardgroove	DISCREET	morado
06	hardtechno	INDISCREET	rojo
07	psytrance	NAIVE	amarillo
08	industrial	MAGNET	gris
09	hardcore	MASK	negro

Estética: hangar abandonado tomado por la naturaleza. El cable y la enredadera son el mismo elemento. En las vides SVG el color del tallo es constante; solo cambian forma y color de la flor por distrito. El distrito verde (03 MUSE) lleva hojas de hiedra, sin flor. — PENDIENTE DE CONFIRMAR: esta regla estaba atada al personaje HIEDRA, que era el 04 cuando era verde.

Filtros: push-to-top, nunca ocultar.

MODELO DE PERFILES
Tres roles sobre una cuenta

Una sola cuenta con roles activables. NO son tres sistemas separados.

Usuario — perfil PRIVADO. Compra boletas, aparta cupos, sigue DJs, da likes. No ve paneles de venta.
DJ — perfil PÚBLICO. EPK + stats visibles para cualquiera.
Colectivo / Organizador — perfil PÚBLICO. Cuenta aparte de la de artista.

Auth propia por email + contraseña. Sin Google.

Datos personales
Se guarda fecha de nacimiento, NO número de cédula. Es dato sensible bajo la Ley 1581 de 2012 y no hace falta: para verificar mayoría de edad basta la fecha.
La fecha de nacimiento es privada, solo visible en el panel de edición.
Datos de prueba: nunca inventar cédulas ni celulares reales. Usar TEST-0001, +57 300 000 00XX, @test.hotu.local.
Perfil de DJ (EPK)

Editable en sitio, estilo Instagram: si sos el dueño y estás logueado, editás donde ves. Sin /admin aparte.

Orden de secciones:

Cabecera — foto de portada, avatar, nombre, rol ("DJ & Productor"), contacto (mail, teléfono), fila de links sociales con ícono por plataforma (Spotify, Beatport, SoundCloud, Instagram, TikTok, YouTube, Shazam, Apple Music, web).
Sobre mí — origen, rango de BPM, géneros/distritos, biografía.
DJ SETS — grabaciones de sets. Barras horizontales con play + forma de onda. "MORE..." abajo a la izquierda. Tabla dj_sets.
TRACKS — producciones propias. Cuadrados en fila con portada, sello y fecha. "MORE →" al final de la fila. Tabla tracks. DJ SETS y TRACKS van SEPARADOS, no en tabs.
EVENTS — carrusel horizontal de flyers, cada uno linkea al evento. Resumen debajo: "20 EVENTOS, 10 EN 2026".
STATS — público. Promedio de asistentes, tabla de asistentes por fiesta, horas tocadas.
Galería — fotos en alta para que el organizador arme flyers.
Prensa — links a notas con medio y fecha.
Rider técnico — marca y cantidad de CDJs, mixer, monitores.

Regla de UI: el perfil crece con el artista. Las secciones vacías NO se muestran; en su lugar, al dueño se le sugiere qué completar. Un DJ con tres toques no puede ver ocho secciones vacías.

Qué es editable y qué no
Editable: nombre, contacto, bio, origen, BPM, links, recordings, tracks, fotos, prensa, rider, toques externos.
NO editable: todo lo que salga de atribuciones de venta. Los números son el valor del press kit; si el DJ los pudiera tocar, no le sirven a ningún organizador.
Toques (artist_gigs)
Si el evento está publicado en HOTU, el toque entra solo desde el lineup.
Si tocó afuera, el DJ lo agrega a mano y queda marcado como declarado.
Campos: evento (interno o externo + flyer), venue, ciudad, fecha, distrito, rol, b2b, duración, notas.
Atribución de ventas — LA REGLA CENTRAL

Al comprar hay un campo "quién te la vendió" con el código del DJ.

El DJ comparte un link con el código pre-llenado (WhatsApp).
El campo manual queda para venta en persona.
Sin código, la venta va a nombre de HOTU.
Venta en efectivo: el DJ compra con su cuenta y le pagan en mano. Para inflar tiene que poner plata real.
Cuenta lo pagado, no lo escaneado. Si compraron 20 y fueron 10, son 20.

Cada venta congela, en el momento de la venta:

el vendedor (DJ)
su colectivo de residencia EN ESA FECHA

Esto es crítico. NO calcular el colectivo al momento de consultar. Si Camila se pasa de Reisen a Sonar, sus ventas viejas deben seguir contando para Reisen. Si se calcula después, el histórico se le traslada a Sonar y se rompe todo.

El comprador nunca ve el colectivo del vendedor. La boleta muestra solo la fiesta. El colectivo es un campo interno.

Colectivos

Dos tipos de vínculo:

Residente de — UNO SOLO. Es el que cuenta plata.
Toca con — varios. Solo trayectoria en el EPK, sin atribución monetaria.

Mínimo para publicarse: 3 DJs, de los cuales 2+ residentes.

Estados:

Activo — cumple el mínimo. Puede crear eventos.
Incompleto — bajó del mínimo. El perfil sigue público y los eventos ya publicados corren hasta que pasen, pero NO puede crear eventos nuevos. Notificación al dueño y a los residentes.

Sin bloqueo ni cuenta regresiva. La única sanción es no poder publicar.

Otras reglas:

Al invitar, si el DJ acepta como residente hay que verificar que no tenga residencia activa en otro lado.
Un aliado puede ascender a residente si está libre.
Membresías con desde / hasta. El histórico es inmutable.
Likes

El usuario da like a un DJ. NO cambia ranking ni exposición. Sirve para dos cosas: notificarle al usuario cuando ese DJ toca, y que el DJ vea cuánta gente sigue su contenido.

Wraps de fin de año
DJ — toques, horas, distritos, venues nuevos, mes más movido, mejor fiesta.
Colectivo — ventas, desglose por residente, eventos propios vs. de terceros.
Usuario — versión chiquita: "fuiste a 8 eventos, farreaste 34 horas".

Guardar snapshot al cerrar el año para que el histórico quede congelado.

PLAN DE IMPLEMENTACIÓN
TANDA 1 — alcance exacto

Migración /api/setup-profiles:

user_profiles: agregar birth_date DATE, display_name, avatar_url
artists: agregar email, password_hash, owner_email, dj_code UNIQUE, bpm_min, bpm_max, origin, cover_url, socials jsonb, rider jsonb, show_sales_to_organizers BOOLEAN DEFAULT TRUE
collectives: agregar owner_email, status_membership ('activo' | 'incompleto')
NUEVA artist_collectives: artist_slug, collective_slug, kind ('residente' | 'toca_con'), from_date, to_date, accepted_at
NUEVA ticket_attributions: ticket_id, seller_artist_slug (nullable = HOTU), seller_collective_slug (CONGELADO al momento de la venta), event_id, amount_cop, created_at
NUEVA artist_gigs: artist_slug, event_id (nullable), external_name, flyer_url, venue, city, gig_date, district, role, b2b_with, duration_minutes, source ('hotu' | 'declarado')
NUEVA artist_likes: artist_slug, user_email, created_at

Después: Credentials provider en next-auth, perfiles editables, y seed de prueba (artista, colectivo OTU, usuario) con datos ficticios seguros. 2. EPK — recordings, tracks, eventos con flyer, resumen anual. 3. Atribución — códigos, link pre-llenado, campo manual, residencia congelada. 4. Stats y panel de colectivo — asistentes por fiesta, promedio, horas. 5. Wraps — DJ, colectivo, usuario.

Al terminar cada tanda, avisar qué sigue y esperar confirmación.

Referencia visual

mavelpoint.com — EPK puro, sin ticketing ni datos verificados. Sirve de referencia para la presentación (links sociales, BPM, rider, prensa, galería). La diferencia de HOTU: los números de convocatoria son reales porque la venta pasa por la plataforma.

Pendiente para otro chat

Sistema de creación de eventos y reparto de dinero: organizador → DJs → promotores del DJ. Con splits configurables por evento.