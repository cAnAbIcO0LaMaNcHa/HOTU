/**
 * MÉTRICAS DE COLECTIVO Y VENUE.
 *
 * Lo que de verdad hay que medir, en orden:
 *
 *   QUE NO CUENTE LOS TOQUES DE SUS MIEMBROS. Es la regla que la pieza existe para respetar:
 *   un colectivo de diez DJs acumularía miles de horas que no son suyas. Se prueba con un
 *   miembro que tocó en un evento de OTRO organizador: ese evento no puede sumar acá.
 *
 *   QUE UN JOIN NO INFLE LOS EVENTOS. Los DJs salen de event_lineup, y si eso viniera como
 *   JOIN del mismo SELECT, un evento con cinco DJs contaría como cinco eventos. Se prueba con
 *   un evento de tres DJs: eventos tiene que dar 1.
 *
 *   QUE EL DENOMINADOR DE LAS HORAS SEA EL CORRECTO Y SE VEA. Con dos eventos de los cuales
 *   uno tiene horario, la página tiene que decir "en 1 de 2" y nunca "en los 2".
 *
 *   QUE NO APAREZCAN ASISTENTES, ni como celda vacía.
 *
 *   Y LAS DIFERENCIAS ENTRE VENUE Y COLECTIVO: un venue no cuenta venues ni residentes.
 */

import { neon } from "@neondatabase/serverless";
import { abrirCorrida } from "./seed.mjs";

const BASE = "http://localhost:3000";
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

/** Palabras distintas, nunca una prefijo de otra. */
const COL = "zz-metricas-crew";
const OTRO = "zz-metricas-rival";
const VEN = "zz-metricas-bodega";
const DUENO = "duena@test.hotu.local";
const DJ_UNO = "zz-metricas-dj-alfa";
const DJ_DOS = "zz-metricas-dj-beta";
const DJ_TRES = "zz-metricas-dj-gama";

const corrida = await abrirCorrida(sql, "metricas de colectivo");

const crearColectivo = (slug, nombre, kind) => sql`
  INSERT INTO collectives (slug, name, type, sector, bio, district, status, entity_kind, owner_email)
  VALUES (${slug}, ${nombre}, 'LOCAL', 'Bogota', '', 'D00', 'published', ${kind}, ${DUENO})
  ON CONFLICT (slug) DO UPDATE SET entity_kind = ${kind}`;

const crearArtista = (slug, nombre) => sql`
  INSERT INTO artists (slug, name, genre, district, city, bio, joined_at, status, review_status)
  VALUES (${slug}, ${nombre}, 'techno', 'D00', 'Bogota', 'bio', (now() AT TIME ZONE 'America/Bogota')::date, 'published', 'aprobado')
  ON CONFLICT (slug) DO NOTHING`;

/** Un evento con organizador, y opcionalmente con horario. */
const crearEvento = async (organizador, titulo, ciudad, venue, horas) => {
  const [e] = horas
    ? await sql`
        INSERT INTO events (title, event_date, city, venue, lineup, district, status, organizer_slug,
                            starts_at, end_at)
        VALUES (${titulo}, '2026-05-15', ${ciudad}, ${venue}, 'ZZ Lineup', 'D00', 'published',
                ${organizador},
                '2026-05-15T23:00:00-05:00'::timestamptz,
                ${`2026-05-16T0${horas - 1}:00:00-05:00`}::timestamptz)
        RETURNING id`
    : await sql`
        INSERT INTO events (title, event_date, city, venue, lineup, district, status, organizer_slug)
        VALUES (${titulo}, '2026-05-15', ${ciudad}, ${venue}, 'ZZ Lineup', 'D00', 'published', ${organizador})
        RETURNING id`;
  return e.id;
};

const metricas = async (slug) => {
  const [r] = await sql`
    SELECT
      COUNT(*)::int AS eventos,
      COUNT(DISTINCT lower(venue))::int AS venues,
      COUNT(DISTINCT lower(city))::int AS ciudades,
      COALESCE(SUM(CASE WHEN starts_at IS NOT NULL AND end_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (end_at - starts_at)) / 60 END), 0)::int AS minutos,
      COUNT(*) FILTER (WHERE starts_at IS NOT NULL AND end_at IS NOT NULL)::int AS con_horario
    FROM events WHERE organizer_slug = ${slug} AND status = 'published' AND censored_at IS NULL`;
  return r;
};

