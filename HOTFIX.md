# HOTU — HOTFIX 1

Tanda de arreglos y cambios estructurales. Va ANTES de terminar
la tanda 3.

Reemplaza decisiones de AGENTS.md y TANDA-3.md donde se contradigan.

---

## 0. BLOQUEANTE — arreglar primero

El sitio local está roto: `/`, `/colectivos` y `/api/auth/signin`
redirigen todos a `/login`, y esa página no existe (404).

- Revisar el matcher del middleware: las rutas públicas
  (`/`, `/noticias`, `/eventos`, `/artistas`, `/colectivos`, `/sets`,
  `/discografia`) NUNCA deben redirigir.
- `auth.config.ts` apunta a `pages.signIn: '/login'` sin que exista
  `app/login/page.tsx`. Crear esa página con el formulario de email y
  contraseña del Credentials provider.
- Verificar con curl que las públicas devuelven 200 sin sesión.

---

## 1. SE ELIMINA EL SISTEMA DE DISTRITOS

Los 10 distritos (00–09) desaparecen por completo como sistema de
clasificación. Se reemplazan por la taxonomía de géneros del punto 2.

Alcance:
- Filtros "DISTRITO 00 · T/RAP" etc. en todas las páginas
- El selector que hoy muestra "T/RAP" en `/colectivos` y `/sets`
- Columnas `district` en las tablas — **no borrar todavía**, dejar de
  leerlas y escribirlas primero
- `lib/districts.ts` y todo lo derivado

**Sobre el color:** el sistema de color por distrito y las vides SVG
quedan DESCARTADOS por ahora. La prioridad es que la aplicación
funcione, no la identidad visual. Dejá la paleta neutra que resulte;
no inventes un sistema de color nuevo. Se retoma más adelante.

---

## 2. TAXONOMÍA DE GÉNEROS

Fuente: `HOTU_DJ_Genre_Classification_2026.docx` (v1.0, sept 2026).
34 Main/Branch, cada uno con su set de tags. ~700 tags en total.

### 2.1 Estructura
- **MAIN / BRANCH** — el mundo musical principal. 34 opciones.
- **TAG** — el énfasis específico dentro o entre branches. Los tags
  pueden repetirse entre branches; eso es intencional.

Cada branch tiene un código de 3 letras: HOU, TEC, TCH, MEL, MIN, ACI,
GRO, BOU, IND, TRI, TRA, PSY, HDC, DNB, GAR, BAS, GUA, AFR, AMA, EDM,
ELC, DIS, TFB, REG, HIP, RNB, POP, AFB, CAR, BRF, LAT, ROC, FUN, CTY.

### 2.2 Tablas nuevas
- `genre_branches` — code, name, category, sort_order
- `genre_tags` — slug, name, branch_code, sort_order
- Vínculo de artista: branch primario (obligatorio), hasta 3
  secundarios, 3 a 8 tags
- Vínculo de colectivo: igual

Sembrar branches y tags desde el documento.

### 2.3 Obligatorio al crear cuenta
**Artistas y colectivos** deben elegir branch primario y al menos un
tag. Es campo obligatorio, no opcional.

**NO aplica a** cuentas de usuario normal ni a venues.

### 2.4 Reglas del documento que hay que respetar
- Un solo branch primario por perfil
- Hasta 3 secundarios
- De 3 a 8 tags; los 3 primeros son primarios
- "Open Format / Crossover" es DJ Type, NO un branch
- Era y contexto son cross-tags, separados del género
- No inferir branch padre desde un tag transversal (Acid, Melodic,
  Industrial)
- Aliases para búsqueda: DnB = Drum & Bass, UKG = Garage,
  Guaracha = Aleteo/Zapateo. Mostrar siempre la etiqueta canónica

### 2.5 Cross-tags (fuera de género, reusables)
- **DJ TYPE:** Specialist, Open Format/Crossover, Multi-Genre,
  Selector/Curator, Turntablist, Live/Hybrid DJ
- **ERA:** 70s a 2020s, Old School, Classic, Current, Throwbacks
- **CONTEXTO:** Club, Underground, Warehouse, Festival, Rooftop,
  Open Air, Afterhours, House Party, Wedding, Corporate, Radio
- **FORMATO:** Vinyl, Digital, CDJ, Controller, Live Remixing,
  Live PA Hybrid, Scratching, Open Format Mixing, Extended Sets, B2B
- **ENERGÍA:** Warm-Up, Peak-Time, Closing, Deep, Dark, Hypnotic,
  Groovy, Melodic, Hard, Fast, Emotional, Commercial, Experimental

