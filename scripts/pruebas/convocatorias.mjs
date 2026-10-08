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

/**
 * EL HOOK DE RESOLUCIÓN VA ANTES DE CUALQUIER import DE lib/, y tiene que ir en un bloque
 * aparte: los import de un módulo ESM se izan, así que `register` no correría antes que
 * ellos si estuviera entre ellos. Por eso el import dinámico más abajo.
 *
 * Hace falta porque lib/events-write.ts importa con rutas relativas sin extensión —como
 * todo el repo, que es lo que TypeScript permite— y Node quita los tipos de un .ts pero no
 * inventa la extensión. Es el mismo hook que usa la batería de llaves.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./scripts/pruebas/hook-rutas.mjs", pathToFileURL("./"));

import { neon } from "@neondatabase/serverless";
import { abrirCorrida } from "./seed.mjs";
/**
 * Y SE IMPORTAN DESPUÉS DEL register, con await, por lo mismo: un import estático se izaría
 * por encima del hook y volvería a fallar al resolver las rutas relativas de lib/.
 */
const { normalizarEnSql } = await import("../../lib/convocatorias.ts");
const { normalizarNombre } = await import("../../lib/lineup-import.ts");
const { updateCommunityEvent } = await import("../../lib/events-write.ts");
const { barrerConvocatorias } = await import("../../lib/convocatorias-barrido.ts");
const { postularse } = await import("../../lib/convocatorias-write.ts");

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
            'fixture de la bateria de convocatorias', (now() AT TIME ZONE 'America/Bogota')::date)`;
  await sql`
    INSERT INTO collectives (slug, name, type, sector, bio)
    VALUES ('zz-restrict-beta', 'ZZ Restrict Beta', 'colectivo', 'centro',
            'fixture de la bateria de convocatorias')`;
  const ev2 = (
    await sql`
      INSERT INTO events (title, event_date, city, venue, district, lineup)
      VALUES ('ZZ Restrict Gamma', (now() AT TIME ZONE 'America/Bogota')::date + 30, 'Bogotá', 'ZZ Galpon', '06', 'ZZ Restrict Alfa')
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

  console.log("\n10. MOVER LA FIESTA RECORTA EL CIERRE, Y NO EN SILENCIO");
  {
    /**
     * Y EL DÍA SE LEE EN BOGOTÁ, NO CON UN ::date PELADO. La primera versión de estos tres
     * chequeos fallaba por un día, y el código estaba BIEN: el que estaba mal era yo.
     *
     * cierra_en es un instante y ::date lo convierte usando la zona de la SESIÓN, que en
     * Neon es UTC. El fin del 28 en Bogotá —23:59:59-05:00— es el 29 a las 04:59 en UTC, así
     * que ::date daba 29 donde la convocatoria cierra el 28.
     *
     * Es exactamente el bug contra el que este repo tiene una regla escrita, cometido dentro
     * de la prueba de la pieza: el error entra al cruzar entre instante y fecha de calendario
     * sin decidir la zona. Y vale decirlo porque el síntoma acusaba al código.
     */
    /**
     * DECIDIDO: SE AJUSTA, NO SE RECHAZA. Mover la fecha de una fiesta es algo que pasa y no
     * tiene por qué frenarse por una convocatoria. Lo que no puede pasar es que el ajuste sea
     * invisible, así que se mide en sus TRES mitades: que recorte, que SOLO recorte, y que
     * las dos personas afectadas se enteren.
     *
     * Se llama a updateCommunityEvent DE VERDAD y no se simula el UPDATE: lo que se está
     * probando es que el recorte viaje DENTRO de su transacción, y un UPDATE escrito acá a
     * mano probaría que yo sé escribir el UPDATE.
     */
    const dueno2 = `zz-ajuste-alfa@test.hotu.local`;
    await sql`
      INSERT INTO user_profiles (email, display_name, auth_provider)
      VALUES (${dueno2}, 'ZZ Ajuste Alfa', 'credentials')`;
    await sql`
      INSERT INTO artists (slug, name, genre, district, city, bio, joined_at, owner_email)
      VALUES ('zz-ajuste-beta', 'ZZ Ajuste Beta', 'techno', '06', 'Bogota',
              'fixture del ajuste de cierre', (now() AT TIME ZONE 'America/Bogota')::date, ${dueno2})`;
    await sql`
      INSERT INTO collectives (slug, name, type, sector, bio, owner_email)
      VALUES ('zz-ajuste-gamma', 'ZZ Ajuste Gamma', 'colectivo', 'centro',
              'fixture del ajuste de cierre', ${dueno2})`;

    /** La fiesta arranca lejos y la convocatoria cierra el dia de la fiesta. */
    const lejano = (await sql`SELECT ((now() AT TIME ZONE 'America/Bogota')::date + 60)::text AS d`)[0].d;
    const cercano = (await sql`SELECT ((now() AT TIME ZONE 'America/Bogota')::date + 20)::text AS d`)[0].d;
    const ev3 = (
      await sql`
        INSERT INTO events (title, event_date, city, venue, district, lineup, organizer_slug, status)
        VALUES ('ZZ Ajuste Delta', ${lejano}::date, 'Bogotá', 'ZZ Galpon', '06',
                'ZZ Ajuste Beta', 'zz-ajuste-gamma', 'published')
        RETURNING id`
    )[0].id;
    const call3 = (
      await sql`
        INSERT INTO event_calls (event_id, collective_slug, cierra_en, abierta_por)
        VALUES (${ev3}, 'zz-ajuste-gamma', (${lejano} || 'T23:59:59-05:00')::timestamptz, ${dueno2})
        RETURNING id`
    )[0].id;
    const post3 = (
      await sql`
        INSERT INTO event_applications (call_id, artist_slug, mensaje, disponibilidad)
        VALUES (${call3}, 'zz-ajuste-beta', 'me anoto', 'los viernes')
        RETURNING id`
    )[0].id;

    const avisosAntes = (
      await sql`SELECT COUNT(*)::int AS n FROM mail_outbox WHERE tipo = 'convocatoria_cierre_recortado'`
    )[0].n;

    /** PARA ATRÁS: tiene que recortar. */
    const r1 = await updateCommunityEvent(ev3, { date: cercano }, dueno2);
    chk(
      "mover la fiesta para ATRÁS deja pasar el cambio",
      r1.ok === true,
      r1.ok ? "" : `${r1.status} ${r1.error}`
    );
    chk(
      "y le dice al organizador a qué día quedó el cierre",
      r1.ok === true && r1.value.cierreRecortadoA === cercano,
      r1.ok ? `devolvió ${r1.value.cierreRecortadoA}, se esperaba ${cercano}` : ""
    );
    const [c1] = await sql`
      SELECT (cierra_en AT TIME ZONE 'America/Bogota')::date::text AS d
      FROM event_calls WHERE id = ${call3}`;
    chk(
      "y cierra_en quedó de verdad en la fecha nueva",
      c1.d === cercano,
      `cierra_en quedó en ${c1.d}, se esperaba ${cercano}`
    );

    /** El DJ con pendiente lo ve en su bandeja. */
    const avisos = await sql`
      SELECT para FROM mail_outbox
      WHERE tipo = 'convocatoria_cierre_recortado' AND referencia = 'artist:zz-ajuste-beta'`;
    chk(
      "y el DJ con postulación pendiente tiene el aviso en su bandeja",
      avisos.length === 1 && avisos[0].para === dueno2,
      `${avisos.length} avisos, para ${avisos.map((a) => a.para).join(", ")}`
    );

    /** PARA ADELANTE: NO tiene que alargar. */
    const r2 = await updateCommunityEvent(ev3, { date: lejano }, dueno2);
    const [c2] = await sql`
      SELECT (cierra_en AT TIME ZONE 'America/Bogota')::date::text AS d
      FROM event_calls WHERE id = ${call3}`;
    chk(
      "mover la fiesta para ADELANTE no alarga el cierre",
      c2.d === cercano,
      `cierra_en quedó en ${c2.d}, tenía que seguir en ${cercano}`
    );
    chk(
      "y no le anuncia al organizador un recorte que no hubo",
      r2.ok === true && r2.value.cierreRecortadoA === null,
      r2.ok ? `devolvió ${r2.value.cierreRecortadoA}` : `${r2.status}`
    );
    chk(
      "ni manda un segundo aviso",
      (await sql`SELECT COUNT(*)::int AS n FROM mail_outbox WHERE tipo = 'convocatoria_cierre_recortado'`)[0].n ===
        avisosAntes + 1,
      "el conteo de avisos se movió de más"
    );

    /**
     * UNA CONVOCATORIA CERRADA NO SE TOCA. Su cierra_en es historia: dice cuándo se había
     * previsto cerrarla, y recortarlo después reescribiría eso sin que nadie lo pidiera.
     */
    await sql`UPDATE event_calls SET cerrada_en = now() WHERE id = ${call3}`;
    await sql`
      UPDATE event_calls SET cierra_en = (${lejano} || 'T23:59:59-05:00')::timestamptz
      WHERE id = ${call3}`;
    await updateCommunityEvent(ev3, { date: cercano }, dueno2);
    const [c3] = await sql`
      SELECT (cierra_en AT TIME ZONE 'America/Bogota')::date::text AS d
      FROM event_calls WHERE id = ${call3}`;
    chk(
      "una convocatoria YA CERRADA no se le recorta el cierre",
      c3.d === lejano,
      `cierra_en quedó en ${c3.d}, tenía que seguir en ${lejano}`
    );

    await sql`DELETE FROM event_applications WHERE id = ${post3}`;
    await sql`DELETE FROM event_calls WHERE id = ${call3}`;
    await sql`DELETE FROM events WHERE id = ${ev3}`;
  }

  console.log("\n11. EL BARRIDO CIERRA EL REGISTRO Y RESPONDE A QUIEN ESPERABA");
  {
    /**
     * LO QUE EL BARRIDO *NO* HACE ES DECIDIR EL PERMISO, y eso se mide PRIMERO porque es la
     * propiedad de la que depende todo el diseño: una convocatoria vencida ya no acepta
     * postulaciones ANTES de que el cron corra. Si esa primera mitad fallara, el barrido
     * pasaría a ser una puerta y habría una ventana de hasta 24 horas.
     */
    const dueno4 = `zz-barrido-alfa@test.hotu.local`;
    await sql`
      INSERT INTO user_profiles (email, display_name, auth_provider)
      VALUES (${dueno4}, 'ZZ Barrido Alfa', 'credentials')`;
    await sql`
      INSERT INTO artists (slug, name, genre, district, city, bio, joined_at, owner_email)
      VALUES ('zz-barrido-beta', 'ZZ Barrido Beta', 'techno', '06', 'Bogota',
              'fixture del barrido', (now() AT TIME ZONE 'America/Bogota')::date, ${dueno4})`;
    await sql`
      INSERT INTO collectives (slug, name, type, sector, bio, owner_email)
      VALUES ('zz-barrido-gamma', 'ZZ Barrido Gamma', 'colectivo', 'centro',
              'fixture del barrido', ${dueno4})`;

    /**
     * Dos vencidas por los DOS motivos distintos, para que el barrido tenga que encontrar las
     * dos: una a la que se le pasó cierra_en con la fiesta todavía por venir, y otra cuya
     * FIESTA ya pasó aunque nunca tuvo fecha de cierre.
     */
    const futuro = (await sql`SELECT ((now() AT TIME ZONE 'America/Bogota')::date + 30)::text AS d`)[0].d;
    const pasado = (await sql`SELECT ((now() AT TIME ZONE 'America/Bogota')::date - 3)::text AS d`)[0].d;
    const nuevoEvento = async (titulo, dia) =>
      (
        await sql`
          INSERT INTO events (title, event_date, city, venue, district, lineup, organizer_slug, status)
          VALUES (${titulo}, ${dia}::date, 'Bogota', 'ZZ Galpon', '06', 'nadie',
                  'zz-barrido-gamma', 'published') RETURNING id`
      )[0].id;

    const evCierre = await nuevoEvento('ZZ Barrido Cierre', futuro);
    const evPasado = await nuevoEvento('ZZ Barrido Pasado', pasado);
    const evVigente = await nuevoEvento('ZZ Barrido Vigente', futuro);

    /** Vencida por cierra_en: el cierre fue ayer y la fiesta es en 30 días. */
    const callCierre = (
      await sql`
        INSERT INTO event_calls (event_id, collective_slug, cierra_en)
        VALUES (${evCierre}, 'zz-barrido-gamma', now() - interval '1 day') RETURNING id`
    )[0].id;
    /** Vencida porque la fiesta pasó, sin fecha de cierre. */
    const callPasado = (
      await sql`
        INSERT INTO event_calls (event_id, collective_slug)
        VALUES (${evPasado}, 'zz-barrido-gamma') RETURNING id`
    )[0].id;
    /** Y una VIGENTE, que el barrido no puede tocar. */
    const callVigente = (
      await sql`
        INSERT INTO event_calls (event_id, collective_slug, cierra_en)
        VALUES (${evVigente}, 'zz-barrido-gamma', now() + interval '10 days') RETURNING id`
    )[0].id;

    for (const c of [callCierre, callPasado, callVigente]) {
      await sql`
        INSERT INTO event_applications (call_id, artist_slug, mensaje, disponibilidad)
        VALUES (${c}, 'zz-barrido-beta', 'me anoto', 'los viernes')`;
    }

    const antesDeBarrer = await postularse(
      {
        callId: callCierre,
        artistSlug: 'zz-barrido-beta',
        mensaje: 'otra vez',
        disponibilidad: 'cuando sea',
      },
      dueno4
    );
    chk(
      "una convocatoria vencida ya rechaza postulaciones ANTES de que el barrido corra",
      antesDeBarrer.ok === false && antesDeBarrer.status === 409,
      JSON.stringify(antesDeBarrer)
    );

    const simulado = await barrerConvocatorias(true);
    chk(
      "el dryRun encuentra las DOS vencidas y no la vigente",
      simulado.resumen.convocatorias === 2,
      `contó ${simulado.resumen.convocatorias}`
    );
    chk(
      "y las dos pendientes que hay en ellas",
      simulado.resumen.postulaciones === 2,
      `contó ${simulado.resumen.postulaciones}`
    );
    const [sinTocar] = await sql`
      SELECT COUNT(*)::int AS n FROM event_calls
      WHERE id = ANY(${[callCierre, callPasado]}::int[]) AND cerrada_en IS NULL`;
    chk(
      "y el dryRun no escribió nada",
      sinTocar.n === 2,
      `quedaron ${sinTocar.n} sin cerrar de 2`
    );

    const avisosAntes4 = (
      await sql`
        SELECT COUNT(*)::int AS n FROM mail_outbox
        WHERE referencia = 'artist:zz-barrido-beta'`
    )[0].n;
    const real = await barrerConvocatorias(false);
    chk(
      "la corrida real cierra las dos vencidas",
      real.resumen.convocatorias === 2,
      `cerró ${real.resumen.convocatorias}`
    );
    chk(
      "y rechaza sus dos pendientes",
      real.resumen.postulaciones === 2,
      `rechazó ${real.resumen.postulaciones}`
    );
    chk(
      "y deja un aviso por cada rechazo, porque el barrido ES la respuesta",
      real.resumen.avisos === 2,
      `dejó ${real.resumen.avisos} avisos para 2 rechazos`
    );
    const [avisosDespues] = await sql`
      SELECT COUNT(*)::int AS n FROM mail_outbox
      WHERE referencia = 'artist:zz-barrido-beta'`;
    chk(
      "y los avisos están de verdad en mail_outbox, no solo en el conteo",
      avisosDespues.n === avisosAntes4 + 2,
      `mail_outbox pasó de ${avisosAntes4} a ${avisosDespues.n}`
    );

    const porQuien = await sql`
      SELECT id, cerrada_por FROM event_calls
      WHERE id = ANY(${[callCierre, callPasado]}::int[])`;
    chk(
      "las cerró con cerrada_por en NULL, que es cómo se distingue del cierre a mano",
      porQuien.length === 2 && porQuien.every((f) => f.cerrada_por === null),
      JSON.stringify(porQuien)
    );

    const [vig] = await sql`
      SELECT ec.cerrada_en,
             (SELECT COUNT(*)::int FROM event_applications ea
               WHERE ea.call_id = ec.id AND ea.resuelta_en IS NULL) AS pendientes
      FROM event_calls ec WHERE ec.id = ${callVigente}`;
    chk(
      "la convocatoria VIGENTE sigue abierta y su pendiente intacta",
      vig.cerrada_en === null && vig.pendientes === 1,
      JSON.stringify(vig)
    );

    /** La segunda pasada barre cero: es la prueba de que se puede repetir sin daño. */
    const otraVez = await barrerConvocatorias(false);
    chk(
      "una segunda pasada barre CERO",
      otraVez.resumen.convocatorias === 0 && otraVez.resumen.postulaciones === 0,
      JSON.stringify(otraVez.resumen)
    );

    await sql`DELETE FROM event_applications WHERE artist_slug = 'zz-barrido-beta'`;
    await sql`DELETE FROM event_calls WHERE collective_slug = 'zz-barrido-gamma'`;
    await sql`DELETE FROM events WHERE organizer_slug = 'zz-barrido-gamma'`;
  }
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
