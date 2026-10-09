/**
 * MIGRATION — event_calls.visibilidad: quién ve el distintivo de convocatoria en /eventos.
 *
 *   /api/setup-convocatorias-visibilidad?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-convocatorias-visibilidad?secret=YOUR_SECRET
 *
 * ============================================================
 * POR QUÉ UNA RUTA NUEVA Y NO UNA COLUMNA MÁS EN setup-convocatorias
 * ============================================================
 *
 * setup-convocatorias YA SE CORRIÓ EN MAIN. Agregarle una columna haría que el archivo deje de
 * describir lo que de verdad se aplicó la primera vez, y el historial de una migración
 * aplicada es parte de lo que hace falta leer después.
 *
 * Es el precedente del repo, no una preferencia: el renombre de 'casa' a 'residente' fueron
 * TRES rutas —setup-miembros, setup-residentes, setup-cierre-residentes— y no tres versiones
 * de la misma.
 *
 * ============================================================
 * LA DECISIÓN QUE GUARDA ESTA COLUMNA
 * ============================================================
 *
 * El distintivo "CONVOCATORIA ABIERTA" en la lista pública de eventos cuenta algo que no es
 * solo información útil: también dice que un lineup no está cerrado a dos semanas de la
 * fiesta. Quién puede saberlo lo elige EL COLECTIVO al abrir la convocatoria.
 *
 *   'djs'     — DEFAULT. Solo lo ve quien tiene perfil de artista, o sea quien se podría
 *               postular. Es el default porque es el que no cuenta nada de más: si el dueño
 *               no eligió, no se eligió por él.
 *   'publica' — lo ve cualquiera.
 *
 * NO ES UN PERMISO SOBRE LA POSTULACIÓN: una convocatoria 'djs' sigue siendo postulable por
 * cualquier DJ, y el write path no mira esta columna. Lo único que cambia es a quién se le
 * MUESTRA. Confundir las dos cosas convertiría un detalle de presentación en una regla de
 * acceso, y entonces alguien con el link directo podría postularse a algo que la lista le
 * escondía — que es la forma de un agujero, no de una decisión.
 *
 * ============================================================
 * NO HAY BACKFILL, Y ESO SE DICE PORQUE HAY QUE BUSCARLO
 * ============================================================
 *
 * La regla del repo manda buscar explícitamente el patrón prohibido antes de correr cualquier
 * migración con backfill: una columna que entra CON default y después un UPDATE que filtra por
 * ese mismo default. Acá NO HAY NINGÚN UPDATE. El default es el valor correcto para toda fila
 * existente, así que no hay nada que decidir fila por fila y no hay guarda que elegir mal.
 *
 * Y MEDIDO: event_calls está en 0 filas en dev y en 0 en main, así que el ADD COLUMN NOT NULL
 * con default no tiene ni una fila que llenar. Un ADD COLUMN NOT NULL *sin* default sería lo
 * que falla sobre una tabla con filas; con default Postgres las llena.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "event_calls";

/** [nombre, patrón de tipo, aceptaNull, default exacto] */
type DefCol = [string, RegExp, boolean, string | null];

/** Cuántas columnas crea setup-convocatorias. Sale de la lista de abajo, no de un número. */
const PREEXISTENTES_N = 10;

const COLUMNA: DefCol = ["visibilidad", /text/i, false, "'djs'::text"];

/** La forma EXACTA que Postgres rinde, medida contra dev y no supuesta. */
const CHECK: [string, string] = [
  `${TABLA}_visibilidad_check`,
  "CHECK ((visibilidad = ANY (ARRAY['djs'::text, 'publica'::text])))",
];

type Forma = {
  existe: boolean;
  columnas: Array<{ nombre: string; tipo: string; aceptaNull: boolean; default: string | null }>;
  checks: string[];
};
type Estado = { forma: Forma; filas: number };

/**
 * Verifica la FORMA y no la existencia, y corre en los DOS caminos.
 *
 * ADD COLUMN IF NOT EXISTS compara por NOMBRE: si ya existiera una visibilidad con otro tipo o
 * sin el default, el statement no hace nada, no falla, y la migración devolvería ok:true. Por
 * eso se compara el default contra su valor exacto y no contra "tiene alguno".
 */