try {
  await crearColectivo(COL, "ZZ Metricas Crew", "collective");
  await crearColectivo(OTRO, "ZZ Metricas Rival", "collective");
  await crearColectivo(VEN, "ZZ Metricas Bodega", "venue");
  await crearArtista(DJ_UNO, "ZZ Metricas Alfa");
  await crearArtista(DJ_DOS, "ZZ Metricas Beta");
  await crearArtista(DJ_TRES, "ZZ Metricas Gama");
  chk("los fixtures se crearon", true);

  console.log("\n=== 1. SOLO LO QUE ORGANIZÓ, NUNCA LOS TOQUES DE SUS MIEMBROS ===");
  {
    /** Un evento del colectivo, y uno del RIVAL donde toca un miembro del colectivo. */
    const propio = await crearEvento(COL, "ZZ Fiesta Propia", "Bogota", "ZZ Venue Uno", 7);
    const ajeno = await crearEvento(OTRO, "ZZ Fiesta Ajena", "Medellin", "ZZ Venue Dos", 7);

    await sql`INSERT INTO event_lineup (event_id, artist_slug, raw_name) VALUES (${propio}, ${DJ_UNO}, 'ZZ Metricas Alfa')`;
    await sql`INSERT INTO event_lineup (event_id, artist_slug, raw_name) VALUES (${ajeno}, ${DJ_UNO}, 'ZZ Metricas Alfa')`;
    /** Y el DJ es miembro del colectivo: el caso que la regla protege. */
    await sql`INSERT INTO artist_collectives (artist_slug, collective_slug, kind, from_date, accepted_at)
              VALUES (${DJ_UNO}, ${COL}, 'miembro', (now() AT TIME ZONE 'America/Bogota')::date, now())`;

    const m = await metricas(COL);
    chk("cuenta UN evento, el propio", m.eventos === 1, String(m.eventos));
    chk("y NO el del rival donde tocó su miembro", m.eventos === 1, `contó ${m.eventos}`);
    chk("una ciudad, no dos", m.ciudades === 1, String(m.ciudades));
    chk("y un venue, no dos", m.venues === 1, String(m.venues));

    const [{ n: djs }] = await sql`
      SELECT COUNT(DISTINCT el.artist_slug)::int n FROM event_lineup el
      JOIN events e ON e.id = el.event_id
      WHERE e.organizer_slug = ${COL} AND e.status='published' AND e.censored_at IS NULL`;
    chk("un DJ tocó en sus eventos", djs === 1, String(djs));
  }

  console.log("\n=== 2. UN EVENTO CON TRES DJs SIGUE SIENDO UN EVENTO ===");
  {
    /**
     * EL BUG QUE ESTO ATAJA: si los DJs vinieran como JOIN del mismo SELECT que cuenta los
     * eventos, event_lineup multiplicaría las filas y un evento de tres DJs contaría como
     * tres eventos. Por eso los DJs van en su propia consulta.
     */
    const id = await crearEvento(COL, "ZZ Fiesta Tres", "Bogota", "ZZ Venue Uno", 7);
    for (const dj of [DJ_UNO, DJ_DOS, DJ_TRES]) {
      await sql`INSERT INTO event_lineup (event_id, artist_slug, raw_name) VALUES (${id}, ${dj}, ${dj})`;
    }
    const m = await metricas(COL);
    chk("EVENTOS SIGUE CONTANDO DE A UNO (ahora 2, no 4)", m.eventos === 2, `contó ${m.eventos}`);
    const [{ n: djs }] = await sql`
      SELECT COUNT(DISTINCT el.artist_slug)::int n FROM event_lineup el
      JOIN events e ON e.id = el.event_id
      WHERE e.organizer_slug = ${COL} AND e.status='published' AND e.censored_at IS NULL`;
    chk("y los DJs distintos son 3", djs === 3, String(djs));
  }

  console.log("\n=== 3. LAS HORAS, Y SU DENOMINADOR ===");
  {
    /** Un tercer evento SIN horario: el denominador tiene que decir 2 de 3. */
    await crearEvento(COL, "ZZ Fiesta Sin Hora", "Bogota", "ZZ Venue Uno", null);
    const m = await metricas(COL);
    chk("tres eventos", m.eventos === 3, String(m.eventos));
    chk("dos con horario", m.con_horario === 2, String(m.con_horario));
    /** 23:00 -> 06:00 son 7 h, dos veces = 840 minutos. */
    chk("y los minutos suman 840 (7 h x 2)", m.minutos === 840, String(m.minutos));

    const html = await (await fetch(`${BASE}/colectivos/${COL}`)).text();
    chk("la sección MÉTRICAS aparece", html.includes("MÉTRICAS"), "no aparece");
    chk("muestra 14 h", html.includes("14 h"), "no está la suma");
    chk("Y DICE EL DENOMINADOR: 'en 2 de 3'", html.includes("en 2 de 3"), "no está el denominador");
    chk("y NO dice 'en los 3'", !html.includes("en los 3"), "afirma que son todos");
  }

  console.log("\n=== 4. LAS MEMBRESÍAS: ACTIVAS Y ACEPTADAS ===");
  {
    /** Un residente aceptado, una invitación SIN aceptar, y un vínculo cerrado. */
    await sql`INSERT INTO artist_collectives (artist_slug, collective_slug, kind, from_date, accepted_at)
              VALUES (${DJ_DOS}, ${COL}, 'residente', (now() AT TIME ZONE 'America/Bogota')::date, now())`;
    await sql`INSERT INTO artist_collectives (artist_slug, collective_slug, kind, from_date)
              VALUES (${DJ_TRES}, ${COL}, 'miembro', (now() AT TIME ZONE 'America/Bogota')::date)`;
    await sql`INSERT INTO artist_collectives (artist_slug, collective_slug, kind, from_date, to_date, accepted_at)
              VALUES (${DJ_TRES}, ${COL}, 'miembro', '2024-01-01', '2024-06-01', now())`;

    const [m] = await sql`
      SELECT COUNT(*) FILTER (WHERE kind='residente')::int AS residentes,
             COUNT(*) FILTER (WHERE kind='miembro')::int   AS miembros
      FROM artist_collectives
      WHERE collective_slug = ${COL} AND to_date IS NULL AND accepted_at IS NOT NULL`;
    chk("un residente", m.residentes === 1, String(m.residentes));
    chk("UN miembro: no cuenta la invitación sin aceptar", m.miembros === 1, `contó ${m.miembros}`);

    const html = await (await fetch(`${BASE}/colectivos/${COL}`)).text();
    chk("la página muestra RESIDENTE", /RESIDENTE/.test(html), "no aparece");
    chk("y MIEMBRO", /MIEMBRO/.test(html), "no aparece");
    chk("y DJs QUE TOCARON", /DJs QUE TOCARON/.test(html), "no aparece");
  }

  console.log("\n=== 5. NO HAY ASISTENTES, NI COMO CELDA VACÍA ===");
  {
    const html = await (await fetch(`${BASE}/colectivos/${COL}`)).text();
    const i = html.indexOf("MÉTRICAS");
    const bloque = i < 0 ? "" : html.slice(i, i + 3000);
    chk("el bloque de métricas se aisló", bloque.length > 0, "no pude aislarlo");
    chk("no dice ASISTENTES", !/ASISTENTES/.test(bloque), "aparece");
    chk("ni PROMEDIO", !/PROMEDIO/.test(bloque), "aparece");
  }

  console.log("\n=== 6. UN VENUE NO CUENTA VENUES NI RESIDENTES ===");
  {
    await crearEvento(VEN, "ZZ Fiesta En Bodega", "Bogota", "ZZ Metricas Bodega", 7);
    const html = await (await fetch(`${BASE}/venues/${VEN}`)).text();
    const i = html.indexOf("MÉTRICAS");
    const bloque = i < 0 ? "" : html.slice(i, i + 3000);
    chk("el venue muestra MÉTRICAS", i >= 0, "no aparece");
    chk("no cuenta VENUES (sería siempre 1)", !/VENUE[S]?<\/div>/.test(bloque) && !/>VENUE</.test(bloque), bloque.slice(0, 300));
    chk("ni CIUDADES", !/CIUDADES/.test(bloque), "aparece");
    chk("ni RESIDENTES: la residencia no vale en un venue", !/RESIDENTE/.test(bloque), "aparece");
    chk("pero sí sus EVENTOS", /EVENTO/.test(bloque), "no aparece");
  }

  console.log("\n=== 7. SIN EVENTOS ORGANIZADOS, SIN SECCIÓN ===");
  {
    /** El rival tiene un evento; se lo saco y la sección tiene que desaparecer. */
    await sql`DELETE FROM event_lineup WHERE event_id IN (SELECT id FROM events WHERE organizer_slug = ${OTRO})`;
    await sql`DELETE FROM events WHERE organizer_slug = ${OTRO}`;
    const html = await (await fetch(`${BASE}/colectivos/${OTRO}`)).text();
    chk("el colectivo sin eventos renderiza", /ZZ Metricas Rival/.test(html), "la página se rompió");
    chk("y NO muestra MÉTRICAS", !html.includes("MÉTRICAS"), "muestra un bloque en cero");
  }

  /** Lo que la batería creó a mano y el delta no alcanza: los vínculos y los lineups. */
  await sql`DELETE FROM event_lineup WHERE artist_slug LIKE 'zz-metricas-%'`;
  await sql`DELETE FROM artist_collectives WHERE collective_slug IN (${COL}, ${VEN}, ${OTRO})`;
  await sql`DELETE FROM events WHERE organizer_slug IN (${COL}, ${VEN}, ${OTRO})`;
  await sql`DELETE FROM artists WHERE slug LIKE 'zz-metricas-%'`;
  await sql`DELETE FROM collectives WHERE slug IN (${COL}, ${VEN}, ${OTRO})`;
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
