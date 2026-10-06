/**
 * MIGRATION — censura por fila en la galería y en la prensa del EPK.
 *
 *   /api/setup-censura-galeria?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-censura-galeria?secret=YOUR_SECRET
 *
 *   artist_photos: censored_at, censor_reason, censored_by
 *   artist_press:  censored_at, censor_reason, censored_by
 *
 * ============================================================
 * ESTO CORRIGE UNA DECISIÓN DE setup-epk-galeria-prensa, Y HAY QUE DECIR CUÁL
 * ============================================================
 *
 * Esa migración creó las dos tablas SIN columnas editoriales. Su argumento, TEXTUAL:
 *
 *     "Las 6 tablas editoriales comparten scope, country_code, language, status, featured y
 *      priority_at porque se listan en el sitio Y SE MODERAN. Estas dos NO se listan en
 *      ningún lado: se ven solo dentro del perfil del artista."
 *
 * LA PRIMERA VERSIÓN DE ESTE ENCABEZADO CITABA ESE ARGUMENTO SIN EL "Y SE MODERAN", y lo
 * marcó la revisión. Importa, porque es la cláusula que lo volvía falso: el comentario
 * original no se olvidó de la moderación — la metió explícitamente en el mismo eje que el
 * listado, y es ahí donde se equivocó. Citarlo sin esa frase hacía parecer que el error fue
 * una omisión cuando fue un razonamiento.
 *
 * Y el razonamiento es el que está mal: scope y status son sobre DÓNDE se lista una fila; la
 * censura es sobre MODERACIÓN, y una foto puede ser abusiva por sí sola, sin que el perfil
 * que la contiene tenga nada de malo. Eran dos ejes y se trataron como uno.
 *
 * Lo que dejó el hueco, medido antes de escribir esto: `censurar` en lib/moderation-write.ts
 * trabaja sobre el mapa OBJETIVOS, y una tabla sin censored_at no puede estar ahí porque el
 * UPDATE reventaría al primer uso. Así que un MODERATOR no tenía NINGUNA forma de bajar una
 * foto —verificado: todas las escrituras de lib/epk-galeria-write.ts pasan por canEditArtist,
 * que es dueño OR SUPER_ADMIN— y las únicas dos salidas eran censurar el perfil entero
 * (desproporcionado: una foto esconde un EPK) o que un SUPER_ADMIN la borrara con
 * borrarFoto, que es IRREVERSIBLE y rompe el principio de toda la moderación del repo: el
 * ban se levanta, la censura se levanta, un traspaso se vuelve a traspasar.
 *
 * ============================================================
 * SE COPIA LA FORMA DE dj_sets: COLUMNAS, FK **Y CHECK**
 * ============================================================
 *
 * Las tres columnas quedan con la forma exacta que ya tienen en dj_sets —las tres nullable,
 * sin default— el FK de censored_by con su ON DELETE SET NULL, y el CHECK
 * censura_con_motivo que tienen las seis.
 *
 * LA PRIMERA VERSIÓN DECÍA "la forma exacta" Y NO INCLUÍA EL CHECK, así que la frase era
 * falsa. Es el reparo serio de la revisión y está explicado donde se declara el constraint.
 *
 * EL SET NULL DE censored_by NO ES CASCADE, y es el mismo criterio que offered_by y
 * reviewed_by: si la cuenta del moderador se borra, LA CENSURA SIGUIÓ PASANDO. Perder la
 * fila entera borraría el hecho junto con el autor.
 *
 * ============================================================
 * DOS COSAS QUE ESTA MIGRACIÓN **CREA COMO OBLIGACIÓN** PARA EL CÓDIGO
 * ============================================================
 *
 * 1. LA VISTA PREVIA DEL BORRADO DE CUENTA QUEDA CORTA. lib/accounts-delete.ts dice "son
 *    nueve columnas en siete tablas, todas ON DELETE SET NULL" y enumera las nueve
 *    subconsultas A MANO. Con estos dos FK son ONCE columnas en NUEVE tablas, y la
 *    enumeración no se actualiza sola: un moderador que censuró una foto y después se borra
 *    la cuenta saldría con 0 marcas de moderación en la previa. Hoy el conteo real es 0
 *    porque nada puede censurar una foto todavía, así que no bloquea — pero es deuda que
 *    nace acá.
 *
 * 2. LA MIGRACIÓN SOLA NO CIERRA EL HUECO QUE DESCRIBE, y conviene que no se lea mal.
 *    Después de correrla un MODERATOR sigue sin poder bajar una foto, porque artist_photos
 *    no está en OBJETIVOS; y si alguien escribiera censored_at a mano, la foto se seguiría
 *    viendo, porque getPhotosByArtist y getPressByArtist no filtran censored_at. Corrige el
 *    ESQUEMA, no el comportamiento. No deja ninguna página peor que antes, pero tampoco
 *    mejor hasta que llegue el código.
 *
 * ============================================================
 * SIN BACKFILL, Y NO HAY NADA QUE RELLENAR
 * ============================================================
 *
 * Las tres columnas nacen en NULL, que significa exactamente "no censurado". No hay un valor
 * previo que interpretar. Y por eso no aplica la regla del backfill cuya guarda es un valor
 * que la propia migración escribe: no se escribe ninguno.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLAS = ["artist_photos", "artist_press"] as const;

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["censored_at", /timestamp with time zone/i, true, null],
  ["censor_reason", /text/i, true, null],
  ["censored_by", /text/i, true, null],
];

/**
 * EL CHECK QUE FALTABA, Y ERA EL HALLAZGO SERIO DE LA REVISIÓN.
 *
 * Las SEIS tablas censurables tienen este constraint —medido: artists, collectives,
 * events, news, dj_sets, tracks— y la primera versión de esta migración no lo agregaba.
 * Peor: verificarForma no tenía campo `checks`, así que no podía ni extrañarlo, y habría
 * devuelto verificado:true dejando a estas dos como las únicas censurables sin la guarda
 * de base.
 *
 * NO ES UNA GUARDA REDUNDANTE CON validarMotivo, y lib/moderation-write.ts ya lo dice:
 * "Dos guardas para lo mismo: el CHECK no puede pedir 10 caracteres, y esto no puede
 * garantizar que nadie escriba por otro camino."
 *
 * Y EL OTRO CAMINO YA EXISTE. lib/accounts-delete.ts escribe censored_at, censored_by y
 * censor_reason con un UPDATE crudo, sin pasar por censurar() ni por validarMotivo. El día
 * que "ocultar los perfiles" alcance también a las fotos —que es el paso natural siguiente
 * de esta pieza— un motivo vacío entraría sin que nada lo frene, y el autor vería una foto
 * censurada sin explicación. Que es exactamente la falla que la censura con motivo existe
 * para evitar.
 *
 * Se agrega AHORA porque ahora es gratis: las tablas están casi vacías. Retrofitearlo
 * después es donde pega check_violation.
 */
