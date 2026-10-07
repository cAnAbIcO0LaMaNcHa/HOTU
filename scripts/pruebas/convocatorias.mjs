/**
 * CONVOCATORIAS — LO QUE LA BASE SE NIEGA A GUARDAR.
 *
 *   node --env-file=.env.local scripts/pruebas/convocatorias.mjs
 *
 * Esta primera parte NO prueba el write path, que todavía no existe: prueba los CHECK de
 * setup-convocatorias mandando el INSERT de verdad.
 *
 * ============================================================
 * POR QUÉ MANDAR EL INSERT, SI LA MIGRACIÓN YA VERIFICA LA FORMA
 * ============================================================
 *
 * La migración compara la definición que Postgres rinde contra la que declara, carácter por
 * carácter. Eso prueba que el CHECK quedó como dice que quedó. NO prueba que lo que dice
 * sea correcto.
 *
 * Y la diferencia apareció en la primera corrida. El CHECK de `motivo` decía
 * `(resultado = ANY (ARRAY['rechazada','retirada','cancelada']))`, la definición medida
 * coincidía exactamente con la declarada, y verificado daba true. Pero una postulación
 * PENDIENTE con motivo entraba igual: con resultado en NULL, `resultado = ANY (...)` da
 * NULL, el AND entero da NULL, el OR da NULL, y UN CHECK QUE DA NULL PASA. Hizo falta
 * `(resultado IS NOT NULL)` adelante.
 *
 * O sea: comparar la forma es necesario y no es suficiente. Lo único que distingue "el
 * CHECK quedó bien escrito" de "el CHECK rechaza lo que tiene que rechazar" es mandarle la
 * fila mala y ver que la niegue.
 */

import { neon } from "@neondatabase/serverless";
import { abrirCorrida } from "./seed.mjs";

const sql = neon(process.env.DATABASE_URL);

let ok = 0;
let mal = 0;
const chk = (n, c, d = "") => {
  if (c) {
    ok++;
    console.log("   OK   " + n);
  } else {
    mal++;
    console.log("   MAL  " + n + (d ? " -> " + d : ""));
  }
};

const corrida = await abrirCorrida(sql, "convocatorias");