function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (!e.forma.existe) {
    p.push(`falta la tabla ${TABLA}: corré setup-convocatorias primero`);
    return { ok: false, problemas: p };
  }

  const [nombre, patronTipo, aceptaNull, def] = COLUMNA;
  const c = e.forma.columnas.find((x) => x.nombre === nombre);
  if (!c) {
    p.push(`falta ${TABLA}.${nombre}`);
  } else {
    if (!patronTipo.test(c.tipo)) p.push(`${TABLA}.${nombre} EXISTE PERO es ${c.tipo}`);
    if (c.aceptaNull !== aceptaNull) {
      p.push(
        `${TABLA}.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`
      );
    }
    if ((c.default ?? null) !== def) {
      p.push(
        `${TABLA}.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`
      );
    }
  }

  const [nCheck, dCheck] = CHECK;
  const linea = e.forma.checks.find((x) => x.startsWith(`${nCheck}: `));
  if (!linea) {
    p.push(`falta el CHECK ${nCheck} en ${TABLA}`);
  } else {
    const real = linea.slice(nCheck.length + 2);
    if (real !== dCheck) {
      p.push(
        `el CHECK ${nCheck} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${dCheck}`
      );
    }
  }

  /**
   * ============================================================
   * NO SE FIJA EL TOTAL DE COLUMNAS, Y ESO ES DELIBERADO
   * ============================================================
   *
   * La primera versión exigía 11 exactas. Lo levantó el migration-reviewer y tiene razón, con
   * un argumento de mantenimiento: el día que otra migración le agregue una columna a
   * event_calls, ESTA ruta empieza a devolver verificado:false en cualquier re-corrida. Un
   * falso negativo que manda a perseguir algo que no está roto, y que aparece lejos en el
   * tiempo de la línea que lo causó.
   *
   * Pero hay una razón más fuerte que esa, y es la que decide: EL TOTAL ES DE LA MIGRACIÓN QUE
   * POSEE LA TABLA. setup-convocatorias crea event_calls, declara sus diez columnas y ya cuenta
   * el total. Contarlo acá también es una SEGUNDA definición de la forma de una tabla ajena —
   * y dos definiciones de lo mismo se desincronizan el día que una se actualiza, siendo la que
   * queda atrás justamente la que nadie se acuerda de tocar.
   *
   * Es el mismo criterio que rolSobreColectivo siendo un solo primitivo, y el mismo que mover
   * la puerta del cron a lib/cron-auth.ts.
   *
   * LO QUE SÍ SE EXIGE es que las diez que esta ruta espera encontrar ESTÉN. Eso no es contar
   * el total: es comprobar que se está corriendo contra la tabla que se cree, y no contra una
   * event_calls a medio crear por una corrida que se cayó. Si falta alguna, el mensaje manda a
   * setup-convocatorias en vez de hablar de visibilidad.
   */
  const PREEXISTENTES = [
    "id",
    "event_id",
    "collective_slug",
    "cupos",
    "cierra_en",
    "cerrada_en",
    "cerrada_por",
    "abierta_por",
    "nota",
    "creada_en",
  ];
  const presentes = new Set(e.forma.columnas.map((x) => x.nombre));
  const faltan = PREEXISTENTES.filter((n) => !presentes.has(n));
  if (faltan.length > 0) {
    p.push(
      `a ${TABLA} le faltan columnas que setup-convocatorias tendría que haber creado ` +
        `(${faltan.join(", ")}): corré setup-convocatorias antes que esta`
    );
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

  const estado = async (): Promise<Estado> => {
    const [t] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${TABLA}`;
    if (!t) return { forma: { existe: false, columnas: [], checks: [] }, filas: 0 };

    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${TABLA}
      ORDER BY ordinal_position`;
    const checks = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = ${TABLA}::regclass AND contype = 'c'
      ORDER BY conname`;
    const [n] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);

    return {
      forma: {
        existe: true,
        columnas: cols.map((c) => ({
          nombre: c.column_name as string,
          tipo: c.data_type as string,
          aceptaNull: c.is_nullable === "YES",
          default: (c.column_default as string | null) ?? null,
        })),
        checks: checks.map((c) => `${c.conname}: ${c.def}`),
      },
      filas: n.n as number,
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        `SIMULACIÓN. ${TABLA} tiene ${antes.filas} fila(s), así que el ADD COLUMN NOT NULL con ` +
          "default no tiene ninguna que llenar. No hay backfill: el default es el valor correcto " +
          "para toda fila existente."
      );
      log.push(v.ok ? "Ya está aplicada." : `Falta aplicar: ${v.problemas.length} problema(s).`);
      for (const x of v.problemas) log.push(`  - ${x}`);
      /**
       * EL LOG VIAJA EN EL dryRun TAMBIÉN. La primera versión se lo comía: armaba las líneas y
       * devolvía todo menos ellas, así que la simulación contestaba con los problemas pero sin
       * la explicación de por qué no hay backfill ni cuántas filas tiene la tabla. La regla del
       * repo es que gana el log porque el log es lo que la gente lee — y uno que no se devuelve
       * no se lee nunca.
       */
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        antes,
        log,
      });
    }

    if (!antes.forma.existe) {
      return NextResponse.json(
        {
          ok: false,
          error: `Falta la tabla ${TABLA}. Corré setup-convocatorias primero.`,
        },
        { status: 409 }
      );
    }

    /**
     * EL ADD COLUMN Y EL SWAP DEL CHECK, CADA UNO EN SU TRANSACCIÓN.
     *
     * El DROP + ADD del CHECK va junto dentro de sql.transaction: sin eso hay una ventana de un
     * round-trip sin guarda, y si el ADD falla —una fila con un valor que el CHECK nuevo no
     * acepta tira check_violation, que NO es duplicate_object— la ventana no se cierra nunca.
     * Dentro de la transacción el ADD va desnudo: después del DROP no queda nada con ese nombre
     * que duplicar, así que un envoltorio solo podría tragarse un error real.
     */
    await sql(
      `ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS visibilidad TEXT NOT NULL DEFAULT 'djs'`
    );
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${CHECK[0]}`),
      sql(`ALTER TABLE ${TABLA} ADD CONSTRAINT ${CHECK[0]} ${CHECK[1]}`),
    ]);

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: ${TABLA}.visibilidad es TEXT NOT NULL DEFAULT 'djs', con su CHECK de dos ` +
            `valores verificado por definición, y las ${PREEXISTENTES_N} columnas que ` +
            `setup-convocatorias crea siguen en su lugar. El TOTAL de columnas no lo afirma ` +
            `esta ruta: es de la migración que posee la tabla.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const estables = despues.filas === antes.filas;
    log.push(
      estables
        ? `Sin cambios en los datos: ${despues.filas} fila(s) en ${TABLA}.`
        : `ATENCIÓN: ${TABLA} pasó de ${antes.filas} a ${despues.filas} filas. Esta migración no ` +
            "escribe ni borra ninguna, así que en main lo más probable es tráfico legítimo entre " +
            "las dos mediciones."
    );

    return NextResponse.json({
      ok: true,
      dryRun: false,
      /** verificado es SOLO la forma; los conteos van aparte, igual que en setup-convocatorias. */
      verificado: v.ok,
      conteosEstables: estables,
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