const CHECKS: Array<[string, string]> = TABLAS.map((t) => [
  `${t}_censura_con_motivo_check`,
  `CHECK (((censored_at IS NULL) OR ((censor_reason IS NOT NULL) AND (btrim(censor_reason, '${BLANCOS}'::text) <> ''::text))))`,
]);

/** La definición EXACTA que rinde Postgres, copiada de dj_sets_censored_by_fkey. */
const fkCensuraDe = (tabla: string): [string, string] => [
  `${tabla}_censored_by_fkey`,
  "FOREIGN KEY (censored_by) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
];

/**
 * El FK que YA ESTABA, verificado por definición y no por conteo. La primera versión solo
 * contaba "tienen 2 FK", y un artist_slug_fkey que hubiera derivado de CASCADE a SET NULL
 * habría pasado con verificado:true: el conteo prueba cuántos hay, no cuáles.
 */
const fkArtistaDe = (tabla: string): [string, string] => [
  `${tabla}_artist_slug_fkey`,
  "FOREIGN KEY (artist_slug) REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE",
];

/**
 * Un índice parcial por tabla para la cola de moderación: lo que se consulta es "qué está
 * censurado", que son pocas filas sobre muchas. Parcial y no completo justamente por eso —
 * un índice sobre una columna casi siempre NULL no sirve si no excluye los NULL.
 *
 * SE LLAMA _censored_idx Y VA EN ASC, que es la convención EXACTA de los seis que ya
 * existen. La primera versión lo llamó _censurados_idx y lo puso en DESC, sin ninguna razón
 * escrita: dos convenciones para lo mismo obligan a quien compare huellas de esquema a
 * decidir cuál es la buena. El que ya estaba manda.
 */
