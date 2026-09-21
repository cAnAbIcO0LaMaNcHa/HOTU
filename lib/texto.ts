/**
 * Saneo de texto que entra a la base, y recorte que no parte caracteres.
 *
 * ============================================================
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ============================================================
 *
 * Seis `.slice(n)` de los caminos de publicación devolvían un 500 crudo
 * con un emoji al final del campo. `.slice` corta UNIDADES UTF-16: un
 * emoji son dos, y cortar en el medio deja un sustituto suelto —media
 * letra— que el driver HTTP de Neon no puede serializar. El error que
 * llega es `could not parse the HTTP request body: unexpected end of hex
 * escape`, que no menciona ni el campo ni el emoji.
 *
 * El mismo camino tenía dos agujeros más de la misma familia, los tres
 * con la misma forma: texto que JavaScript acepta y Postgres no.
 *
 *   - Un NUL (\u0000) en cualquier campo: `invalid byte sequence for encoding
 *     "UTF8": 0x00`. Postgres no admite NUL dentro de un text, punto.
 *   - Un sustituto suelto mandado a mano, sin que nadie recorte nada.
 *
 * Ninguno es explotable para leer datos ajenos, pero los tres son un 500
 * que el usuario lee como "no se pudo guardar" sin más, y ninguno se
 * arregla reintentando.
 *
 * Node-only por costumbre del repo, aunque no toca la base: son
 * funciones puras y las puede usar cualquiera.
 */

/**
 * Controles que Postgres no acepta o que no significan nada en un
 * título. Se conservan tab, LF y CR, que sí aparecen en un texto largo
 * escrito a mano.
 */
const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Un sustituto ALTO sin su bajo detrás, o un BAJO sin su alto delante.
 * Es media letra: sola no representa nada y rompe la serialización.
 */
const SUSTITUTO_SUELTO =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Lo que llega del cliente, listo para guardar: sin controles, sin medio
 * carácter, y sin espacios de sobra en las puntas.
 *
 * Devuelve "" para cualquier cosa que no sea string, que es lo que hacía
 * el `texto()` que esto reemplaza.
 */
export function limpiarTexto(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(CONTROLES, "").replace(SUSTITUTO_SUELTO, "").trim();
}

/**
 * Recorta a `max` unidades SIN partir un carácter por la mitad.
 *
 * Si el corte cae justo entre los dos sustitutos de un emoji, se lleva
 * el emoji entero en vez de dejar la mitad. Un carácter menos es
 * invisible; medio carácter es un 500.
 *
 * No intenta respetar grafemas completos (una bandera, un emoji con
 * modificador de tono) a propósito: partir un grafema deja dos
 * caracteres válidos y legibles, no basura, y perseguir eso pediría
 * Intl.Segmenter para un tope que nadie mira de cerca. Lo que hay que
 * garantizar es que lo que sale sea UTF-8 válido.
 */
export function recortar(s: string, max: number): string {
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const ultimo = corte.charCodeAt(corte.length - 1);
  // ¿Quedó un sustituto alto colgado al final? Entonces su par quedó del
  // otro lado del corte.
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) return corte.slice(0, -1);
  return corte;
}

/** limpiarTexto + recortar, que es como se usa siempre. */
export function limpiarYRecortar(v: unknown, max: number): string {
  return recortar(limpiarTexto(v), max);
}

/* ===================================================================
 * FECHAS
 * =================================================================== */

/**
 * El rango de años que la base acepta y que además significa algo.
 *
 * `0000-01-01` pasaba el regex AAAA-MM-DD **y** pasaba el round-trip por
 * Date —`new Date("0000-01-01T00:00:00Z").toISOString()` devuelve
 * exactamente eso— y después Postgres tiraba `date/time field value out
 * of range`, porque no existe el año 0. Era el mismo agujero que el
 * 2026-02-31 que ese round-trip venía a cerrar, una capa más abajo.
 *
 * El piso también arregla la pantalla: formatShortDate muestra dos
 * dígitos de año, así que un evento en el 0001 salía como "01.01.01",
 * indistinguible de 2001.
 */
const ANIO_MIN = 2000;

export type ResultadoFecha = { date: string } | { error: string };

/**
 * Valida una fecha AAAA-MM-DD en tres pasos, y los tres hacen falta.
 *
 *   1. La forma, con el regex.
 *   2. Que exista, re-serializando la fecha parseada — es lo único que
 *      descarta un 31 de febrero.
 *   3. Que el año esté en rango, que es lo que el paso 2 no ve.
 *
 * `maxAnios` es cuántos años para adelante se admiten desde hoy. 0
 * significa "nada en el futuro".
 */
export function validarFecha(
  v: unknown,
  opciones: { maxAnios: number; siVacia?: "hoy" | "error" } = { maxAnios: 0 }
): ResultadoFecha {
  const date = limpiarTexto(v);
  if (!date) {
    return opciones.siVacia === "error"
      ? { error: "Falta la fecha" }
      : { date: new Date().toISOString().slice(0, 10) };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "La fecha tiene que ser AAAA-MM-DD" };
  }
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    return { error: `No existe la fecha ${date}` };
  }

  const anio = d.getUTCFullYear();
  if (anio < ANIO_MIN) {
    return { error: `La fecha no puede ser anterior al año ${ANIO_MIN}` };
  }
  const tope = new Date().getUTCFullYear() + opciones.maxAnios;
  if (anio > tope) {
    return {
      error:
        opciones.maxAnios === 0
          ? "La fecha no puede estar en el futuro"
          : `La fecha no puede ir más allá del año ${tope}`,
    };
  }
  return { date };
}
