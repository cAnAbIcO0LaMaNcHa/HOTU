/**
 * MIGRATION — noticias de la comunidad, con autor y aprobación.
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-community-news?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-community-news?secret=YOUR_SECRET
 *
 * Las noticias dejan de ser solo de HOTU: las publican los colectivos y
 * los venues, y pasan por aprobación antes de salir. Esta migración
 * agrega lo que falta para eso.
 *
 * PURAMENTE ADITIVA salvo un backfill acotado. Cinco columnas nuevas, dos
 * CHECK y un índice. Ninguna fila se borra.
 *
 * ============================================================
 * status Y review_status SON DOS EJES, NO UNO
 * ============================================================
 *
 * Es la misma separación que ya tienen los artistas, y existe por la
 * misma razón: si moderar fuera poner status='draft', el autor lo vería
 * como un borrador suyo y lo volvería a publicar sin enterarse de que lo
 * moderaron. Son dos hechos distintos —dónde está en su ciclo de
 * publicación, y qué dijo un moderador— y tienen que poder existir a la
 * vez.
 *
 * Los LECTORES siguen filtrando por status y nada más. review_status es
 * la pista de moderación: la mira el admin, no la portada.
 *
 * ============================================================
 * EL DEFAULT DE news.status PASA A 'draft'. LOS DEFAULTS FALLAN CERRADOS.
 * ============================================================
 *
 * Con DEFAULT 'published' más el DEFAULT 'borrador' de review_status, una
 * noticia creada sin nombrar status nacía PÚBLICA Y SIN REVISAR: el par
 * imposible que setup-artist-signup ya nombró y arregló en artists. La
 * cola de aprobación quedaba decorativa, sostenida únicamente por que el
 * código nuevo se acordara de escribir status='draft'. Una regla que vive
 * en el código y no en el schema es una regla que alguien se olvida.
 *
 * La primera versión de esta migración NO lo cambiaba, con el argumento
 * de que rompería los INSERT del admin "que no nombran status". ESO ERA
 * FALSO: createNews (entonces en lib/db-write.ts, borrado después con
 * el resto del CMS en la tanda 5 §4) nombraba status explícitamente y su
 * valor sale de readMeta, que ya defaultea a 'published' en JavaScript.
 * El único INSERT del repo que lo omite es el seeder del prototipo en
 * /api/migrate, que además tiene guarda de existencia previa — y se le
 * agrega 'published' explícito en el mismo commit, igual que se hizo con
 * artistas.
 *
 * ============================================================
 * EL BACKFILL USA NULL COMO GUARDA, NO UN VALOR PROPIO
 * ============================================================
 *
 * review_status entra SIN DEFAULT a propósito. El NULL es lo que le
 * permite al backfill distinguir "esta fila es nueva para la columna" de
 * cualquier valor que la migración misma haya escrito. Es una guarda de
 * una sola vía: se consume una vez y no se recrea.
 *
 * Con DEFAULT desde el ADD COLUMN —como estaba— la guarda del backfill
 * era 'borrador', que es justo lo que el paso anterior acababa de
 * escribir. ESA ES LA FORMA EXACTA DEL BUG DEL RENOMBRE DE kind: la
 * segunda corrida no es un no-op, es una re-aplicación. Concretamente,
 * una noticia que un moderador bajara a 'borrador' para volver a mirarla
 * quedaba APROBADA sola al re-correr la migración. No rompe: corrompe, y
 * lo que corrompe es una decisión de moderación.
 *
 * Todo el bloque va en sql.transaction, y no por prolijidad: entre el
 * ADD COLUMN sin default y el SET NOT NULL hay una ventana real —cada
 * sql del driver HTTP es su propio request— en la que un INSERT
 * concurrente escribe NULL y el SET NOT NULL revienta con la migración a
 * medio aplicar.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** nombre, aceptaNull esperado, patrón del default, patrón del TIPO. */
const COLUMNAS: Array<[string, boolean, RegExp | null, RegExp]> = [
  ["author_collective_slug", true, null, /text/i],
  // Anclado: sin anclar, un default 'borrador_viejo' o 'no_borrador'
  // contiene la subcadena y pasaría la verificación.
  ["review_status", false, /^'borrador'::text$/, /text/i],
  ["review_note", true, null, /text/i],
  ["reviewed_at", true, null, /timestamp/i],
  ["reviewed_by", true, null, /text/i],
  ["submitted_at", true, null, /timestamp/i],
];

