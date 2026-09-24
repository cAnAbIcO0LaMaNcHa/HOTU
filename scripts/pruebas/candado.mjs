/**
 * EL CANDADO DE DEV: UNA SOLA COSA POR VEZ CONTRA ESTA BASE.
 *
 * ============================================================
 * QUÉ PROBLEMA RESUELVE, Y CÓMO SE DESCUBRIÓ
 * ============================================================
 *
 * restaurarSeed() barre por PATRÓN, no por lo que la batería creó. Eso es
 * a propósito —una corrida que se cae a mitad tiene que poder limpiarse
 * igual— pero significa que cualquier otra cosa que esté usando las
 * mismas convenciones al mismo tiempo desaparece bajo sus pies.
 *
 * Pasó de verdad: un agente revisaba la pantalla de limpieza mientras las
 * baterías corrían contra la misma base. Le borró las cuentas de prueba
 * que había creado, y el síntoma fue que su cuenta con SUPER_ADMIN empezó
 * a recibir 403. Persiguió un bug de permisos que no existía.
 *
 * El síntoma no se parece a la causa. Por eso hace falta un candado y no
 * una advertencia: la advertencia la lee quien ya sabe.
 *
 * ============================================================
 * POR QUÉ UNA FILA Y NO pg_advisory_lock
 * ============================================================
 *
 * Los advisory locks de Postgres son de SESIÓN, y el driver HTTP de Neon
 * no tiene sesión: cada sql`` es su propio request, su propia conexión y
 * su propia transacción. pg_try_advisory_lock() tomaría el lock y lo
 * soltaría en el mismo request — daría true siempre, que es peor que no
 * tener candado porque parece que protege.
 *
 * Así que el candado es una fila, y el ON CONFLICT de Postgres es lo que
 * lo hace atómico.
 *
 * ============================================================
 * LA TABLA LA CREA ESTE ARCHIVO, NO UNA MIGRACIÓN
 * ============================================================
 *
 * A propósito, y es la única excepción a la regla de que el schema entra
 * por /api/setup-*: zz_test_lock es infraestructura de pruebas, no schema
 * de la aplicación. Ningún código de la app la lee ni la escribe, y no
 * tiene por qué existir en main. El prefijo zz_ es para que nadie la
 * confunda con una tabla del producto.
 *
 * ============================================================
 * PARA UNA REVISIÓN A MANO, TOMALO DESDE LA TERMINAL
 * ============================================================
 *
 *   node scripts/pruebas/candado.mjs ver
 *   node scripts/pruebas/candado.mjs tomar "revision manual de la limpieza"
 *   node scripts/pruebas/candado.mjs liberar
 *
 * Eso es la mitad del punto: el candado no sirve si solo protege a las
 * baterías entre ellas. Lo que se pisó fue una persona contra una
 * batería.
 */

import { neon } from "@neondatabase/serverless";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";

const TABLA = "zz_test_lock";

/**
 * A partir de cuándo un candado se considera abandonado.
 *
 * Generoso a propósito: la revisión a mano que originó todo esto duró 20
 * minutos. Un umbral corto convertiría el candado en una molestia que la
 * gente aprende a saltear, que es la forma en que estas cosas mueren.
 */
const MINUTOS_ABANDONADO = 45;

