/**
 * LA HORA DE INICIO, LA MADRUGADA Y LA ZONA.
 *
 * Los cuatro casos que pediste —23:00 del 15, 01:00 → 16, 06:00 → 16, 07:00 → 15—
 * más la zona, la duración, el orden de la agenda, y que editar el título no borre
 * ni la hora ni el precio.
 *
 * La zona se mide de verdad y no se razona: lo que se escribe como 23:00 de Bogotá
 * tiene que quedar como 04:00 UTC del día siguiente. Si el server la interpretara
 * en su propia zona —Vercel corre en UTC— daría 23:00 UTC, que son las 18:00 de
 * Bogotá: cinco horas de error sin ningún síntoma.
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

const J = new Map();
const g = (q, r) => {
  const j = J.get(q) ?? new Map();
  for (const x of r.headers.getSetCookie?.() ?? []) {
    const [pp] = x.split(";");
    const i = pp.indexOf("=");
    const k = pp.slice(0, i).trim();
    const v = pp.slice(i + 1).trim();
    if (v === "") j.delete(k);
    else j.set(k, v);
  }
  J.set(q, j);
};
const ck = (q) => [...(J.get(q) ?? new Map())].map(([k, v]) => `${k}=${v}`).join("; ");
async function login(q, email) {
  J.set(q, new Map());
  const r1 = await fetch(`${BASE}/api/auth/csrf`);
  g(q, r1);
  const { csrfToken } = await r1.json();
  g(
    q,
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: ck(q) },
      body: new URLSearchParams({ csrfToken, email, password: "test1234", redirect: "false", json: "true" }),
      redirect: "manual",
    })
  );
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: ck(q) } })).json();
  return s?.user?.email ?? null;
}
const req = async (q, m, ruta, b) => {
  const res = await fetch(`${BASE}${ruta}`, {
    method: m,
    headers: { "Content-Type": "application/json", ...(q ? { cookie: ck(q) } : {}) },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const DUENO = "duena@test.hotu.local";
const COL = "zz-hora-col";
/** Un 15 que es sábado, para que el aviso de la madrugada nombre el domingo 16. */
const DIA = "2027-05-15";

const corrida = await abrirCorrida(sql, "hora de evento");

