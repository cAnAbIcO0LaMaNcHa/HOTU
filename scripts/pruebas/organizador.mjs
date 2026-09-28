/**
 * ASIGNAR ORGANIZADOR DESDE EL ADMIN.
 *
 * Lo que más importa acá no es que funcione: es QUIÉN puede. Asignarse un evento
 * es quedarse con su convocatoria y con el derecho a editarlo, así que un dueño
 * de colectivo pidiéndolo para sí mismo tiene que recibir un 403 — es el mismo
 * agujero que la fase 2 cerró con las residencias.
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

const MOD = "aplicante@test.hotu.local"; // con rol SUPER_ADMIN, ver abajo
const DUENO = "duena@test.hotu.local";
const COL = "zz-org-col";
const COL2 = "zz-org-col2";
const VENUE = "zz-org-venue";
const CENSURADO = "zz-org-censurado";

const corrida = await abrirCorrida(sql, "asignar organizador");
const futura = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10);

try {
  /**
   * censored_at NO VA SOLO: collectives_censura_con_motivo_check exige un
   * censor_reason no vacío. La primera versión de este fixture lo omitió y la
   * batería murió en el montaje — la guarda del producto funcionando contra mi
   * propia prueba, que es la mejor forma de encontrarla.
   */
  const col = (slug, nombre, kind, censurado) => sql`
    INSERT INTO collectives (slug,name,type,sector,bio,district,status,entity_kind,owner_email,
                             censored_at, censored_by, censor_reason)
    VALUES (${slug}, ${nombre}, 'LOCAL','Bogota','','D00','published', ${kind}, ${DUENO},
            ${censurado ? new Date().toISOString() : null},
            ${censurado ? MOD : null},
            ${censurado ? "Bajado a propósito por la batería de organizador." : null})`;
  await col(COL, "ZZ Org Uno", "collective", false);
  await col(COL2, "ZZ Org Dos", "collective", false);
  await col(VENUE, "ZZ Org Bodega", "venue", false);
  await col(CENSURADO, "ZZ Org Bajado", "collective", true);

  /** Un evento HUÉRFANO, que es el caso que esta pieza existe para resolver. */
  const [ev] = await sql`
    INSERT INTO events (event_date, city, venue, title, lineup, district, scope,
                        country_code, language, status, featured, organizer_slug)
    VALUES (${futura},'Bogota','ZZ Bodega','ZZ Org Fiesta','ZZ DJ Uno, ZZ DJ Dos','D00',
            'country','COL','es','published',false, NULL)
    RETURNING id`;

  await sql`INSERT INTO user_roles (email, role, country_code)
            VALUES (${MOD}, 'SUPER_ADMIN', 'COL') ON CONFLICT DO NOTHING`;

  chk("login del moderador", (await login("mod", MOD)) === MOD);
  chk("login del dueño de colectivo", (await login("d", DUENO)) === DUENO);

  console.log("=== 1. LA PUERTA: no es un permiso de colectivo, es moderación ===");
  {
    const sinSesion = await req(null, "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: COL,
    });
    // 401 y no 403: "no sé quién sos" es distinto de "sé quién sos y no podés".
    chk("sin sesión -> 401", sinSesion.status === 401, JSON.stringify(sinSesion));

    /**
     * EL CASO QUE IMPORTA: el dueño de COL pidiendo el evento PARA COL. Tiene
     * permiso total sobre ese colectivo y eso NO alcanza — asignarse un evento es
     * quedarse con su convocatoria.
     */
    const autoasignar = await req("d", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: COL,
    });
    chk(
      "el dueño de un colectivo NO puede asignarse el evento -> 403",
      autoasignar.status === 403,
      JSON.stringify(autoasignar)
    );
    const [sigue] = await sql`SELECT organizer_slug FROM events WHERE id = ${ev.id}`;
    chk("y el evento sigue sin organizador", sigue.organizer_slug === null, `es ${sigue.organizer_slug}`);
  }

  console.log("\n=== 2. EL MODERADOR SÍ, Y QUEDA REGISTRADO ===");
  {
    const r = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: COL,
    });
    chk("el moderador asigna -> 200", r.status === 200, JSON.stringify(r));
    chk("y dice qué había antes", r.data.antes === null, JSON.stringify(r.data));
    const [e] = await sql`SELECT organizer_slug FROM events WHERE id = ${ev.id}`;
    chk("quedó asignado", e.organizer_slug === COL, `es ${e.organizer_slug}`);

    const filas = await sql`
      SELECT actor_email, actor_rol, entidad, accion, detalle
      FROM edit_log WHERE collective_slug = ${COL} AND entidad_id = ${String(ev.id)} ORDER BY id DESC`;
    chk("dejó fila en edit_log", filas.length >= 1, JSON.stringify(filas));
    chk("con el email del moderador", filas[0]?.actor_email === MOD, JSON.stringify(filas[0]));
    chk(
      "y con rol 'super_admin' (entró por moderación, no por el colectivo)",
      filas[0]?.actor_rol === "super_admin",
      `rol=${filas[0]?.actor_rol}`
    );
    chk(
      "dice qué campo cambió",
      (filas[0]?.detalle?.campos ?? []).includes("organizer_slug"),
      JSON.stringify(filas[0]?.detalle)
    );
  }

  console.log("\n=== 3. REASIGNAR REGISTRA CONTRA LOS DOS ===");
  {
    const r = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: COL2,
    });
    chk("se puede reasignar -> 200", r.status === 200, JSON.stringify(r));
    chk("y dice de quién era", r.data.antes === COL, JSON.stringify(r.data));

    const perdio = await sql`
      SELECT accion FROM edit_log
      WHERE collective_slug = ${COL} AND entidad_id = ${String(ev.id)} ORDER BY id DESC LIMIT 1`;
    chk(
      "al que lo PIERDE también le queda registro",
      perdio[0]?.accion === "borrar",
      `accion=${perdio[0]?.accion} — sin esto el colectivo despojado no sabe por qué le bajó la convocatoria`
    );
    const gano = await sql`
      SELECT accion FROM edit_log
      WHERE collective_slug = ${COL2} AND entidad_id = ${String(ev.id)} ORDER BY id DESC LIMIT 1`;
    chk("y al que lo gana", gano[0]?.accion === "editar", `accion=${gano[0]?.accion}`);
  }

  console.log("\n=== 4. UN VENUE SÍ PUEDE ORGANIZAR (distinto del lineup) ===");
  {
    const r = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: VENUE,
    });
    chk("un venue puede quedar de organizador -> 200", r.status === 200, JSON.stringify(r));
    const [e] = await sql`SELECT organizer_slug FROM events WHERE id = ${ev.id}`;
    chk("quedó el venue", e.organizer_slug === VENUE, `es ${e.organizer_slug}`);
  }

  console.log("\n=== 5. LO QUE SE RECHAZA ===");
  {
    const censurado = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: CENSURADO,
    });
    chk(
      "un perfil CENSURADO se rechaza -> 409",
      censurado.status === 409,
      `${JSON.stringify(censurado)} — asignarle un evento lo publicaría de vuelta por el costado`
    );

    const inexistente = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: "zz-no-existe",
    });
    chk("un colectivo inexistente -> 404", inexistente.status === 404, JSON.stringify(inexistente));

    /** AUSENTE y null NO son lo mismo: null es una orden, ausente es un body roto. */
    const ausente = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {});
    chk("body sin collectiveSlug -> 400 y NO desampara", ausente.status === 400, JSON.stringify(ausente));
    const vacia = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: "",
    });
    chk("cadena vacía -> 400", vacia.status === 400, JSON.stringify(vacia));

    const [sigue] = await sql`SELECT organizer_slug FROM events WHERE id = ${ev.id}`;
    chk("y ninguno de los rechazos lo cambió", sigue.organizer_slug === VENUE, `es ${sigue.organizer_slug}`);

    const inexistenteEvento = await req("mod", "PATCH", "/api/admin/events/999999/organizer", {
      collectiveSlug: COL,
    });
    chk("un evento inexistente -> 404", inexistenteEvento.status === 404, JSON.stringify(inexistenteEvento));
  }

  console.log("\n=== 6. SE PUEDE DESAMPARAR, Y ESO TIENE QUE PODERSE ===");
  {
    const r = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: null,
    });
    chk("null le saca el organizador -> 200", r.status === 200, JSON.stringify(r));
    const [e] = await sql`SELECT organizer_slug, status FROM events WHERE id = ${ev.id}`;
    chk("quedó sin organizador", e.organizer_slug === null, `es ${e.organizer_slug}`);
    chk(
      "y el evento SIGUE publicado: desamparar no es bajar",
      e.status === "published",
      `status=${e.status} — hay gente que podría tener boletas`
    );
  }

  console.log("\n=== 7. LA COLA Y LA PÁGINA ===");
  {
    const html = await (await fetch(`${BASE}/admin/organizadores`, {
      headers: { cookie: ck("mod") },
    })).text();
    chk("la página carga para el moderador", html.length > 500, `${html.length} bytes`);
    chk("y lista el evento huérfano", html.includes("ZZ Org Fiesta"), "no aparece");
    chk("muestra su lineup para poder decidir", html.includes("ZZ DJ Uno"), "no muestra el lineup");
    chk(
      "ofrece el venue como opción",
      html.includes("ZZ Org Bodega"),
      "no ofrece venues y sí puede organizar"
    );
    chk(
      "y NO ofrece el censurado",
      !html.includes("ZZ Org Bajado"),
      "ofrece un perfil bajado: el moderador lo va a elegir y comerse un 409"
    );

    /**
     * redirect: "manual" ES OBLIGATORIO ACÁ. Con el default —"follow"— fetch
     * sigue el 307 del layout hasta la pantalla de login y devuelve 200, y el
     * chequeo reporta que un dueño de colectivo ENTRA al admin. La primera
     * versión de esta batería dijo exactamente eso, y por un momento parecía un
     * agujero de seguridad. Es la misma familia de siempre: no falla, contesta
     * mal — y acá contestaba mal en la dirección que asusta.
     */
    const conDueno = await fetch(`${BASE}/admin/organizadores`, {
      headers: { cookie: ck("d") },
      redirect: "manual",
    });
    chk(
      "un dueño de colectivo NO entra a la página",
      conDueno.status >= 300 && conDueno.status < 400,
      `status ${conDueno.status} (con redirect manual; un 200 acá sí sería un agujero)`
    );
  }
} finally {
  await sql`DELETE FROM user_roles WHERE email = ${MOD} AND role = 'SUPER_ADMIN'`;
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