Estos son de baja prioridad — modelarlos, pero la UI puede esperar.

---

## 3. LAYOUT ESTÁNDAR DE PÁGINA DE LISTADO

Aplica a: `/noticias`, `/eventos`, `/artistas`, `/colectivos`,
`/sets`, `/discografia`. Después también `/venues` y
`/convocatorias`.

Estructura, de arriba abajo, columna izquierda:

1. **TÍTULO** grande (NOTICIAS, EVENTOS, ARTISTAS...)
2. **Descripción** — subtítulo de una o dos líneas
3. **Barra de filtros**, en una sola fila:
   - Filtro 1: **Main / Branch** (género principal)
   - Filtro 2: **Tag** (subgénero)
   - **Buscador** con lupa, ocupando el resto del ancho
4. **Contenido**, agrupado por secciones ("Nuevo", después por branch)

Columna derecha: **franja de publicidad** de arriba abajo, a lo largo
de toda la página, sin importar cuán larga sea. Ancho fijo, contenido
placeholder por ahora.

El buscador tiene que ser **funcional** en todas esas páginas: busca
sobre el contenido de la sección donde está.

---

## 4. BARRA SUPERIOR

- El menú hamburguesa y el texto "HOUSE OF THE UNKNOWN" quedan a la
  izquierda. El texto un poco **más grande** que hoy.
- El **logo circular** se mueve: deja de estar al lado del texto y pasa
  al **centro exacto** de la barra.
- Los iconos de la derecha (tiquetes, carrito, idioma, tema, usuario)
  se quedan donde están.

---

## 5. QUITAR LA CÉDULA DEL PERFIL

En `/mi-perfil` todavía se muestra `CC: ••••6789`. La cédula se
eliminó del modelo por la Ley 1581 de 2012 — se reemplazó por
`birth_date`.

- Sacar el campo de la vista y del formulario de edición
- Dejar de escribir `user_profiles.cedula`
- **No borrar la columna todavía**

---

## 5.1 SECCIÓN "ARTISTAS QUE ME GUSTAN"

En `/mi-perfil`, **debajo de MIS TIQUETES**, una sección nueva:
**ARTISTAS QUE ME GUSTAN**.

- Lista los artistas a los que la cuenta les dio like
  (tabla `artist_likes`)
- Cada uno con su foto y nombre, y linkea a su perfil
- Si no hay ninguno, la sección no se muestra
- Mismo carrusel horizontal que se usa en el press kit del colectivo

Más adelante, cuando los likes se extiendan a colectivos y venues
(tanda 3), esta sección los incluye también.

---

## 5.2 EL PERFIL CAMBIA SEGÚN EL TIPO DE CUENTA

`/mi-perfil` no puede ser igual para todos:

- **Usuario normal** — pedidos, tiquetes, artistas que le gustan.
  Nada de género, nada de paneles.
- **DJ** — todo lo del usuario, más acceso a su EPK, a editarlo, a
  sus solicitudes de membresía, y al colectivo que administre.
- **Colectivo** — panel del colectivo: miembros, solicitudes
  pendientes, edición de la info.
- **Venue** — igual que colectivo, más dirección y capacidad.

Lo que no corresponde al tipo de cuenta **no se renderiza**, no se
oculta con CSS.

---

## 6. ARREGLOS MENORES DETECTADOS

- `/eventos` dice "No hay eventos todavía" aunque hay 4 eventos en la
  base. Revisar por qué el listado sale vacío.
- `/mi-perfil`, sección MIS TIQUETES: queda un hueco grande debajo de
  la tarjeta antes del footer. Ajustar el espaciado.
- Las tarjetas de `/colectivos` deben ser clickeables enteras y llevar
  al perfil del colectivo.

---

## PRIORIDAD

1. Punto 0 — el sitio no abre
2. Punto 5 — dato personal que no debería estar
3. Punto 2 — taxonomía (tablas + seed + campos obligatorios)
4. Punto 1 — sacar distritos
5. Punto 3 — layout estándar con filtros y buscador
6. Punto 4 — barra superior
7. Punto 6 — menores

---

## REGLAS QUE SIGUEN VIGENTES

- Toda ESCRITURA por ruta de API, nunca desde un componente
- Nunca importar `lib/db.ts` en client components
- Migraciones: dev primero, dos veces, después main
- Nada de `next build` en local
- Nunca borrar una columna en la misma migración que deja de usarla
- Al terminar cada pieza de UI: levantar el server, pedir la página,
  verificar que los elementos estén en el HTML, que no haya errores de
  hidratación, y que se vea bien en ancho de celular