try {
  const ev = (await sql`SELECT id FROM events ORDER BY id LIMIT 1`)[0];
  const ar = (await sql`SELECT slug FROM artists ORDER BY slug LIMIT 1`)[0];
  const co = (await sql`SELECT slug FROM collectives ORDER BY slug LIMIT 1`)[0];
  if (!ev || !ar || !co) {
    throw new Error("dev no tiene evento, artista o colectivo para apoyarse");
  }

  const call = (
    await sql`
      INSERT INTO event_calls (event_id, collective_slug)
      VALUES (${ev.id}, ${co.slug}) RETURNING id`
  )[0].id;

  /**
   * Cada caso es un INSERT completo. `debeFallar` dice qué se espera, y los DOS sentidos
   * importan: una prueba que solo comprueba los rechazos pasaría con un CHECK que rechaza
   * TODO, que es peor que no tener ninguno.
   */
  const probar = async (nombre, debeFallar, campos, vals) => {
    let err = null;
    let id = null;
    try {
      id = (
        await sql(
          `INSERT INTO event_applications (call_id, artist_slug, mensaje, disponibilidad${campos})
           VALUES ($1, $2, 'un mensaje', 'los viernes'${vals}) RETURNING id`,
          [call, ar.slug]
        )
      )[0].id;
    } catch (e) {
      err = String(e.message || e);
    }
    chk(
      nombre,
      debeFallar ? Boolean(err) : !err,
      err ? err.slice(0, 110) : "entró y no debía"
    );
    if (id) await sql`DELETE FROM event_applications WHERE id = ${id}`;
  };

  console.log("\n1. LO QUE TIENE QUE ENTRAR");
  await probar("una pendiente limpia", false, "", "");
  await probar(
    "rechazada SIN motivo (al rechazar el motivo es opcional)",
    false,
    ", resuelta_en, resultado",
    ", now(), 'rechazada'"
  );
  await probar(
    "rechazada CON motivo",
    false,
    ", resuelta_en, resultado, motivo",
    ", now(), 'rechazada', 'no entra en el lineup'"
  );
  await probar(
    "cancelada completa: resuelta_en, cancelada_en y motivo",
    false,
    ", resuelta_en, resultado, cancelada_en, motivo",
    ", now(), 'cancelada', now(), 'el DJ avisó que no llega'"
  );

  console.log("\n2. LA CANCELACIÓN EXIGE SUS TRES COLUMNAS");
  await probar(
    "cancelada SIN motivo",
    true,
    ", resuelta_en, resultado, cancelada_en",
    ", now(), 'cancelada', now()"
  );
  await probar(
    "cancelada SIN cancelada_en",
    true,
    ", resuelta_en, resultado, motivo",
    ", now(), 'cancelada', 'se cayó'"
  );
  await probar(
    "cancelada_por sin cancelada_en",
    true,
    ", cancelada_por",
    ", (SELECT email FROM user_profiles ORDER BY email LIMIT 1)"
  );

  console.log("\n3. cancelada_en NO VALE EN NINGÚN OTRO ESTADO");
  /** Este es el caso del IS DISTINCT FROM: con <> la rama daría NULL y el CHECK pasaría. */
  await probar("una PENDIENTE con cancelada_en", true, ", cancelada_en", ", now()");
  await probar(
    "una ACEPTADA con cancelada_en",
    true,
    ", resuelta_en, resultado, cancelada_en",
    ", now(), 'aceptada', now()"
  );

  console.log("\n4. EL MOTIVO NO VALE EN CUALQUIER PARTE");
  /** Y este es el caso que comparar definiciones no vio. */
  await probar("una PENDIENTE con motivo", true, ", motivo", ", 'porque'");
  await probar(
    "una ACEPTADA con motivo",
    true,
    ", resuelta_en, resultado, motivo",
    ", now(), 'aceptada', 'porque'"
  );
  await probar(
    "motivo hecho solo de blancos",
    true,
    ", resuelta_en, resultado, motivo",
    ", now(), 'rechazada', '  '"
  );
  /** El NBSP del conjunto BLANCOS, que es el que se escribe mal y nadie ve. */
  await probar(
    "motivo hecho solo de un espacio duro",
    true,
    ", resuelta_en, resultado, motivo",
    ", now(), 'rechazada', '\u00A0'"
  );

  console.log("\n5. EL VOCABULARIO ES CERRADO Y LA RESOLUCIÓN ATA LAS DOS COLUMNAS");
  await probar("un resultado inventado", true, ", resuelta_en, resultado", ", now(), 'borrada'");
  await probar("resuelta_en sin resultado", true, ", resuelta_en", ", now()");
  await probar("resultado sin resuelta_en", true, ", resultado", ", 'aceptada'");

  console.log("\n6. UNA CANCELADA NO VETA AL DJ");
  /**
   * _una_pendiente_idx es parcial sobre resuelta_en IS NULL, y una cancelada la tiene
   * puesta, así que el DJ puede volver a postularse. Es la conducta correcta —cancelar una
   * participación no es vetar a nadie— y se mide acá para que nadie la "arregle".
   */
  const cancelada = (
    await sql`
      INSERT INTO event_applications
        (call_id, artist_slug, mensaje, disponibilidad, resuelta_en, resultado, cancelada_en, motivo)
      VALUES (${call}, ${ar.slug}, 'un mensaje', 'los viernes', now(), 'cancelada', now(), 'se cayó')
      RETURNING id`
  )[0].id;

  let reErr = null;
  let reId = null;
  try {
    reId = (
      await sql`
        INSERT INTO event_applications (call_id, artist_slug, mensaje, disponibilidad)
        VALUES (${call}, ${ar.slug}, 'otro mensaje', 'los sábados') RETURNING id`
    )[0].id;
  } catch (e) {
    reErr = String(e.message || e);
  }
  chk(
    "con una cancelada en el histórico, el DJ se puede volver a postular",
    Boolean(reId),
    reErr ?? ""
  );

  /** Y con esa pendiente nueva arriba, una SEGUNDA pendiente sí se niega. */
  let dosErr = null;
  try {
    await sql`
      INSERT INTO event_applications (call_id, artist_slug, mensaje, disponibilidad)
      VALUES (${call}, ${ar.slug}, 'la tercera', 'los domingos')`;
  } catch (e) {
    dosErr = String(e.message || e);
  }
  chk(
    "dos pendientes del mismo DJ en la misma convocatoria se niegan",
    Boolean(dosErr),
    "entró y no debía"
  );

  await sql`DELETE FROM event_applications WHERE call_id = ${call}`;

  console.log("\n7. UNA SOLA CONVOCATORIA ABIERTA POR EVENTO");
  let dosCalls = null;
  try {
    await sql`
      INSERT INTO event_calls (event_id, collective_slug)
      VALUES (${ev.id}, ${co.slug})`;
  } catch (e) {
    dosCalls = String(e.message || e);
  }
  chk(
    "dos convocatorias abiertas del mismo evento se niegan",
    Boolean(dosCalls),
    "entró y no debía"
  );

  await sql`UPDATE event_calls SET cerrada_en = now() WHERE id = ${call}`;
  let trasCerrar = null;
  try {
    const otra = (
      await sql`
        INSERT INTO event_calls (event_id, collective_slug)
        VALUES (${ev.id}, ${co.slug}) RETURNING id`
    )[0].id;
    await sql`DELETE FROM event_calls WHERE id = ${otra}`;
  } catch (e) {
    trasCerrar = String(e.message || e);
  }
  chk(
    "cerrada la primera, se puede abrir otra para el mismo evento",
    !trasCerrar,
    trasCerrar ?? ""
  );

  await sql`DELETE FROM event_calls WHERE id = ${call}`;
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