const CHECKS: Array<{ nombre: string; debe: RegExp[] }> = [
  {
    nombre: "news_review_status_check",
    debe: [/borrador/, /en_revision/, /rechazado/, /aprobado/],
  },
  /**
   * El rechazo SIN motivo no existe: misma regla que los perfiles, y en
   * el schema y no solo en el código porque un contenido que desaparece
   * sin razón hace que la gente abandone la plataforma.
   *
   * Los patrones miran el ORDEN, no solo que las subcadenas estén: un
   * CHECK invertido —"review_note IS NOT NULL OR review_status =
   * 'rechazado'", que permite justo lo que debería prohibir— contiene las
   * mismas palabras y pasaría un chequeo por subcadena suelta.
   *
   * Y exigen el btrim CON conjunto explícito de caracteres. Con un solo
   * argumento recorta solo el espacio ASCII, así que un review_note que
   * quedó en un salto de línea —un textarea por el que se pasó
   * tabulando— o en un espacio duro pegado de un documento pasarían el
   * CHECK, y el colectivo vería una pantalla de rechazo con el motivo en
   * blanco.
   */
  {
    nombre: "news_rechazo_con_motivo_check",
    debe: [
      /review_status <> 'rechazado'/,
      /review_note IS NOT NULL/,
      /btrim\(review_note, '/,
    ],
  },
];

type Estado = {
  columnas: Array<{ nombre: string; tipo: string; aceptaNull: boolean; default: string | null }>;
  checks: string[];
  fks: string[];
  indices: string[];
  conteos: Record<string, number>;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const problemas: string[] = [];

  for (const [nombre, aceptaNull, patronDefault, patronTipo] of COLUMNAS) {
    const c = e.columnas.find((x) => x.nombre === nombre);
    if (!c) {
      problemas.push(`falta news.${nombre}`);
      continue;
    }
    if (c.aceptaNull !== aceptaNull) {
      problemas.push(
        `news.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"}, se esperaba lo contrario`
      );
    }
    // El TIPO también. ADD COLUMN IF NOT EXISTS compara por nombre, así
    // que una reviewed_at preexistente como TEXT se saltea en silencio —
    // y era lo único que ese salteo podía dejar mal sin que se note.
    if (!patronTipo.test(c.tipo)) {
      problemas.push(`news.${nombre} EXISTE PERO es ${c.tipo}, no el tipo esperado`);
    }
    if (patronDefault && !(c.default && patronDefault.test(c.default))) {
      problemas.push(
        `news.${nombre} EXISTE PERO su default es ${c.default ?? "ninguno"} y no coincide con lo esperado`
      );
    }
  }

  // status tiene que fallar CERRADO. Es el par imposible que artists ya
  // corrigió: público y sin revisar a la vez.
  const st = e.columnas.find((x) => x.nombre === "status");
  if (st && !(st.default && /^'draft'::text$/.test(st.default))) {
    problemas.push(
      `news.status tiene default ${st.default ?? "ninguno"} y se esperaba 'draft': con 'published' una noticia sin nombrar status nace pública y sin revisar`
    );
  }

  for (const ch of CHECKS) {
    const linea = e.checks.find((x) => x.includes(`${ch.nombre}:`));
    if (!linea) problemas.push(`falta el CHECK ${ch.nombre}`);
    else {
      const faltan = ch.debe.filter((r) => !r.test(linea));
      if (faltan.length > 0) {
        problemas.push(`el CHECK ${ch.nombre} EXISTE PERO tiene otra forma: ${linea}`);
      }
    }
  }

  const fk = e.fks.find((f) => /author_collective_slug/.test(f));
  if (!fk) problemas.push("falta el FK de news.author_collective_slug");
  else if (
    !/REFERENCES collectives\(slug\)/i.test(fk) ||
    !/ON UPDATE CASCADE/i.test(fk) ||
    !/ON DELETE RESTRICT/i.test(fk)
  ) {
    problemas.push(`el FK del autor EXISTE PERO no es el esperado: ${fk}`);
  }

  // reviewed_by con FK real, como en artists: un email mal escrito se
  // detecta, y renombrar una cuenta cascadea en vez de dejar una
  // referencia colgada.
  const fkRev = e.fks.find((f) => /reviewed_by/.test(f));
  if (!fkRev) problemas.push("falta el FK de news.reviewed_by");
  else if (
    !/REFERENCES user_profiles\(email\)/i.test(fkRev) ||
    !/ON DELETE SET NULL/i.test(fkRev)
  ) {
    problemas.push(`el FK de reviewed_by EXISTE PERO no es el esperado: ${fkRev}`);
  }

  // Por DEFINICIÓN y no por nombre: un índice preexistente que se llame
  // igual sobre otra columna pasaba la verificación, que es literalmente
  // el modo de falla contra el que la regla del repo está escrita.
  const idx = e.indices.find((x) => x.includes("news_review_status_idx:"));
  if (!idx) problemas.push("falta el índice news_review_status_idx");
  else if (!/\(review_status\)/.test(idx) || !/WHERE.*aprobado/i.test(idx)) {
    problemas.push(`el índice news_review_status_idx EXISTE PERO tiene otra forma: ${idx}`);
  }

  return { ok: problemas.length === 0, problemas };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const estado = async (): Promise<Estado> => {
    const columnas = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'news'
        AND column_name IN ('author_collective_slug','review_status','review_note',
                            'reviewed_at','reviewed_by','submitted_at','status')
      ORDER BY column_name
    `;
    const cons = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = 'news'::regclass
      ORDER BY conname
    `;
    const indices = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'news' ORDER BY indexname
    `;
    const [total] = await sql`SELECT COUNT(*)::int AS n FROM news`;
    const [pub] = await sql`SELECT COUNT(*)::int AS n FROM news WHERE status = 'published'`;
    const tiene = columnas.some((c) => c.column_name === "review_status");
    let sinRevisar = 0;
    let backfilleables = 0;
    if (tiene) {
      const [r] = await sql`SELECT COUNT(*)::int AS n FROM news WHERE review_status = 'borrador'`;
      sinRevisar = r.n as number;
      // Las que el backfill REALMENTE tocaría, con su WHERE exacto. Antes
      // el dryRun informaba el total de publicadas, así que una segunda
      // simulación seguía diciendo "3 pasarían a aprobado" cuando la
      // respuesta ya era 0 — y contra main el dryRun es la única foto de
      // lo que va a pasar.
      const [b] = await sql`
        SELECT COUNT(*)::int AS n FROM news
        WHERE review_status IS NULL AND author_collective_slug IS NULL
          AND status = 'published'
      `;
      backfilleables = b.n as number;
    } else {
      // Sin la columna todavía, TODA fila publicada es candidata.
      backfilleables = pub.n as number;
    }
    return {
      columnas: columnas.map((c) => ({
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      checks: cons.filter((c) => c.contype === "c").map((c) => `${c.conname}: ${c.def}`),
      fks: cons.filter((c) => c.contype === "f").map((c) => `${c.conname}: ${c.def}`),
      indices: indices.map((r) => `${r.indexname}: ${r.indexdef}`),
      conteos: {
        news: total.n as number,
        publicadas: pub.n as number,
        enBorrador: sinRevisar,
        backfilleables,
      },
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está todo con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const p of v.problemas) log.push(`  - ${p}`);
      if (!v.ok) {
        log.push(
          "Los que dicen 'falta' los crea esta corrida. Los que dicen 'EXISTE PERO' NO: IF NOT EXISTS compara por nombre y se saltea en silencio."
        );
      }
      log.push(
        `SIMULACIÓN: ${antes.conteos.backfilleables} noticia(s) pasarían a review_status 'aprobado'. Ninguna se despublica: el backfill no toca status.`
      );
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        log,
        estado: antes,
      });
    }

    // --- columnas ---------------------------------------------------
    // --- columnas, backfill y constraints, TODO EN UNA TRANSACCIÓN ---
    //
    // review_status entra SIN default: el NULL es la guarda del backfill,
    // y es una guarda de una sola vía que se consume y no se recrea. Con
    // un default desde el ADD COLUMN, la guarda sería un valor que el
    // paso anterior acaba de escribir — la forma exacta del bug del
    // renombre de kind.
    //
    // Y va todo junto porque entre el ADD COLUMN sin default y el SET NOT
    // NULL hay una ventana real —cada sql del driver HTTP es su propio
    // request— en la que un INSERT concurrente escribe NULL y el SET NOT
    // NULL revienta con la migración a medio aplicar.
    const pasos = await sql.transaction([
      sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS author_collective_slug TEXT`,
      sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS review_status TEXT`,
      sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS review_note TEXT`,
      sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
      sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS reviewed_by TEXT`,
      sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`,

      // Lo publicado y sin autor es de HOTU y está aprobado de hecho:
      // está en el sitio. Dejarlo en 'borrador' diría que está sin
      // revisar, que es falso. RETURNING para poder decir cuántas.
      sql`
        UPDATE news SET review_status = 'aprobado'
        WHERE review_status IS NULL AND author_collective_slug IS NULL
          AND status = 'published'
        RETURNING id
      `,
      // El resto de las filas que son nuevas para la columna.
      sql`
        UPDATE news SET review_status = 'borrador'
        WHERE review_status IS NULL
        RETURNING id
      `,

      // Recién ahora el default y el NOT NULL: con la columna ya poblada,
      // el SET NOT NULL no puede fallar por una fila vieja.
      sql`ALTER TABLE news ALTER COLUMN review_status SET DEFAULT 'borrador'`,
      sql`ALTER TABLE news ALTER COLUMN review_status SET NOT NULL`,

      // EL DEFAULT DE status FALLA CERRADO. Una noticia creada sin
      // nombrar status ya no nace pública: nace borrador, y la aprobación
      // es lo que la publica. createNews nombra status explícitamente, así
      // que el camino del admin no cambia de comportamiento.
      sql`ALTER TABLE news ALTER COLUMN status SET DEFAULT 'draft'`,
    ]);

    const aprobadas = Array.isArray(pasos[6]) ? (pasos[6] as unknown[]).length : 0;
    const aBorrador = Array.isArray(pasos[7]) ? (pasos[7] as unknown[]).length : 0;
    log.push(
      `Backfill: ${aprobadas} noticia(s) pasaron a 'aprobado' y ${aBorrador} a 'borrador'. En la segunda corrida los dos dan 0, porque la guarda es review_status IS NULL y ese NULL ya no existe.`
    );

    // --- constraints ------------------------------------------------
    // Van por ALTER TABLE, así que necesitan el envoltorio: Postgres no
    // tiene ADD CONSTRAINT IF NOT EXISTS y la segunda corrida fallaría
    // con duplicate_object. Y van DESPUÉS del backfill: con la columna ya
    // poblada de valores legales, el ADD no puede tirar check_violation,
    // que no es duplicate_object y el envoltorio no atraparía.
    await sql`
      DO $$ BEGIN
        ALTER TABLE news ADD CONSTRAINT news_review_status_check
          CHECK (review_status IN ('borrador','en_revision','rechazado','aprobado'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;
    // El btrim con el MISMO conjunto de caracteres que artists. Con un
    // solo argumento recorta solo el espacio ASCII, y un motivo que quedó
    // en un salto de línea —un textarea por el que se pasó tabulando— o
    // en un espacio duro pegado de un documento pasaría el CHECK: el
    // colectivo vería una pantalla de rechazo con el motivo en blanco.
    await sql`
      DO $$ BEGIN
        ALTER TABLE news ADD CONSTRAINT news_rechazo_con_motivo_check
          CHECK (review_status <> 'rechazado'
                 OR (review_note IS NOT NULL
                     AND btrim(review_note, E' \t\r\n\u00A0') <> ''));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;
    await sql`
      DO $$ BEGIN
        ALTER TABLE news ADD CONSTRAINT news_author_fk
          FOREIGN KEY (author_collective_slug) REFERENCES collectives(slug)
          ON UPDATE CASCADE ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;
    // reviewed_by con FK real, como en artists: un email mal escrito se
    // detecta, y renombrar una cuenta cascadea.
    await sql`
      DO $$ BEGIN
        ALTER TABLE news ADD CONSTRAINT news_reviewed_by_fkey
          FOREIGN KEY (reviewed_by) REFERENCES user_profiles(email)
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;

    // La cola de aprobación se lee por review_status: el índice parcial
    // es lo que evita un seq scan cada vez que el admin la abre.
    await sql`
      CREATE INDEX IF NOT EXISTS news_review_status_idx
      ON news (review_status) WHERE review_status <> 'aprobado'
    `;


    const despues = await estado();
    const v = verificarForma(despues);

    log.push(
      v.ok
        ? "VERIFICADO: las 5 columnas, los 2 CHECK, el FK RESTRICT del autor y el índice quedaron con la forma esperada."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const p of v.problemas) log.push(`  - ${p}`);
    log.push(
      `Noticias: ${despues.conteos.news} en total, ${despues.conteos.publicadas} publicadas, ${despues.conteos.enBorrador} en review_status 'borrador'. Ninguna se despublicó: el backfill solo tocó review_status.`
    );
    if (antes.conteos.publicadas !== despues.conteos.publicadas) {
      log.push("ATENCIÓN: cambió la cantidad de noticias publicadas. Esto no debería poder pasar.");
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok,
      problemas: v.problemas,
      antes,
      despues,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
