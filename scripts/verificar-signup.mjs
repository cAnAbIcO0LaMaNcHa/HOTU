/**
 * CALCULA EL `verificado` QUE setup-artist-signup NO DEVUELVE.
 *
 *   curl -s "https://hotu-one.vercel.app/api/setup-artist-signup?secret=XXX" \
 *     | node scripts/verificar-signup.mjs
 *
 * ============================================================
 * POR QUÉ EXISTE ESTE SCRIPT Y NO UN PARCHE A LA MIGRACIÓN
 * ============================================================
 *
 * setup-artist-signup es anterior a la regla de "toda migración devuelve
 * verificado además de ok": solo lo devuelve en el camino de error. La
 * forma SÍ la reporta entera —tipo, nullabilidad y default de cada
 * columna, los CHECK y los índices con su definición—, así que el dato
 * está; lo que falta es el veredicto.
 *
 * Arreglarlo dentro de la ruta obligaría a un deploy ANTES de poder
 * correrla, y ahora mismo /admin está caído en producción por esa columna
 * que falta. Este script lee el JSON que la ruta ya devuelve y compara
 * contra la forma MEDIDA en dev, que es la referencia buena: dev tiene la
 * migración aplicada y /admin funciona ahí.
 *
 * Compara DEFINICIONES COMPLETAS, no subcadenas. Es la lección de
 * setup-moderation: buscando pedacitos, cinco de siete variantes falsas
 * pasaban.
 *
 * No toca la base y no necesita ninguna credencial: solo lee stdin.
 */

/** El conjunto de blancos del btrim, armado por código. */
const BLANCOS = " " + String.fromCharCode(9, 13, 10, 160);

/** nombre -> [tipo, aceptaNull, default esperado]. Medido en dev. */
const COLUMNAS = {
  review_status: ["text", false, "'borrador'::text"],
  review_note: ["text", true, null],
  submitted_at: ["timestamp with time zone", true, null],
  reviewed_at: ["timestamp with time zone", true, null],
  reviewed_by: ["text", true, null],
  district: ["text", false, "'D00'::text"],
  status: ["text", false, "'draft'::text"],
};

const CONSTRAINTS = {
  artists_review_status_check:
    "CHECK ((review_status = ANY (ARRAY['borrador'::text, 'en_revision'::text, 'rechazado'::text, 'aprobado'::text])))",
  artists_rechazo_con_motivo_check:
    "CHECK (((review_status <> 'rechazado'::text) OR ((review_note IS NOT NULL) AND (btrim(review_note, '" +
    BLANCOS +
    "'::text) <> ''::text))))",
  artists_reviewed_by_fkey:
    "FOREIGN KEY (reviewed_by) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
};

const INDICES = {
  artists_en_revision_idx:
    "CREATE INDEX artists_en_revision_idx ON public.artists USING btree (review_status) WHERE (review_status = 'en_revision'::text)",
};

let crudo = "";
for await (const trozo of process.stdin) crudo += trozo;

let j;
try {
  j = JSON.parse(crudo);
} catch {
  console.error("No pude parsear la respuesta. Esto es lo que llegó:\n" + crudo.slice(0, 500));
  process.exit(2);
}

if (j.ok !== true) {
  console.error("La migración devolvió ok:false -> " + (j.error ?? JSON.stringify(j).slice(0, 300)));
  process.exit(2);
}

const problemas = [];
const estado = j.despues ?? j.antes ?? j.estado;
if (!estado) {
  console.error("La respuesta no trae ni 'despues' ni 'antes'. ¿Es de esta migración?");
  process.exit(2);
}

/* ---------- columnas ---------- */
for (const [nombre, [tipo, aceptaNull, def]] of Object.entries(COLUMNAS)) {
  const c = (estado.columnas ?? []).find((x) => x.nombre === nombre);
  if (!c) {
    problemas.push(`falta artists.${nombre}`);
    continue;
  }
  if (c.tipo !== tipo) problemas.push(`artists.${nombre} es ${c.tipo} y se esperaba ${tipo}`);
  if (c.aceptaNull !== aceptaNull) {
    problemas.push(
      `artists.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`
    );
  }
  if ((c.default ?? null) !== def) {
    problemas.push(
      `artists.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`
    );
  }
}

/* ---------- constraints e índices, por DEFINICIÓN COMPLETA ---------- */
const exacto = (lista, nombre, esperado, que) => {
  const linea = (lista ?? []).find((x) => x.startsWith(nombre + ": "));
  if (!linea) {
    problemas.push(`falta ${que} ${nombre}`);
    return;
  }
  const real = linea.slice(nombre.length + 2);
  if (real !== esperado) {
    problemas.push(
      `${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
    );
  }
};
for (const [n, d] of Object.entries(CONSTRAINTS)) exacto(estado.checks, n, d, "el constraint");
for (const [n, d] of Object.entries(INDICES)) exacto(estado.indices, n, d, "el índice");

/* ---------- y que no se haya movido ninguna fila ---------- */
const antes = j.antes?.filas;
const desp = j.despues?.filas;
if (antes && desp && antes.total !== desp.total) {
  problemas.push(`el total de artistas cambió de ${antes.total} a ${desp.total}`);
}

/**
 * NADIE TIENE QUE QUEDAR EN LA COLA. El backfill manda los publicados a
 * 'aprobado' y el resto a 'borrador': si alguien apareciera en
 * 'en_revision' por esta corrida, le habría inventado trabajo a un
 * moderador sobre un perfil que nadie mandó a revisar.
 */
if (desp && antes) {
  const a = antes.porRevision?.en_revision ?? 0;
  const d = desp.porRevision?.en_revision ?? 0;
  if (d > a) problemas.push(`la cola de revisión creció de ${a} a ${d}`);
}

/* ---------- el veredicto ---------- */
console.log(j.dryRun ? "=== SIMULACIÓN ===" : "=== CORRIDA REAL ===");
for (const l of j.log ?? []) console.log("  " + l);
console.log();
if (desp?.porRevision) console.log("por review_status:", JSON.stringify(desp.porRevision));
if (desp?.porStatus) console.log("por status:        ", JSON.stringify(desp.porStatus));
console.log();

if (problemas.length === 0) {
  console.log("verificado: TRUE — la forma quedó exactamente como en dev.");
  process.exit(0);
}
console.log(`verificado: FALSE — ${problemas.length} problema(s):`);
for (const p of problemas) console.log("  - " + p);
process.exit(1);
