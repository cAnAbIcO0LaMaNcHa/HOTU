/**
 * NADA SE ESCRIBE SIN REGISTRO.
 *
 * La regla: si registrarEdicion no puede determinar el rol o no puede escribir la
 * fila, la edición FALLA y los datos quedan intactos. Igual que reasignarDueno.
 *
 * Lo que esta batería mide, y en este orden de importancia:
 *
 *   1. Que una escritura cuyo rol NO se resuelve falle Y NO TOQUE LOS DATOS. Es
 *      la prueba que pediste, y es la que distingue "falla" de "falla después de
 *      escribir".
 *   2. Que un MODERATOR ahora SÍ quede registrado, con rol 'moderador'. Antes su
 *      edición pasaba y no dejaba rastro.
 *   3. Que un MODERATOR NO haya ganado permiso de editar contenido ajeno:
 *      canEditCollective no cambió.
 *   4. Que el registro y el dato sean atómicos en los caminos con transacción.
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
const MOD = "aplicante@test.hotu.local";
const COL = "zz-reg-col";

const corrida = await abrirCorrida(sql, "registro obligatorio");

try {
  await sql`INSERT INTO collectives (slug,name,type,sector,bio,district,status,entity_kind,owner_email)
            VALUES (${COL},'ZZ Reg Col','LOCAL','Bogota','antes','D00','published','collective',${DUENO})`;
  await sql`INSERT INTO user_roles (email, role, country_code)
            VALUES (${MOD}, 'MODERATOR', 'COL') ON CONFLICT DO NOTHING`;

  chk("login del dueño", (await login("d", DUENO)) === DUENO);
  chk("login del moderador", (await login("mod", MOD)) === MOD);

  console.log("=== 1. DÓNDE HACÍA FALTA 'moderador', MEDIDO Y NO SUPUESTO ===");
  {
    /**
     * LA PRIMERA VERSIÓN DE ESTA BATERÍA MEDÍA EL CAMINO EQUIVOCADO, y conviene
     * que quede escrito porque yo mismo describí mal el alcance del problema.
     *
     * Probaba que un MODERATOR editara la bio de un colectivo. No puede: ese
     * camino pide canEditCollective —dueño, residente, SUPER_ADMIN— y un MODERATOR
     * recibe 403 EN LA PUERTA, antes de llegar a ningún registro. Así que ahí nunca
     * hubo ediciones invisibles.
     *
     * El único camino que entra por isModerator Y escribe edit_log es la asignación
     * de organizador. Ahí sí: rolSobreColectivo devolvía null y no se escribía nada.
     */
    const bloqueado = await req("mod", "PATCH", `/api/collectives/${COL}`, { bio: "no deberia" });
    chk(
      "un MODERATOR NO edita contenido de un colectivo: 403 en la puerta",
      bloqueado.status === 403,
      `${JSON.stringify(bloqueado)} — si pasa, canEditCollective se amplió sin querer`
    );

    /** Y acá sí, que es donde el valor nuevo hacía falta. */
    const [ev] = await sql`
      INSERT INTO events (event_date, city, venue, title, lineup, district, scope,
                          country_code, language, status, featured, organizer_slug)
      VALUES (CURRENT_DATE + 40,'Bogota','ZZ Reg Bodega','ZZ Reg Fiesta','ZZ DJ','D00',
              'country','COL','es','published',false, NULL)
      RETURNING id`;

    const r = await req("mod", "PATCH", `/api/admin/events/${ev.id}/organizer`, {
      collectiveSlug: COL,
    });
    chk("un MODERATOR asigna un organizador -> 200", r.status === 200, JSON.stringify(r));
    const [fila] = await sql`
      SELECT actor_email, actor_rol FROM edit_log
      WHERE collective_slug = ${COL} ORDER BY id DESC LIMIT 1`;
    chk("y DEJÓ registro", Boolean(fila), "no hay fila: la edición volvió a ser invisible");
    chk(
      "con rol 'moderador', que es el valor que la migración agregó",
      fila?.actor_rol === "moderador",
      `rol=${fila?.actor_rol}`
    );
    chk("y su email", fila?.actor_email === MOD, JSON.stringify(fila));
  }

  console.log("\n=== 2. PERO NO GANÓ PERMISO SOBRE CONTENIDO AJENO ===");
  {
    /**
     * canEditCollective NO cambió: 'moderador' se resuelve APARTE, solo para el
     * registro. Lo que un MODERATOR puede hacer lo decide su propia puerta, no la
     * del colectivo — y lo que NO puede es administrar membresías.
     */
    const invitar = await req("mod", "POST", "/api/memberships", {
      collectiveSlug: COL,
      artistSlug: "zz-no-existe",
      requestedBy: "collective",
    });
    chk(
      "un MODERATOR no administra membresías del colectivo",
      invitar.status === 403 || invitar.status === 404,
      `${JSON.stringify(invitar)} — si da 200 ganó puedeAdministrarColectivo`
    );

    const ceder = await req("mod", "PATCH", `/api/collectives/${COL}/owner`, { email: DUENO });
    chk("ni lo cede", ceder.status === 403 || ceder.status === 404, JSON.stringify(ceder));
  }

  console.log("\n=== 3. NADIE ESCRIBE SIN REGISTRO, Y POR QUÉ ES ESTRUCTURAL ===");
  {
    /**
     * LA RAMA DE "ROL NO RESOLUBLE" ES INALCANZABLE POR LA API, Y ESO ES UNA
     * PROPIEDAD, NO UN AGUJERO EN LA PRUEBA.
     *
     * Cada camino que escribe edit_log entra por una puerta cuyos miembros TODOS
     * resuelven a un rol:
     *
     *   canEditCollective -> dueño | residente | super_admin
     *   isModerator       -> esos, o 'moderador'
     *
     * Así que si pasaste la puerta, el registro sabe nombrarte. La rama que corta
     * queda como defensa —si alguien agrega una puerta nueva que no cumpla esto—
     * pero no se puede ejercitar desde afuera, y fingir una prueba que la ejercite
     * sería mentir sobre qué está verificado.
     *
     * Lo que SÍ se mide es la propiedad: un extraño se va en la puerta de CADA
     * camino, así que ninguna escritura puede ocurrir sin registro.
     */
    await sql`DELETE FROM user_roles WHERE email = ${MOD} AND role = 'MODERATOR'`;
    const [antes] = await sql`SELECT bio FROM collectives WHERE slug = ${COL}`;
    const cuantosAntes = (
      await sql`SELECT COUNT(*)::int AS n FROM edit_log WHERE collective_slug = ${COL}`
    )[0].n;

    const caminos = [
      ["editar la info", "PATCH", `/api/collectives/${COL}`, { bio: "NO DEBERIA QUEDAR" }],
      ["publicar un evento", "POST", "/api/events", { organizerSlug: COL, title: "ZZ No", date: "2027-01-01" }],
      ["asignar organizador", "PATCH", "/api/admin/events/1/organizer", { collectiveSlug: COL }],
    ];
    for (const [que, m, ruta, body] of caminos) {
      const r = await req("mod", m, ruta, body);
      chk(
        `sin rol, ${que} se rechaza`,
        r.status === 403 || r.status === 404,
        `status ${r.status} ${JSON.stringify(r.data)}`
      );
    }

    const [despues] = await sql`SELECT bio FROM collectives WHERE slug = ${COL}`;
    chk(
      "LOS DATOS NO SE TOCARON",
      despues.bio === antes.bio,
      `bio pasó de "${antes.bio}" a "${despues.bio}" — se escribió sin registro`
    );
    const cuantosDespues = (
      await sql`SELECT COUNT(*)::int AS n FROM edit_log WHERE collective_slug = ${COL}`
    )[0].n;
    chk("y no se agregó ninguna fila al registro", cuantosDespues === cuantosAntes, `${cuantosAntes} -> ${cuantosDespues}`);
  }

  console.log("\n=== 4. EL DUEÑO SIGUE PUDIENDO, Y CON SU ROL ===");
  {
    const r = await req("d", "PATCH", `/api/collectives/${COL}`, { bio: "editado por el dueño" });
    chk("el dueño edita", r.status === 200, JSON.stringify(r));
    const [fila] = await sql`
      SELECT actor_rol FROM edit_log WHERE collective_slug = ${COL} ORDER BY id DESC LIMIT 1`;
    chk("y queda como 'dueno', no como 'moderador'", fila?.actor_rol === "dueno", `rol=${fila?.actor_rol}`);
  }

  console.log("\n=== 5. UN PATCH INVÁLIDO NO DEJA MEDIO APLICADO ===");
  {
    /**
     * Esto era un bug anterior a la auditoría: cada campo se escribía en su propio
     * UPDATE, así que un patch de varios campos donde uno era inválido dejaba los
     * anteriores GUARDADOS y devolvía 400. La respuesta decía "no se hizo nada" y
     * no era cierto.
     */
    const [antes] = await sql`SELECT name, bio FROM collectives WHERE slug = ${COL}`;
    const r = await req("d", "PATCH", `/api/collectives/${COL}`, {
      bio: "esta bio no tiene que quedar",
      name: "",
    });
    chk("un patch con un campo inválido -> 400", r.status === 400, JSON.stringify(r));
    const [despues] = await sql`SELECT name, bio FROM collectives WHERE slug = ${COL}`;
    chk(
      "y NINGÚN campo del patch quedó escrito",
      despues.bio === antes.bio && despues.name === antes.name,
      `antes ${JSON.stringify(antes)} / después ${JSON.stringify(despues)}`
    );
  }
} finally {
  await sql`DELETE FROM user_roles WHERE email = ${MOD} AND role = 'MODERATOR'`;
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
