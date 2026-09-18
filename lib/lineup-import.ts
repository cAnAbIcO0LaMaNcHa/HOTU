/**
 * Del texto libre de `events.lineup` a la relación `event_lineup`
 * (TANDA-3 §7).
 *
 * Vive en lib y no adentro de la ruta de migración porque la pantalla de
 * admin necesita exactamente lo mismo: partir un lineup y proponer a qué
 * corresponde cada nombre. Si la lógica viviera en la migración, el
 * admin tendría que reimplementarla, y dos implementaciones de "cómo se
 * parte un lineup" se separan la primera vez que alguien toca una.
 *
 * Node-only. Nunca importar desde un client component.
 */

/**
 * Pliega acentos, mayúsculas y espacios de más.
 *
 * "Paramo Club" tiene que encontrar a "Páramo Club": los flyers se
 * escriben sin tildes todo el tiempo, y en un país donde el contenido
 * está lleno de acentos, no plegarlos sería la mitad de los no-matcheos.
 */
export function normalizarNombre(texto: string): string {
  return texto
    .normalize("NFD")
    // El rango escrito con escapes y no con los caracteres combinantes
    // literales: literales son invisibles en un editor y cualquier
    // herramienta que normalice el archivo los puede alterar sin que se
    // note. Es el bloque de marcas combinantes que NFD acaba de separar.
    .replace(new RegExp("[\u0300-\u036f]", "g"), "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parte el lineup en entradas.
 *
 * SOLO los separadores que de verdad aparecen en los datos: "·" y " - ".
 * No se agregan comas, barras ni "b2b" porque ninguno aparece hoy, y un
 * separador de más parte un nombre al medio e inventa un intérprete que
 * nunca existió. Agregar uno es una decisión que se toma mirando datos
 * nuevos, no por las dudas.
 *
 * El guion exige espacios alrededor a propósito, para no partir
 * "Lo-Fi" ni "Drum-n-Bass".
 *
 * Riesgo asumido y dicho: un nombre con " - " adentro queda partido. El
 * reporte muestra cada corte, así que se ve; y events.lineup queda
 * congelada, así que se arregla a mano sin haber perdido nada.
 */
export function partirLineup(lineup: string): string[] {
  return lineup
    .split(/\s*·\s*|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ResueltoComo = "artista" | "colectivo" | "sin-match" | "ambiguo" | "repetido";

export type DecisionLineup = {
  eventId: number;
  /** Posición en el lineup, o -1 si se descartó por repetida. */
  posicion: number;
  texto: string;
  resuelto: ResueltoComo;
  artistSlug: string | null;
  collectiveSlug: string | null;
  motivo: string;
};

/** Los nombres contra los que se resuelve, ya agrupados por nombre normalizado. */
export type Vocabulario = {
  artistas: Map<string, string[]>;
  colectivos: Map<string, string[]>;
};

export function armarVocabulario(
  artistas: Array<{ slug: string; name: string }>,
  colectivos: Array<{ slug: string; name: string }>
): Vocabulario {
  const a = new Map<string, string[]>();
  for (const x of artistas) {
    const k = normalizarNombre(x.name);
    a.set(k, [...(a.get(k) ?? []), x.slug]);
  }
  const c = new Map<string, string[]>();
  for (const x of colectivos) {
    const k = normalizarNombre(x.name);
    c.set(k, [...(c.get(k) ?? []), x.slug]);
  }
  return { artistas: a, colectivos: c };
}

/**
 * Decide qué es cada nombre de un lineup. NUNCA adivina.
 *
 * ============================================================
 * EXACTO O NADA. DOS CANDIDATOS ES NADA.
 * ============================================================
 *
 * El matcheo es por nombre normalizado y EXACTO. Sin Levenshtein, sin
 * prefijos, sin "el más parecido". Un match exacto no es una
 * adivinanza; cualquier otra cosa sí. Y un intérprete asignado al
 * artista equivocado es PEOR que uno sin asignar: el segundo se ve en
 * una consulta, el primero se ve cuando alguien reclama.
 *
 * Si un nombre matchea a dos, no se asigna. `artists.name` no es único,
 * y elegir entre homónimos no es una decisión que un import pueda tomar.
 *
 * El vocabulario de colectivos tiene que venir SIN VENUES. Los flyers
 * nombran el lugar y `events.venue` es texto libre, así que sin ese
 * filtro "Bodega 38" resolvería contra el venue y le contaría un toque
 * que nunca dio. Se filtra en la consulta que arma el vocabulario, no
 * acá, porque acá ya no se puede distinguir.
 *
 * Un flyer que nombra dos veces lo mismo —"xxx - xxx"— se queda con la
 * primera aparición. Sin eso la segunda chocaría contra el índice único
 * parcial de las entradas sin resolver y abortaría el import entero.
 */
export function decidirLineup(
  eventId: number,
  lineup: string,
  vocab: Vocabulario
): DecisionLineup[] {
  const salida: DecisionLineup[] = [];
  const vistos = new Set<string>();
  let posicion = 0;

  for (const texto of partirLineup(lineup)) {
    const k = normalizarNombre(texto);

    if (vistos.has(k)) {
      salida.push({
        eventId,
        posicion: -1,
        texto,
        resuelto: "repetido",
        artistSlug: null,
        collectiveSlug: null,
        motivo: "el flyer lo nombra dos veces; se guarda una sola",
      });
      continue;
    }
    vistos.add(k);

    const a = vocab.artistas.get(k) ?? [];
    const c = vocab.colectivos.get(k) ?? [];

    if (a.length + c.length === 0) {
      salida.push({
        eventId,
        posicion,
        texto,
        resuelto: "sin-match",
        artistSlug: null,
        collectiveSlug: null,
        motivo: "no corresponde a ningún artista ni colectivo; queda como texto para revisar",
      });
    } else if (a.length + c.length > 1) {
      salida.push({
        eventId,
        posicion,
        texto,
        resuelto: "ambiguo",
        artistSlug: null,
        collectiveSlug: null,
        motivo: `matchea a ${a.length + c.length} (${[...a, ...c].join(", ")}); elegir entre homónimos no es de este import`,
      });
    } else if (a.length === 1) {
      salida.push({
        eventId,
        posicion,
        texto,
        resuelto: "artista",
        artistSlug: a[0],
        collectiveSlug: null,
        motivo: "match exacto contra un artista",
      });
    } else {
      salida.push({
        eventId,
        posicion,
        texto,
        resuelto: "colectivo",
        artistSlug: null,
        collectiveSlug: c[0],
        motivo: "match exacto contra un colectivo",
      });
    }
    posicion += 1;
  }

  return salida;
}

export function resumirDecisiones(d: DecisionLineup[]) {
  return {
    artista: d.filter((x) => x.resuelto === "artista").length,
    colectivo: d.filter((x) => x.resuelto === "colectivo").length,
    sinMatch: d.filter((x) => x.resuelto === "sin-match").length,
    ambiguo: d.filter((x) => x.resuelto === "ambiguo").length,
    repetido: d.filter((x) => x.resuelto === "repetido").length,
  };
}