async function asegurarTabla(sql) {
  await sql(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      id INTEGER PRIMARY KEY,
      quien TEXT NOT NULL,
      pid INTEGER NOT NULL,
      host TEXT NOT NULL,
      tomado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Quién lo tiene ahora, o null. */
export async function verCandado(sql) {
  await asegurarTabla(sql);
  const [f] = await sql(`SELECT quien, pid, host, tomado_en,
    EXTRACT(EPOCH FROM (now() - tomado_en))::int AS segundos FROM ${TABLA} WHERE id = 1`);
  return f
    ? {
        quien: f.quien,
        pid: Number(f.pid),
        host: f.host,
        tomadoEn: String(f.tomado_en),
        segundos: Number(f.segundos),
      }
    : null;
}

const minutos = (s) => Math.floor(s / 60);

/**
 * Toma el candado o REVIENTA con un mensaje que dice qué hacer.
 *
 * No espera ni reintenta. Si hay algo corriendo, lo que corresponde es
 * que la persona decida —esperar, o mirar si quedó colgado—, no que dos
 * cosas se acumulen para pisarse igual un minuto después.
 */
export async function tomarCandado(sql, quien) {
  await asegurarTabla(sql);
  const pid = process.pid;
  const host = hostname();

  const tomadas = await sql`
    INSERT INTO zz_test_lock (id, quien, pid, host)
    VALUES (1, ${quien}, ${pid}, ${host})
    ON CONFLICT (id) DO NOTHING
    RETURNING quien
  `;

  let robado = null;
  if (tomadas.length === 0) {
    const previo = await verCandado(sql);

    /**
     * Un candado viejo se ROBA, no se respeta para siempre.
     *
     * Sin esto, una batería que muere de un golpe —un Ctrl+C, un
     * proceso matado— deja dev trabada hasta que alguien lea este
     * archivo para saber cómo destrabarla. El robo es atómico: el WHERE
     * repite la condición de antigüedad, así que si dos lo intentan a la
     * vez, gana uno solo.
     */
    const robadas = await sql`
      UPDATE zz_test_lock
      SET quien = ${quien}, pid = ${pid}, host = ${host}, tomado_en = now()
      WHERE id = 1 AND tomado_en < now() - make_interval(mins => ${MINUTOS_ABANDONADO})
      RETURNING quien
    `;

    if (robadas.length === 0) {
      const q = previo?.quien ?? "alguien";
      const m = previo ? minutos(previo.segundos) : 0;
      throw new Error(
        `DEV ESTÁ OCUPADA. La tiene "${q}" (pid ${previo?.pid} en ${previo?.host}) ` +
          `desde hace ${m} minuto(s).\n\n` +
          "  Las baterías barren por patrón, así que correr dos cosas a la vez se\n" +
          "  pisa y el síntoma no se parece a la causa: aparecen 403 que se leen\n" +
          "  como un bug de permisos.\n\n" +
          "  Esperá a que termine, o si quedó colgada:\n" +
          "    node scripts/pruebas/candado.mjs ver\n" +
          "    node scripts/pruebas/candado.mjs liberar\n\n" +
          `  (Se roba solo a los ${MINUTOS_ABANDONADO} minutos.)`
      );
    }
    robado = previo;
  }

  const liberar = async () => {
    // El pid en el WHERE: nunca liberar el candado de otro. Después de un
    // robo la fila ya es nuestra, así que esto sigue funcionando.
    await sql`DELETE FROM zz_test_lock WHERE id = 1 AND pid = ${pid}`;
  };

  /**
   * Red de seguridad para las salidas que no pasan por el final.
   *
   * Una excepción sin atrapar mata el proceso sin ejecutar la liberación
   * de abajo, y el siguiente que venga se come 45 minutos de espera. Se
   * libera y RECIÉN AHÍ se sale, con el código que corresponde.
   */
  const alMorir = (etiqueta) => (e) => {
    console.error(`\n[candado] ${etiqueta}, liberando dev antes de salir:`, e);
    liberar()
      .catch(() => {})
      .finally(() => process.exit(1));
  };
  process.once("uncaughtException", alMorir("excepción sin atrapar"));
  process.once("unhandledRejection", alMorir("promesa rechazada"));
  process.once("SIGINT", alMorir("Ctrl+C"));

  if (robado) {
    console.log(
      `[candado] ROBADO uno abandonado: era de "${robado.quien}" (pid ${robado.pid}), ` +
        `de hace ${minutos(robado.segundos)} minuto(s). Si ese proceso sigue vivo, MATALO.`
    );
  }
  return { liberar };
}

/* ===================================================================
 * CLI
 * =================================================================== */
const esteArchivo = fileURLToPath(import.meta.url);
if (process.argv[1] && process.argv[1].replace(/\\/g, "/") === esteArchivo.replace(/\\/g, "/")) {
  const sql = neon(process.env.DATABASE_URL);
  const accion = process.argv[2];

  if (accion === "ver") {
    const c = await verCandado(sql);
    console.log(
      c
        ? `OCUPADA por "${c.quien}" (pid ${c.pid} en ${c.host}), desde hace ${minutos(c.segundos)} minuto(s).`
        : "LIBRE."
    );
  } else if (accion === "tomar") {
    const quien = process.argv[3] ?? "a mano";
    await asegurarTabla(sql);
    const t = await sql`
      INSERT INTO zz_test_lock (id, quien, pid, host)
      VALUES (1, ${quien}, ${process.pid}, ${hostname()})
      ON CONFLICT (id) DO NOTHING RETURNING quien
    `;
    if (t.length === 0) {
      const c = await verCandado(sql);
      console.error(`NO: ya la tiene "${c?.quien}" desde hace ${minutos(c?.segundos ?? 0)} minuto(s).`);
      process.exit(1);
    }
    /**
     * Sin red de seguridad y a propósito: este proceso termina ya, y el
     * candado tiene que SOBREVIVIRLO. Es el caso de la revisión a mano —
     * se toma, se trabaja, se libera cuando se terminó.
     */
    console.log(`TOMADA para "${quien}". Acordate de liberar:\n  node scripts/pruebas/candado.mjs liberar`);
  } else if (accion === "liberar") {
    const c = await verCandado(sql);
    await sql`DELETE FROM zz_test_lock WHERE id = 1`;
    console.log(c ? `LIBERADA (la tenía "${c.quien}").` : "Ya estaba libre.");
  } else {
    console.log("Uso: node scripts/pruebas/candado.mjs ver|tomar [quien]|liberar");
    process.exit(1);
  }
}
