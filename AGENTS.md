HOTU — Contexto del proyecto

AGENTS.md y CLAUDE.md son COPIAS IDÉNTICAS a propósito. Distintas herramientas autocargan uno u otro (Claude Code lee CLAUDE.md), y quedarse sin contexto es peor que duplicar. Toda edición va a los dos: editá AGENTS.md y después copialo encima de CLAUDE.md. Si alguna vez no coinciden, AGENTS.md manda.

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
SCHEMA ACTUAL (18 tablas — post tanda 2, corrida en dev y en main)

Migraciones aplicadas, en orden: /api/setup-profiles (tanda 1), /api/setup-epk-content (tanda 2 parte A), /api/setup-collective-memberships (tanda 2 parte B). Las tres son idempotentes y están corridas dos veces en las dos branches.

Importante: las PKs NO son todas integer.

Contenido editorial

artists — PK es slug TEXT, no id. Campos: name, genre, district, city, photo, bio, joined_at.
  sets jsonb y top_tracks jsonb siguen existiendo pero están DEPRECADOS: nadie los lee ni los escribe, y no están en el tipo Artist. Eran placeholders del prototipo (las 28 entradas tenían url "#", sin fecha, sin distrito, sin slug). NO se migraron a dj_sets/tracks a propósito: copiarlos con fechas inventadas habría metido basura en las tablas buenas. Los DJs reales cargan lo suyo.
  Tanda 1 agregó: owner_email → user_profiles(email), contact_email, dj_code, bpm_min, bpm_max, origin, cover_url, socials jsonb, rider jsonb, show_sales_to_organizers.
  city = dónde vive. origin = de dónde es. Son distintos, no unificar.
  owner_email = la cuenta que puede editar el perfil. contact_email = el mail público del EPK. Tampoco son lo mismo.
  dj_code tiene índice único sobre upper(dj_code) — artists_dj_code_upper_idx. Se teclea a mano en el checkout, así que camila y CAMILA son el mismo código.
collectives — PK es slug TEXT. Campos: name, type, sector, bio, district.
  Tanda 1 agregó: owner_email → user_profiles(email).
  status_membership está DEPRECADA desde tanda 3: el mínimo de 3 DJs con 2+ residentes se eliminó, no hay estado activo/incompleto y nadie lo recalcula. La columna sigue en la tabla, congelada, pero no se lee ni se escribe y no está en el tipo Collective. recalcMembership() fue BORRADA, no dejada sin uso: una regla que sigue en el código es una regla que alguien vuelve a llamar.
  sector ya NO agrupa nada (tanda 3). Es una etiqueta de origen dentro de la tarjeta. La ciudad de verdad llega con la pieza 4.
  artist_slugs jsonb sigue existiendo pero está DEPRECADO: no se lee ni se escribe, y no está en el tipo Collective. La fuente de verdad de las membresías es artist_collectives (ver abajo).
events — PK id SERIAL. event_date, city, venue, title, lineup, district, flyer_url, end_at.
dj_sets — PK slug TEXT. title, artist_name, artist_slug, district, duration, recorded_at, url.
  Tanda 2 agregó: cover_url, sort_order, y el FK artist_slug → artists(slug) ON UPDATE CASCADE ON DELETE SET NULL. Más el índice dj_sets_artist_slug_idx.
tracks — PK slug TEXT. title, artist_name, artist_slug, district, released_at, url.
  Tanda 2 agregó: cover_url, label (sello), sort_order, y el mismo FK que dj_sets. Más tracks_artist_slug_idx.

news — PK id SERIAL. tag, news_date, title, excerpt, district.

Las 6 tablas editoriales (artists, collectives, events, dj_sets, tracks, news) comparten: scope, country_code, language, status, featured, priority_at.

Sobre el FK de dj_sets/tracks: ON DELETE es SET NULL, no CASCADE. artist_slug es nullable y artist_name no, así que la fila sobrevive perdiendo el vínculo y sigue saliendo en /sets y /discografia bajo el nombre del artista. Borrar un artista no le borra la discografía al sitio: desvincular se revierte, borrar no.

