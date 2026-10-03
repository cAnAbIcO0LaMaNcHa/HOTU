/**
 * EL RIDER TÉCNICO DEL ARTISTA. Datos puros, sin imports.
 *
 * Vive fuera de lib/db.ts porque el editor es un client component y necesita la lista en
 * runtime, no solo como tipo. lib/db.ts llama neon(process.env.DATABASE_URL!) a nivel de
 * módulo, así que importar cualquier VALOR de ahí mete el cliente de la base en el bundle
 * del navegador — el bug exacto por el que existe la regla del repo. Mismo razonamiento
 * que lib/socials.ts y lib/date-utils.ts.
 *
 * ============================================================
 * HÍBRIDO: CAMPOS FIJOS PARA LO COMÚN, UNA LÍNEA LIBRE PARA EL RESTO
 * ============================================================
 *
 * La decisión fue (c) de tres opciones, y la razón es la distribución: casi todos los
 * riders de la escena son CDJs y mixer, y ESE casi-todo conviene que sea comparable, para
 * que un organizador pueda mirar su cabina y saber si alcanza. Lo raro —un sampler, un
 * controlador, una pedalera— necesita el campo libre para no quedar afuera.
 *
 * Una lista libre de líneas habría sido más flexible y no se podría comparar entre DJs.
 * Campos fijos a secas habrían dejado afuera lo que no entra en el molde, y el DJ lo
 * habría metido a la fuerza en el campo equivocado, que es peor que no tenerlo.
 *
 * ============================================================
 * SE GUARDA EN artists.rider jsonb, QUE YA EXISTÍA DESDE LA TANDA 1
 * ============================================================
 *
 * No hace falta migración: la columna está desde la tanda 1 y estaba en '{}' en los 17
 * artistas, sin un solo lector ni escritor. Así que esto no transforma nada, estrena una
 * columna vacía — y por eso no hay backfill ni compatibilidad hacia atrás que mantener.
 *
 * Y JSONB Y NO COLUMNAS: un rider es una ficha que se lee entera y nunca se filtra ni se
 * ordena por sus partes. Seis columnas nuevas en artists para algo que siempre se consulta
 * junto, y que encima tiene una parte libre, es el caso en el que jsonb es la respuesta y
 * no el atajo.
 */

/** Los equipos con campos fijos, en el orden en que se muestran y se editan. */
export const RIDER_EQUIPOS = ["cdj", "mixer", "monitores"] as const;
export type RiderEquipo = (typeof RIDER_EQUIPOS)[number];

export const RIDER_LABELS: Record<RiderEquipo, string> = {
  cdj: "CDJs",
  mixer: "MIXER",
  monitores: "MONITORES",
};

/** Qué poner de ejemplo en cada campo, para que no haya que adivinar el formato. */
export const RIDER_EJEMPLOS: Record<RiderEquipo, { marca: string; modelo: string }> = {
  cdj: { marca: "Pioneer", modelo: "CDJ-3000" },
  mixer: { marca: "Pioneer", modelo: "DJM-900NXS2" },
  monitores: { marca: "Pioneer", modelo: "XPRS12" },
};

/**
 * CANTIDAD SOLO DONDE SIGNIFICA ALGO. "2 CDJ-3000" es un requisito real; "1 DJM-900NXS2"
 * no dice nada que no se sepa, porque un mixer es uno. Los monitores sí: dos de monitoreo
 * en cabina no es lo mismo que uno.
 */
export const RIDER_LLEVA_CANTIDAD: Record<RiderEquipo, boolean> = {
  cdj: true,
  mixer: false,
  monitores: true,
};

export type RiderPieza = {
  marca?: string;
  modelo?: string;
  /** Solo en los equipos donde RIDER_LLEVA_CANTIDAD es true. */
  cantidad?: number;
};

export type ArtistRider = Partial<Record<RiderEquipo, RiderPieza>> & {
  /** La línea libre: lo que no entra en los campos fijos. */
  otros?: string;
};

