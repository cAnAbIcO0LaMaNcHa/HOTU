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
/** Se importan los .ts de verdad: Node 24 les quita los tipos solo. */
import { normalizarEnSql } from "../../lib/convocatorias.ts";
import { normalizarNombre } from "../../lib/lineup-import.ts";

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

  /**
   * ESTE ES EL CASO QUE ERA LATENTE, y va acá y no en la sección del motivo porque lo que
   * prueba es _cancelacion_check.
   *
   * Con resultado NULL, cancelada_en puesto Y motivo puesto, la rama izquierda del CHECK
   * daba NULL y la fila entraba. Hoy la rechaza _motivo_check igual, así que esta prueba
   * pasaría incluso con el agujero abierto — y se deja escrita de todos modos, porque lo que
   * documenta es que la fila NO debe entrar por ningún camino. Si algún día alguien afloja
   * _motivo_check, el que tiene que atajarla es el de la cancelación.
   */
  await probar(
    "una PENDIENTE con cancelada_en Y motivo (el agujero latente)",
    true,
    ", cancelada_en, motivo",
    ", now(), 'porque'"
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

  console.log("\n8. NADA SE BORRA EN SILENCIO: LOS CUATRO RESTRICT");
  /**
   * Esto NO prueba la definición del FK —eso lo hace la migración comparando la forma— sino
   * la CONDUCTA: que el DELETE del otro lado efectivamente se niegue. Es la misma distinción
   * que con los CHECK: la definición puede estar escrita tal como se declaró y significar
   * otra cosa.
   *
   * Los fixtures se nombran con palabras distintas y no numeradas, porque ningún nombre de
   * fixture puede ser prefijo de otro.
   */
  const dueno = "zz-restrict-uno@test.hotu.local";
  await sql`
    INSERT INTO user_profiles (email, display_name, auth_provider)
    VALUES (${dueno}, 'ZZ Restrict Alfa', 'credentials')`;
  /**
   * LAS COLUMNAS NOT NULL SIN DEFAULT ESTÁN TODAS, Y SE MIDIERON EN VEZ DE ADIVINARLAS.
   * Medido contra information_schema: artists exige slug, name, genre, city, bio y
   * joined_at; collectives exige slug, name, type, sector y bio; events exige event_date,
   * city, venue, title, lineup y district. Adiviné dos veces antes de preguntárselo a la
   * base, y cada intento costó una corrida entera.
   */
  await sql`
    INSERT INTO artists (slug, name, genre, district, city, bio, joined_at)
    VALUES ('zz-restrict-alfa', 'ZZ Restrict Alfa', 'techno', '06', 'Bogota',
            'fixture de la bateria de convocatorias', CURRENT_DATE)`;
  await sql`
    INSERT INTO collectives (slug, name, type, sector, bio)
    VALUES ('zz-restrict-beta', 'ZZ Restrict Beta', 'colectivo', 'centro',
            'fixture de la bateria de convocatorias')`;
  const ev2 = (
    await sql`
      INSERT INTO events (title, event_date, city, venue, district, lineup)
      VALUES ('ZZ Restrict Gamma', CURRENT_DATE + 30, 'Bogotá', 'ZZ Galpon', '06', 'ZZ Restrict Alfa')
      RETURNING id`
  )[0].id;
  const call2 = (
    await sql`
      INSERT INTO event_calls (event_id, collective_slug, abierta_por)
      VALUES (${ev2}, 'zz-restrict-beta', ${dueno}) RETURNING id`
  )[0].id;
  const post2 = (
    await sql`
      INSERT INTO event_applications (call_id, artist_slug, mensaje, disponibilidad)
      VALUES (${call2}, 'zz-restrict-alfa', 'me anoto', 'los viernes') RETURNING id`
  )[0].id;

  const seNiega = async (nombre, consulta) => {
    let err = null;
    try {
      await consulta();
    } catch (e) {
      err = String(e.message || e);
    }
    chk(nombre, Boolean(err) && err.includes("violates foreign key"), err ?? "entró y no debía");
  };

  await seNiega(
    "borrar el EVENTO de una convocatoria se niega",
    () => sql`DELETE FROM events WHERE id = ${ev2}`
  );
  await seNiega(
    "borrar el COLECTIVO que la abrió se niega",
    () => sql`DELETE FROM collectives WHERE slug = 'zz-restrict-beta'`
  );
  await seNiega(
    "borrar el ARTISTA que se postuló se niega",
    () => sql`DELETE FROM artists WHERE slug = 'zz-restrict-alfa'`
  );
  await seNiega(
    "borrar la CONVOCATORIA con postulaciones se niega",
    () => sql`DELETE FROM event_calls WHERE id = ${call2}`
  );

  /**
   * Y LA OTRA MITAD: la cuenta del dueño SÍ se borra, y la convocatoria sobrevive sin ella.
   * Es la asimetría deliberada —se pierde quién, no el hecho— y sin medirla, "los *_por siguen
   * SET NULL" es una afirmación sobre un archivo y no sobre la base.
   */
  await sql`DELETE FROM user_profiles WHERE email = ${dueno}`;
  const [tras] = await sql`SELECT abierta_por FROM event_calls WHERE id = ${call2}`;
  chk(
    "borrar la cuenta del dueño NO borra la convocatoria, le deja abierta_por en NULL",
    Boolean(tras) && tras.abierta_por === null,
    tras ? `abierta_por = ${tras.abierta_por}` : "la convocatoria desapareció"
  );

  /** Y en el orden correcto sale todo, que es lo que hace el barrido del arnés. */
  await sql`DELETE FROM event_applications WHERE id = ${post2}`;
  await sql`DELETE FROM event_calls WHERE id = ${call2}`;
  let orden = null;
  try {
    await sql`DELETE FROM events WHERE id = ${ev2}`;
    await sql`DELETE FROM collectives WHERE slug = 'zz-restrict-beta'`;
    await sql`DELETE FROM artists WHERE slug = 'zz-restrict-alfa'`;
  } catch (e) {
    orden = String(e.message || e);
  }
  chk("en el orden correcto —postulaciones, convocatoria, resto— sale todo", !orden, orden ?? "");

  console.log("\n9. LOS DOS NORMALIZADORES DE NOMBRE TIENEN QUE COINCIDIR");
  {
    /**
     * ACEPTAR UNA POSTULACIÓN REEMPLAZA LA FILA SIN RESOLVER DEL LINEUP POR NOMBRE
     * NORMALIZADO, Y TIENE QUE PASAR EN UNA SENTENCIA, así que la comparación se hace del
     * lado de Postgres. Eso obliga a una SEGUNDA implementación de normalizarNombre(), que ya
     * existe en JS.
     *
     * Dos normalizadores que discrepan fallan CALLADOS: el UPDATE no encuentra la fila, el
     * INSERT entra al lado, y el lineup muestra al DJ dos veces sin ningún error. Así que la
     * duplicación se vuelve un invariante MEDIDO y no una esperanza.
     *
     * Y ya encontró algo en la primera corrida: translate de SQL no entiende las marcas
     * combinantes, y normalizarNombre sí porque hace NFD. Una "ë" descompuesta —e + U+0308,
     * que es lo que producen macOS y varios IME— pasaba entera por SQL y se convertía en
     * "e" en JS. Los dos resultados SE VEN IGUAL en pantalla. Por eso normalizarEnSql borra
     * las seis marcas combinantes antes de traducir los precompuestos.
     *
     * Los invisibles de los casos se arman con fromCharCode y no con escapes: la herramienta
     * que escribe archivos en este entorno convierte un escape en el carácter real, así que
     * un \u0308 en el fuente dejaría de ser una prueba de la forma descompuesta.
     */
    const CH = (n) => String.fromCharCode(n);
    const NBSP = CH(160);
    const AGUDA = CH(0x301);
    const GRAVE = CH(0x300);
    const CIRC = CH(0x302);
    const TILDE = CH(0x303);
    const DIERESIS = CH(0x308);
    const CEDILLA = CH(0x327);

    const adversarios = [
      "Camila", "CAMILA", "  Camila  ", "Camila   Rojas", "Camilá", "CAMILÁ",
      "José Núñez", "JOSE NUNEZ", "Beatriz Gonçalves", "Müller", "São Paulo Crew",
      "Añejo ÑOÑO", "Zoë", "DJ  Sombra ", "Ángel Ávila Óscar Ünal", "",
      "Camila" + NBSP + "Rojas", "a" + CH(9) + "b", "a" + CH(13) + CH(10) + "b", "  ",
      /* y los mismos, DESCOMPUESTOS */
      "Zoe" + DIERESIS, "Jose" + AGUDA + " Nun" + TILDE + "ez", "Mu" + DIERESIS + "ller",
      "Gonc" + CEDILLA + "alves", "Cami" + GRAVE + "la", "Sa" + TILDE + "o Paulo",
      "Ae" + CIRC + "reo", "e" + AGUDA + "  " + NBSP + "  e" + DIERESIS,
    ];

    /** Y todo lo que de verdad hay en la base, que es lo que el write path va a comparar. */
    const deLaBase = await sql`
      SELECT raw_name AS t FROM event_lineup
      UNION SELECT name FROM artists
      UNION SELECT name FROM collectives`;
    const reales = deLaBase.map((r) => r.t).filter((x) => typeof x === "string");

    let coinciden = 0;
    const discrepan = [];
    for (const t of [...adversarios, ...reales]) {
      const [fila] = await sql(`SELECT ${normalizarEnSql("$1")} AS dice`, [t]);
      if (fila.dice === normalizarNombre(t)) coinciden++;
      else discrepan.push(`${JSON.stringify(t)}: js=${JSON.stringify(normalizarNombre(t))} sql=${JSON.stringify(fila.dice)}`);
    }
    chk(
      `los ${adversarios.length} casos adversarios y los ${reales.length} nombres de la base normalizan igual en JS y en SQL`,
      discrepan.length === 0,
      discrepan.join(" | ")
    );
    /**
     * Y QUE DE VERDAD HAYA PROBADO ALGO. Un cero de discrepancias puede significar que
     * coinciden o que la lista salió vacía, y esas dos cosas hay que poder distinguirlas —
     * mismo razonamiento que el barrido que daba cero en arnes.mjs.
     */
    chk(
      "y se comparó algo: al menos 40 cadenas, con nombres reales de la base entre ellas",
      coinciden + discrepan.length >= 40 && reales.length > 0,
      `comparadas ${coinciden + discrepan.length}, de la base ${reales.length}`
    );
  }
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