Sobre sort_order: NULL = sin posición manual. Los lectores ordenan por sort_order ASC NULLS LAST y después por fecha DESC, así el que nunca reordena nada sigue viendo lo más nuevo primero.

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

Tablas creadas en la tanda 1

(artist_collectives ya tiene datos desde la migración de tanda 2. Las otras tres siguen en 0 filas en producción hasta que arranque tanda 3.)

artist_collectives — id SERIAL. artist_slug→artists, collective_slug→collectives, kind ('casa' | 'residente'), from_date, to_date, accepted_at, created_at.
  ES LA FUENTE DE VERDAD DE LAS MEMBRESÍAS desde tanda 2. Nadie lee collectives.artist_slugs.
  VOCABULARIO NUEVO desde tanda 3, pieza 2. Los valores viejos ya no existen:
    casa      — el colectivo principal del DJ, "mi casa". UNO SOLO.
    residente — el vínculo general. Varios a la vez.
  El renombre fue 'residente'→'casa' y 'toca_con'→'residente'. Ojo al leer código o docs viejos: la palabra "residente" cambió de significado, pasó de ser la exclusiva a ser la múltiple.
  to_date IS NULL = vínculo activo. El histórico es inmutable: se cierra con to_date, no se borra.
  CHECK artist_collectives_kind_casa_check: kind IN ('casa','residente').
  Índice único parcial artist_collectives_one_active_casa_idx: una sola 'casa' activa por artista.
  Índice único parcial artist_collectives_active_link_idx: no se repite el mismo vínculo activo (artist_slug, collective_slug, kind).
  Se lee con getCollectiveMembers() en lib/db.ts, que devuelve los vínculos activos agrupados por colectivo y con el nombre del artista ya resuelto. Se escribe SOLO por /api/collectives/[slug]/members (POST agrega, DELETE cierra), con la lógica en lib/collectives-write.ts.
  La 'casa' se valida en el write path, no solo con el índice: el índice no ve entity_kind, así que no puede saber que una casa solo vale en un colectivo y no en un venue.
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

HECHO (tanda 2) — NO crear artist_recordings ni artist_tracks. Se reusaron dj_sets y tracks, con FK real a artists(slug) y los campos de orden manual, sello y portada.
HECHO (tanda 2) — Los tres jsonb quedaron deprecados. collectives.artist_slugs se migró a artist_collectives; artists.sets y top_tracks NO se migraron (eran placeholders) y solo se dejó de escribirlos. Ninguna columna se borró: son la red por si hubiera que reintentar.
PENDIENTE — Borrar las tres columnas jsonb. Es otra migración, en otro momento, después de que esto lleve un tiempo andando sin sorpresas. Hasta entonces se quedan congeladas con lo que tenían.
EN CURSO (tanda 1) — user_profiles.cedula se deprecia. birth_date DATE ya existe. No borrar la columna de una: primero dejar de escribirla, después limpiarla.
EN CURSO (tanda 1) — Ya hay next-auth con Google. Para las cuentas de prueba sin Google, agregar un Credentials provider (email + contraseña), no reemplazar el existente. Los dos conviven; user_profiles.auth_provider marca el origen de cada cuenta.
HECHO (tanda 1) — tickets no tenía FK declaradas a orders/events. Ya están las tres.

ESTADO DE PRODUCCIÓN — LEER ANTES DE TOCAR COLECTIVOS

Las membresías de main entraron desde el jsonb como el vínculo múltiple, que tras el renombre de tanda 3 se llama 'residente'. NINGÚN colectivo de producción tiene una 'casa' asignada: el array plano de slugs nunca dijo quién era el principal, e inventarlo habría sido afirmar algo que el dato no decía.

Ya NO hay consecuencia de bloqueo: el mínimo de 3 DJs con 2+ residentes se eliminó en tanda 3, así que cualquier colectivo puede publicar eventos aunque no tenga casa ni miembros.

Lo que sí queda pendiente: asignar las 'casa' a mano donde corresponda. No frena nada, pero el press kit del colectivo muestra dos carruseles separados (ARTISTAS DE LA CASA y ARTISTAS RESIDENTES), y hasta que haya casas el primero va a estar vacío.