export const RIDER_MAX_TEXTO = 80;
export const RIDER_MAX_OTROS = 400;
/**
 * Un tope de cantidad que no es arbitrario: 12 CDJs no es un rider, es un typo o una
 * broma. El tope existe para que un número absurdo no rompa el layout de la ficha, no
 * para validar la verdad de lo que el DJ pide — y ojo, igual que con el precio en
 * taquilla, un tope NO ataja un typo: pedir 2 y escribir 22 da un número posible.
 */
export const RIDER_MAX_CANTIDAD = 12;

/** True cuando el rider no tiene NADA que mostrar. */
export function riderVacio(r: ArtistRider | null | undefined): boolean {
  if (!r) return true;
  if (typeof r.otros === "string" && r.otros.trim() !== "") return false;
  return RIDER_EQUIPOS.every((e) => piezaVacia(r[e]));
}

export function piezaVacia(p: RiderPieza | null | undefined): boolean {
  if (!p) return true;
  const marca = (p.marca ?? "").trim();
  const modelo = (p.modelo ?? "").trim();
  return marca === "" && modelo === "" && !p.cantidad;
}

/** "2× Pioneer CDJ-3000", o "Pioneer DJM-900NXS2", o solo el modelo si no hay marca. */
export function piezaEnPalabras(equipo: RiderEquipo, p: RiderPieza): string {
  const partes = [p.marca, p.modelo].map((x) => (x ?? "").trim()).filter(Boolean);
  const cuerpo = partes.join(" ");
  if (!RIDER_LLEVA_CANTIDAD[equipo] || !p.cantidad) return cuerpo;
  /**
   * Con cantidad pero sin texto, se dice igual: "2×" sobre la etiqueta CDJs ya informa,
   * y perder el dato porque falta la marca sería esconder algo que el DJ sí escribió.
   */
  return cuerpo ? `${p.cantidad}× ${cuerpo}` : `${p.cantidad}×`;
}

/**
 * NORMALIZA LO QUE VENGA DE AFUERA Y DEVUELVE SOLO LO QUE RECONOCE.
 *
 * Es la MISMA función para el write path y para la lectura de la columna, a propósito: la
 * columna es jsonb, así que lo que hay guardado puede tener cualquier forma —incluida la
 * de una versión anterior de este archivo— y leerlo sin normalizar es cómo un campo de más
 * termina renderizado en la página. Derivar la forma en dos lugares es cómo los dos se
 * desincronizan.
 *
 * Devuelve `{}` y nunca null: un rider vacío es un rider, y el llamador pregunta con
 * riderVacio() en vez de comparar contra null.
 */
export function normalizarRider(valor: unknown): ArtistRider {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return {};
  const input = valor as Record<string, unknown>;
  const out: ArtistRider = {};

  for (const equipo of RIDER_EQUIPOS) {
    const crudo = input[equipo];
    if (crudo === null || typeof crudo !== "object" || Array.isArray(crudo)) continue;
    const p = crudo as Record<string, unknown>;
    const pieza: RiderPieza = {};

    const marca = texto(p.marca);
    const modelo = texto(p.modelo);
    if (marca) pieza.marca = marca;
    if (modelo) pieza.modelo = modelo;

    if (RIDER_LLEVA_CANTIDAD[equipo]) {
      const n = entero(p.cantidad);
      if (n !== null) pieza.cantidad = n;
    }

    if (!piezaVacia(pieza)) out[equipo] = pieza;
  }

  const otros = texto(input.otros, RIDER_MAX_OTROS);
  if (otros) out.otros = otros;

  return out;
}

function texto(v: unknown, max = RIDER_MAX_TEXTO): string | null {
  if (typeof v !== "string") return null;
  /**
   * Se recorta con los MISMOS blancos que el CHECK de la base —espacio, tab, CR, LF y
   * espacio duro— para que no haya un valor que el código considere vacío y la base
   * acepte, ni al revés. El \u00A0 va como ESCAPE y no como carácter literal: escrito
   * literal, cualquiera que "limpie espacios" en esta línea lo retipea como espacio
   * normal sin ver lo que no se ve, y el recorte se vuelve más laxo sin un error en
   * ningún lado.
   */
  const limpio = v.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");
  if (limpio === "") return null;
  return limpio.length > max ? limpio.slice(0, max) : limpio;
}

function entero(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > RIDER_MAX_CANTIDAD) return null;
  return n;
}