try {
  await sql`INSERT INTO collectives (slug,name,type,sector,bio,district,status,entity_kind,owner_email)
            VALUES (${COL},'ZZ Hora Col','LOCAL','Bogota','','D00','published','collective',${DUENO})`;
  chk("login del dueño", (await login("d", DUENO)) === DUENO);

  const crear = (extra, titulo) =>
    req("d", "POST", "/api/events", {
      organizerSlug: COL,
      title: titulo ?? "ZZ Hora Fiesta",
      date: DIA,
      venue: "ZZ Bodega",
      city: "Bogota",
      lineup: "ZZ DJ",
      ...extra,
    });

  console.log("=== 1. LOS CUATRO CASOS DE LA MADRUGADA ===");
  {
    /**
     * Cada caso dice qué DÍA CALENDARIO tiene que tener el instante guardado. Se
     * lee con AT TIME ZONE 'America/Bogota' para preguntar en la zona en la que la
     * regla está escrita: preguntarlo en UTC daría el 16 para una fiesta de las
     * 23:00 del 15, y eso es correcto pero no es lo que la regla decide.
     */
    const casos = [
      ["23:00", DIA, "la noche del 15 se queda en el 15"],
      ["01:00", "2027-05-16", "la 1:00 es madrugada -> 16"],
      ["06:00", "2027-05-16", "las 6:00 TAMBIÉN son madrugada -> 16"],
      ["07:00", DIA, "las 7:00 ya no -> 15"],
    ];
    for (const [hora, diaEsperado, que] of casos) {
      const r = await crear({ startTime: hora }, `ZZ Hora ${hora}`);
      if (r.status !== 201) {
        chk(`${hora}: se crea`, false, JSON.stringify(r));
        continue;
      }
      const [e] = await sql`
        SELECT (starts_at AT TIME ZONE 'America/Bogota')::date::text AS dia,
               to_char(starts_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS hora
        FROM events WHERE id = ${r.data.id}`;
      chk(`${hora} -> ${diaEsperado} (${que})`, e.dia === diaEsperado, `quedó el ${e.dia}`);
      chk(`${hora} conserva la hora en Bogotá`, e.hora === hora, `quedó ${e.hora}`);
    }
  }

  console.log("\n=== 2. LA ZONA, MEDIDA EN UTC ===");
  {
    const r = await crear({ startTime: "23:00" }, "ZZ Hora Zona");
    const [e] = await sql`
      SELECT to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc
      FROM events WHERE id = ${r.data.id}`;
    chk(
      "23:00 de Bogotá se guarda como 04:00 UTC del día siguiente",
      e.utc === "2027-05-16 04:00",
      `quedó ${e.utc} — si dice "2027-05-15 23:00" el server usó SU zona y hay 5 horas de error`
    );
  }

  console.log("\n=== 3. LA DURACIÓN, SOLO CON LOS DOS EXTREMOS ===");
  {
    const conAmbas = await crear({ startTime: "23:00", endTime: "06:00" }, "ZZ Hora Ambas");
    chk("23:00 -> 06:00 se acepta", conAmbas.status === 201, JSON.stringify(conAmbas));
    const [e] = await sql`
      SELECT EXTRACT(EPOCH FROM (end_at - starts_at))/3600 AS horas
      FROM events WHERE id = ${conAmbas.data.id}`;
    chk(
      "y dura 7 horas, porque el cierre se fue al día siguiente solo",
      Number(e.horas) === 7,
      `dio ${e.horas} horas`
    );

    const soloInicio = await crear({ startTime: "22:00" }, "ZZ Hora Solo Inicio");
    const [b] = await sql`SELECT starts_at, end_at FROM events WHERE id = ${soloInicio.data.id}`;
    chk("solo inicio: se acepta y el fin queda NULL", b.starts_at && b.end_at === null, JSON.stringify(b));

    const ninguna = await crear({}, "ZZ Hora Ninguna");
    const [c] = await sql`SELECT starts_at, end_at FROM events WHERE id = ${ninguna.data.id}`;
    chk("sin horas: las dos quedan NULL", c.starts_at === null && c.end_at === null, JSON.stringify(c));
  }

  console.log("\n=== 4. LO QUE SE RECHAZA ===");
  {
    const invertida = await crear({ startTime: "23:00", endTime: "22:00" }, "ZZ Hora Mala");
    chk("cierre antes del inicio -> 400", invertida.status === 400, JSON.stringify(invertida));
    chk(
      "y el mensaje explica la madrugada",
      /madrugada/i.test(JSON.stringify(invertida.data)),
      JSON.stringify(invertida.data)
    );
    for (const h of ["25:00", "abc", "23:99"]) {
      const r = await crear({ startTime: h }, `ZZ Hora ${h}`);
      chk(`'${h}' se rechaza`, r.status === 400, JSON.stringify(r));
    }
  }

  console.log("\n=== 5. EDITAR NO BORRA LO QUE NO SE MANDA ===");
  {
    const r = await crear({ startTime: "23:30", endTime: "05:00", doorPriceCop: "40.000" }, "ZZ Hora Edit");
    const id = r.data.id;
    chk("se crea con hora y precio", r.status === 201, JSON.stringify(r));

    const soloTitulo = await req("d", "PATCH", `/api/events/${id}`, { title: "ZZ Hora Edit 2" });
    chk("editar solo el título -> 200", soloTitulo.status === 200, JSON.stringify(soloTitulo));
    const [e] = await sql`
      SELECT title, door_price_cop,
             to_char(starts_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS ini,
             to_char(end_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS fin
      FROM events WHERE id = ${id}`;
    chk("el título cambió", e.title === "ZZ Hora Edit 2", `es ${e.title}`);
    chk("starts_at SOBREVIVE", e.ini === "23:30", `es ${e.ini}`);
    chk("end_at SOBREVIVE", e.fin === "05:00", `es ${e.fin}`);
    chk("door_price_cop SOBREVIVE", e.door_price_cop === 40000, `es ${e.door_price_cop}`);

    /** Y CORREGIR LA FECHA muda las horas con ella. */
    const otraFecha = await req("d", "PATCH", `/api/events/${id}`, { date: "2027-05-22" });
    chk("corregir la fecha -> 200", otraFecha.status === 200, JSON.stringify(otraFecha));
    const [f] = await sql`
      SELECT (starts_at AT TIME ZONE 'America/Bogota')::date::text AS dia_ini,
             (end_at AT TIME ZONE 'America/Bogota')::date::text AS dia_fin,
             to_char(starts_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS ini
      FROM events WHERE id = ${id}`;
    chk(
      "el inicio se mudó al día nuevo, conservando la hora",
      f.dia_ini === "2027-05-22" && f.ini === "23:30",
      JSON.stringify(f)
    );
    chk(
      "y el cierre de madrugada se mudó al 23",
      f.dia_fin === "2027-05-23",
      `${f.dia_fin} — si quedó en mayo 16, el timestamp viejo no se re-armó`
    );

    /** Vaciarla a propósito SÍ se puede. */
    const vacia = await req("d", "PATCH", `/api/events/${id}`, { startTime: "", endTime: "" });
    chk("mandarlas vacías las borra", vacia.status === 200, JSON.stringify(vacia));
    const [h] = await sql`SELECT starts_at, end_at FROM events WHERE id = ${id}`;
    chk("quedaron NULL", h.starts_at === null && h.end_at === null, JSON.stringify(h));
  }

  console.log("\n=== 6. LA AGENDA ORDENA POR HORA DENTRO DEL DÍA ===");
  {
    /** Tres del mismo día: 22:00, 20:00 y sin hora. Esperado: 20, 22, sin hora. */
    await sql`DELETE FROM events WHERE title LIKE 'ZZ Ord %'`;
    for (const [t, hora] of [["ZZ Ord B", "22:00"], ["ZZ Ord A", "20:00"], ["ZZ Ord C", null]]) {
      await crear(hora ? { startTime: hora } : {}, t);
    }
    const filas = await sql`
      SELECT title FROM events
      WHERE title LIKE 'ZZ Ord %' AND event_date = ${DIA}
      ORDER BY event_date ASC, starts_at ASC NULLS LAST`;
    const orden = filas.map((f) => f.title);
    chk(
      "20:00, 22:00 y la sin hora al final",
      JSON.stringify(orden) === JSON.stringify(["ZZ Ord A", "ZZ Ord B", "ZZ Ord C"]),
      JSON.stringify(orden)
    );
  }

  console.log("\n=== 7. SE VE EN /eventos ===");
  {
    const html = await (await fetch(`${BASE}/eventos`)).text();
    const i = html.indexOf(">ZZ Hora Ambas<");
    const tarjeta = i < 0 ? "" : html.slice(i, html.indexOf("</article>", i));
    chk("la fiesta con las dos horas aparece", i >= 0, "no aparece");
    chk("muestra la hora de inicio", /23:00/.test(tarjeta), tarjeta.slice(0, 160));
    chk("y la duración", /7 h/.test(tarjeta), tarjeta.slice(0, 200));
  }
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