const indiceDe = (tabla: string): [string, string] => [
  `${tabla}_censored_idx`,
  `CREATE INDEX ${tabla}_censored_idx ON public.${tabla} USING btree (censored_at) WHERE (censored_at IS NOT NULL)`,
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { existe: boolean; columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { formas: Record<string, Forma>; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  for (const tabla of TABLAS) {
    const f = e.formas[tabla];
    if (!f?.existe) {
      p.push(
        `falta la tabla ${tabla} — corré setup-epk-galeria-prensa primero, esta migración solo le agrega columnas`
      );
      continue;
    }

    for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
      const c = f.columnas.find((x) => x.nombre === nombre);
      if (!c) {
        p.push(`falta ${tabla}.${nombre}`);
        continue;
      }
      if (!patronTipo.test(c.tipo)) p.push(`${tabla}.${nombre} EXISTE PERO es ${c.tipo}`);
      if (c.aceptaNull !== aceptaNull) {
        p.push(
          `${tabla}.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`
        );
      }
      if ((c.default ?? null) !== def) {
        p.push(
          `${tabla}.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`
        );
      }
    }

    const exacto = (lista: string[], nombre: string, esperado: string, que: string) => {
      const linea = lista.find((x) => x.startsWith(`${nombre}: `));
      if (!linea) {
        p.push(`falta ${que} ${nombre} en ${tabla}`);
        return;
      }
      const real = linea.slice(nombre.length + 2);
      if (real !== esperado) {
        p.push(
          `${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
        );
      }
    };

    const chk = CHECKS.find(([n]) => n.startsWith(tabla));
    if (chk) exacto(f.checks, chk[0], chk[1], "el CHECK");
    const [fkNombre, fkDef] = fkCensuraDe(tabla);
    exacto(f.fks, fkNombre, fkDef, "el FK");
    /** El preexistente también por DEFINICIÓN, no solo contado. */
    const [fkArt, fkArtDef] = fkArtistaDe(tabla);
    exacto(f.fks, fkArt, fkArtDef, "el FK preexistente");
    const [idxNombre, idxDef] = indiceDe(tabla);
    exacto(f.indices, idxNombre, idxDef, "el índice");

    /**
     * Ahora cada tabla tiene DOS FK: el de artist_slug que ya estaba y el de censored_by.
     * Se cuenta para que un FK de más —uno que cambie qué se lleva el borrado de una
     * cuenta— falle ruidosamente en vez de pasar.
     */
    if (f.fks.length !== 2) {
      p.push(`${tabla} tiene ${f.fks.length} FK y se esperaban 2 (${f.fks.join("; ")})`);
    }
  }

  return { ok: p.length === 0, problemas: p };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const formaDe = async (tabla: string): Promise<Forma> => {
    const [existe] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tabla}`;
    if (!existe) return { existe: false, columnas: [], checks: [], fks: [], indices: [] };
    const columnas = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tabla} ORDER BY ordinal_position`;
    const cons = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = ${tabla}::regclass ORDER BY conname`;
    const indices = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${tabla} ORDER BY indexname`;
    return {
      existe: true,
      columnas: columnas.map((c) => ({
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      checks: cons.filter((c) => c.contype === "c").map((c) => `${c.conname}: ${c.def}`),
      fks: cons.filter((c) => c.contype === "f").map((c) => `${c.conname}: ${c.def}`),
      indices: indices.map((r) => `${r.indexname}: ${r.indexdef}`),
    };
  };

  const estado = async (): Promise<Estado> => {
    const formas: Record<string, Forma> = {};
    for (const t of TABLAS) formas[t] = await formaDe(t);
    const conteos: Record<string, number> = {};
    for (const t of TABLAS) {
      conteos[`filas_${t}`] = 0;
      conteos[`censuradas_${t}`] = 0;
      if (formas[t].existe) {
        const [r] = await sql(`SELECT COUNT(*)::int AS n FROM ${t}`);
        conteos[`filas_${t}`] = r.n as number;
        /** Solo se puede contar si la columna ya está; en la primera corrida no. */
        if (formas[t].columnas.some((c) => c.nombre === "censored_at")) {
          const [c] = await sql(`SELECT COUNT(*)::int AS n FROM ${t} WHERE censored_at IS NOT NULL`);
          conteos[`censuradas_${t}`] = c.n as number;
        }
      }
    }
    return { formas, conteos };
  };

  try {
    const antes = await estado();

    /**
     * SE NIEGA SI LAS TABLAS NO ESTÁN, en vez de crearlas. Esta migración agrega columnas a
     * algo que otra migración creó, y crear acá una versión aproximada de esas tablas
     * dejaría dos definiciones de la misma cosa en dos archivos.
     */
    const faltantes = TABLAS.filter((t) => !antes.formas[t].existe);
    if (faltantes.length > 0 && !dryRun) {
      return NextResponse.json(
        {
          ok: false,
          verificado: false,
          error:
            `Faltan las tablas: ${faltantes.join(", ")}. Corré setup-epk-galeria-prensa primero. ` +
            "Esta migración solo agrega columnas, no crea tablas.",
          log,
        },
        { status: 409 }
      );
    }

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: las dos tablas ya tienen la censura con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push("SIN BACKFILL: las tres columnas nacen en NULL, que es exactamente 'no censurado'.");
      log.push(
        "POR QUÉ: sin censored_at, artist_photos y artist_press no pueden entrar en OBJETIVOS, " +
          "así que un MODERATOR no tenía forma reversible de bajar una foto — solo censurar el " +
          "perfil entero, o que un SUPER_ADMIN la borre para siempre."
      );
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. Las filas no pueden cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /**
     * Los seis ADD COLUMN en UNA transacción. Entre uno y el siguiente hay una ventana real
     * —cada sql del driver HTTP de Neon es su propio request— y media migración aplicada es
     * un estado que nadie eligió. Van nullable y sin default, que es la forma de dj_sets, así
     * que no hay riesgo de que fallen sobre una tabla con filas.
     */
    await sql.transaction(
      TABLAS.flatMap((t) => [
        sql(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS censored_at TIMESTAMPTZ`),
        sql(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS censor_reason TEXT`),
        sql(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS censored_by TEXT`),
      ])
    );

    /* FK e índices por SWAP: DROP IF EXISTS + ADD desnudo, los dos en una transacción. Sin
     * la transacción hay una ventana de un round-trip sin guarda, y si el ADD falla por una
     * fila vieja tira su error ruidosamente dejando la guarda anterior en su lugar. */
    for (const [nombre, definicion] of CHECKS) {
      const tabla = nombre.startsWith("artist_photos") ? "artist_photos" : "artist_press";
      await sql.transaction([
        sql(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`),
        sql(`ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} ${definicion}`),
      ]);
    }
    for (const tabla of TABLAS) {
      const [fkNombre, fkDef] = fkCensuraDe(tabla);
      await sql.transaction([
        sql(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${fkNombre}`),
        sql(`ALTER TABLE ${tabla} ADD CONSTRAINT ${fkNombre} ${fkDef}`),
      ]);
      const [idxNombre, idxDef] = indiceDe(tabla);
      await sql.transaction([sql(`DROP INDEX IF EXISTS ${idxNombre}`), sql(idxDef)]);
    }

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? "VERIFICADO: las dos tablas con censored_at, censor_reason y censored_by, el CHECK " +
            "censura_con_motivo, el FK a user_profiles(email) ON DELETE SET NULL, y el índice " +
            "parcial _censored_idx. Los dos FK verificados por definición, no contados."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe ni borra una sola ` +
          "fila, así que en main lo más probable es tráfico legítimo entre las dos mediciones."
      );
    } else {
      log.push(`Sin cambios en los datos: ${JSON.stringify(despues.conteos)}.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && cambiaron.length === 0,
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