Nota: más abajo, en el perfil de DJ, las secciones DJ SETS y TRACKS mencionaban tablas artist_recordings y artist_tracks. Queda sin efecto: mandan dj_sets y tracks.
Ojo con user_profiles: ahora que es la tabla de cuentas, el login con Google tiene que hacer upsert de la fila en el primer ingreso. Si no, un usuario de Google se autentica pero revienta contra el FK de artist_likes al dar el primer like.
Reglas técnicas del repo
TODA ESCRITURA pasa por una ruta de API (/api/...). Nunca se escribe desde un componente. La app móvil va a usar esta misma base y necesita los mismos endpoints; un Server Action no le sirve, solo lo puede invocar el propio front de Next. Las LECTURAS desde server components están bien y siguen como están.
La lógica de escritura vive en lib/*-write.ts (ya existe ese patrón: db-write, roles-write, tickets-write) y la ruta de API es la que la expone por HTTP. La ruta hace auth y validación; el lib hace el trabajo. Así el mismo lib sirve al sitio y a la app.
Los Server Actions que ya existen se pueden dejar andando, pero no se escriben nuevos: lo nuevo va por /api.
Nunca importar lib/db.ts en client components. Las utilidades puras (fechas, formato) van en lib/date-utils.ts. Ya hubo un bug por esto.
Correr la migración ANTES de subir código que dependa de ella. El orden completo es: correrla en dev desde localhost, correrla una segunda vez para confirmar idempotencia, después en main, y recién ahí desplegar el código que la usa.

UN RENOMBRE NO ACTUALIZA, INSERTA. Todo upsert de vocabulario resuelve el conflicto por una clave derivada del contenido — el slug sale del nombre —, así que cambiar el nombre cambia el slug y la fila vieja NO se actualiza: entra una nueva al lado y quedan las dos. No hay error, no hay fila perdida, solo una de más que nadie eligió y que va a aparecer en los selectores. Es el mismo tipo de falla que la segunda corrida del renombre de kind: no rompe, corrompe. Por eso todo seed reporta el conteo de ANTES y DESPUÉS, y por eso hay que mirarlo: si un conteo SUBE cuando esperabas que quedara igual, hubo un renombre y quedó un huérfano. Limpiarlo es a mano, y el FK RESTRICT hacia los perfiles garantiza que se note si alguien ya lo eligió. Pasó de verdad con tres cross-tags en dev ("Radio" contra "Radio / Broadcast"), y se detectó solo porque el total dio 53 donde tenía que dar 50.

TODO SWAP DE CONSTRAINT VA EN UNA TRANSACCIÓN. Si una migración borra un constraint y lo vuelve a crear, las dos sentencias van juntas dentro de sql.transaction([...]), nunca como dos await sueltos. Cada sql`` del driver HTTP de Neon es su propio request y su propia transacción: entre un DROP CONSTRAINT y su ADD CONSTRAINT hay una ventana real de un round-trip en la que la tabla no tiene guarda, y si el ADD falla la ventana no se cierra nunca. Y falla más de lo que parece: una fila vieja con un valor que el CHECK nuevo no acepta tira check_violation, que NO es duplicate_object y por lo tanto el envoltorio DO $$ ... EXCEPTION WHEN duplicate_object $$ no lo atrapa. El resultado es una tabla sin CHECK, que es peor que no haber corrido nada. Dentro de la transacción el ADD va desnudo, sin ese envoltorio: después del DROP no queda nada con ese nombre que duplicar, así que el handler solo podría tragarse un error real. El patrón está en setup-membership-kinds (el swap del rename de kind) y en setup-venues (los dos CHECK de entity_kind y capacity).

Todo el contenido es district-aware.

EL DEV SERVER SE LEVANTA SIEMPRE CON `npm run dev`, Y CON NADA MÁS. No `next dev`, no `npx next dev`, no un nohup con un redirect a mano. Ese único camino es `scripts/dev-start.mjs`, y hace cuatro cosas que ninguna invocación a mano hace:

1. Chequea que no haya otro server ANTES de tocar nada.
2. Crea el log y ABORTA si no puede. No existe el camino en el que el server queda vivo y el log no.
3. Escribe SIEMPRE el mismo archivo, `dev.log`, truncado en cada arranque y con fecha y PID en la primera línea. Nada de dev3, dev4, dev5: la numeración fue justamente lo que dejó archivos viejos dando vueltas para que alguien leyera el equivocado.
4. Espera a que el server esté listo y CONFIRMA que el archivo tiene bytes. Si no, baja el server y sale con código distinto de cero.

LA VERIFICACIÓN DE UN DEPLOY VA CONTRA ALGO QUE EXISTA EN MAIN, NUNCA CONTRA UN FIXTURE DE DEV. Las bases no tienen los mismos datos: dev está lleno de filas de prueba —test-camila, otu, bodega-prueba— que en main no existen. Esperar un deploy pidiendo /colectivos/otu da 404 para siempre, y ese 404 se lee como "todavía no subió" cuando en realidad subió hace diez minutos.

Es el mismo modo de falla que el log congelado: la verificación miraba el lugar equivocado y devolvía algo con forma de respuesta. No falla ruidosamente, contesta mal.

Antes de usar una URL como señal de que un deploy está arriba, comprobá que su contenido exista en main —listando /colectivos o /artistas en producción, por ejemplo— o mejor, verificá contra algo que no dependa de los datos: que una ruta de API nueva devuelva 401 en vez de 404 prueba que el código está desplegado sin preguntarle nada a la base.

UN LOG QUE AFIRMA SIN VERIFICAR ES PEOR QUE NO LOGUEAR, Y LA VERIFICACIÓN DE FORMA CORRE EN LOS DOS CAMINOS, NO SOLO EN dryRun. Una migración que termina con `log.push("columna agregada (NOT NULL DEFAULT false)")` sin haber mirado si quedó así está mintiendo cada vez que el statement se salteó. Y se saltea seguido: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y ADD COLUMN IF NOT EXISTS comparan por NOMBRE. Si ya existe algo que se llama igual con otra forma, el statement no hace nada, no falla, y la migración devuelve ok:true.

Entonces toda migración termina verificando la FORMA de lo que creó —no su existencia— y devuelve un `verificado: true|false` además del `ok`. `ok` significa "no tiró excepción"; `verificado` significa "quedó como dice que quedó". Verificar la forma es: nullability y DEFAULT de cada columna comparados contra el valor esperado (no contra "tiene alguno"), la DEFINICIÓN de cada CHECK y no su nombre, y la DEFINICIÓN de cada índice y no su nombre.

Esa función corre en el dryRun Y en la corrida real, y es la misma. Tenerla solo en el dryRun es peor que no tenerla: deja el camino que efectivamente aplica el DDL sin verificar, que es justo el que importa. Y si el log dice una cosa y el JSON dice otra, gana el log, porque el log es lo que la gente lee.

El caso que originó la regla: una `is_fixed` preexistente NOT NULL DEFAULT **true** pasaba limpia un chequeo que solo preguntaba "¿es NOT NULL y tiene default?". Cada pieza nueva habría nacido fija e invisible, sin un error en ningún lado.

CONFIRMÁ QUE EL LOG CRECE ANTES DE LEERLO COMO EVIDENCIA. Un "cero errores de hidratación" leído de un archivo congelado es peor que no haber verificado: parece verificación y no lo es. El server que responde en el puerto no es necesariamente el que escribe el log que estás mirando. Antes de usar el log como prueba: anotá su tamaño, pedí una página, y volvé a medirlo. Si no creció, ese log no es del server que contestó.

POR QUÉ HAY UNA HERRAMIENTA Y NO SOLO ESTA ADVERTENCIA: pasó dos veces, con la misma forma y dos causas distintas. La primera, un log de un día antes que nadie notó que estaba congelado. La segunda, un comando en segundo plano que tenía que crear el archivo y murió con EXIT 127 — comando no encontrado —, nadie miró el código de salida, y el server terminó levantado por otra vía sin escribir a ningún lado. El archivo tenía 0 bytes y se leyó igual. Un exit 127 silencioso invalidó varias verificaciones. La advertencia sola no alcanzó: si el camino correcto es más incómodo que el atajo, se toma el atajo.

Y mirá el código de salida de todo comando en segundo plano. 127 no es "no pasó nada", es "el comando no existe".

LOS AGENTES DE .claude/agents/ SE INVOCAN PASANDO EL .md COMO ESPECIFICACIÓN. En este entorno no se registran por nombre: `tester` y `migration-reviewer` no aparecen como subagent_type disponible, aunque los archivos estén commiteados, con finales de línea LF y frontmatter válido. Está verificado y descartado como problema de formato; es del runtime. Lo que SÍ funciona: lanzar un agente general y decirle en el prompt que lea `.claude/agents/<nombre>.md` y siga esos criterios y ese formato al pie de la letra. No gastar tiempo peleando con el registro por nombre.

VENUE Y COLECTIVO COMPARTEN TABLA, Y EL UMBRAL PARA REVISARLO SON LOS CONDICIONALES. TANDA-3 §5.2 dice que si compartir tabla obliga a llenar el código de condicionales, hay que separar y avisar. Al cerrar la pieza C había 32 condicionales de entity_kind repartidos en 7 archivos: create-collective-button 7, collective-info-editor 6, db.ts 5, collectives-write 5, collective-join-button 4, collective-inbox 3, membership-inbox 2. Eso sigue del lado bueno — la alternativa era duplicar membresías, press kit y permisos enteros—, pero es el número contra el que hay que comparar. Las dos piezas que más lo pueden empujar son convocatorias (§7) y métricas de colectivo y venue (§13). Si al agregarlas un solo archivo pasa de ~10, o el total pasa de ~50, volver a mirar si conviene separar. Contar así: grep -rc "esVenue|entityKind === \"venue\"|kind === \"venue\"" sobre components/, lib/collectives-write.ts y lib/db.ts.

LA TRANSICIÓN NUNCA DEJA UNA PÁGINA PEOR QUE ANTES. Cuando algo se reemplaza por etapas —un filtro por otro, una columna por otra, un vocabulario por otro—, el estado intermedio tiene que ser al menos tan bueno como el de partida. No alcanza con que el destino sea mejor: entre medio hay gente usando el sitio.

El caso que la originó: el filtro de distritos pasó a ser el de géneros, y /colectivos quedó con CERO filtros, porque el filtro nuevo se apoya en datos que todavía nadie cargó y el viejo ya se había sacado. El destino es mejor y el camino era peor. La forma de resolverlo NO es apurar el destino: es que lo viejo quede de SUPLENTE de lo nuevo, y se retire solo cuando lo nuevo tenga con qué. Ahí el filtro 2 viejo se renderiza únicamente si no hay tags que ofrecer.

Es la misma familia que "primero dejar de escribir la columna, después borrarla" y que "nunca borrar una columna en la misma migración que deja de usarla". La diferencia es que aquellas protegen los datos y esta protege lo que el usuario puede hacer, que se rompe más callado: no hay error en ningún log cuando una página pierde un filtro.

Corolario para revisar: cuando termines una pieza de UI, no preguntes solo "¿anda lo nuevo?". Preguntá "¿qué se podía hacer ayer que hoy no se puede?".

UN SOLO dev server a la vez. Dos procesos next dev sobre el mismo .next se pisan los vendor-chunks y el server compila bien pero después tira "Cannot find module './vendor-chunks/next.js'" en cada request. El síntoma no dice nada sobre la causa y ya costó tiempo tres veces. Antes de levantar el server hay que comprobar que no haya otro: `npm run dev` ya lo hace solo y aborta con un mensaje claro si el puerto está tomado (`npm run dev:check` corre solo ese chequeo). Cuando pasa igual: matar TODOS los node de HOTU, borrar .next, y recién ahí arrancar uno. Ojo con matar el proceso padre y creer que alcanza — deja hijos vivos que siguen escribiendo el mismo .next.
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

Filtros: ACHICAN la lista. Hasta la tanda 4 el filtro 1 era el de distritos y hacía push-to-top —empujaba las coincidencias arriba y nunca escondía nada—, que con diez distritos era destacar sin excluir. Con 34 ramas y 719 tags eso deja de significar algo: elegir HOUSE y seguir viendo las otras 33 abajo no es un filtro, es un orden. Desde la tanda 4 §3 los tres controles esconden lo que no coincide.

Lo que sí quedó de ordenar: elegida una rama, primero salen los perfiles que la declararon PRIMARIA y después los que la tienen de secundaria. Pero eso es un orden ADENTRO de lo que ya se filtró, no en lugar de filtrar.

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
TRACKS — producciones propias. Cuadrados en fila con portada, sello y fecha. "MORE →" al final de la fila. Tabla tracks. DJ SETS y TRACKS van SEPARADOS, no en tabs. Portada y sello ya existen desde tanda 2 (cover_url, label); sin portada cae a un placeholder con el tinte del distrito.
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

Dos tipos de vínculo (vocabulario de tanda 3):

casa — el colectivo principal del DJ. UNO SOLO. Solo puede ser un colectivo, nunca un venue.
residente — el vínculo general. Varios a la vez, y vale tanto en colectivos como en venues.

NO hay mínimo para publicarse, ni estados activo/incompleto, ni bloqueo. Un colectivo con un solo miembro puede crear eventos. Eso se eliminó en tanda 3.

Otras reglas:

Al aceptar una 'casa' teniendo otra, el sistema ofrece mantener la actual y entrar acá como residente, o mover la casa. Nunca hay un estado intermedio con dos casas.
Membresías con desde / hasta. El histórico es inmutable: se cierra con to_date, no se borra.
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
collectives: agregar owner_email, status_membership (DEPRECADA en tanda 3)
NUEVA artist_collectives: artist_slug, collective_slug, kind (renombrado a 'casa' | 'residente' en tanda 3), from_date, to_date, accepted_at
NUEVA ticket_attributions: ticket_id, seller_artist_slug (nullable = HOTU), seller_collective_slug (CONGELADO al momento de la venta), event_id, amount_cop, created_at
NUEVA artist_gigs: artist_slug, event_id (nullable), external_name, flyer_url, venue, city, gig_date, district, role, b2b_with, duration_minutes, source ('hotu' | 'declarado')
NUEVA artist_likes: artist_slug, user_email, created_at

TANDA 1 — CERRADA. Migración, Credentials provider conviviendo con Google, upsert de user_profiles en el primer login, perfiles editables en sitio (cabecera y "Sobre mí"), subida de imágenes a Vercel Blob con redimensionado en el navegador, y seed de prueba.

TANDA 2 — CERRADA. Parte A: cover_url, label y sort_order en tracks/dj_sets, los FK a artists(slug), las secciones DJ SETS / TRACKS / EVENTS del EPK, y POST/PATCH/DELETE por fila. Parte B: membresías migradas a artist_collectives, jsonb deprecados, editor de miembros en el admin.

TANDA 3 — SIGUIENTE. Atribución: códigos de DJ, link pre-llenado por WhatsApp, campo manual en el checkout, y el colectivo de residencia congelado en el momento de la venta. Requisito previo: marcar residentes a mano en producción (ver ESTADO DE PRODUCCIÓN más arriba).

Después: 4. Stats y panel de colectivo — asistentes por fiesta, promedio, horas. 5. Wraps — DJ, colectivo, usuario.

Al terminar cada tanda, avisar qué sigue y esperar confirmación.

Referencia visual

mavelpoint.com — EPK puro, sin ticketing ni datos verificados. Sirve de referencia para la presentación (links sociales, BPM, rider, prensa, galería). La diferencia de HOTU: los números de convocatoria son reales porque la venta pasa por la plataforma.

Pendiente para otro chat

Sistema de creación de eventos y reparto de dinero: organizador → DJs → promotores del DJ. Con splits configurables por evento.