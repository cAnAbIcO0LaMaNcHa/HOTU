/**
 * El ban corta la sesión ACTIVA, no solo los ingresos nuevos.
 *
 * Arranca restaurando el seed, como la batería del traspaso: una corrida
 * que se cae a mitad deja cuentas baneadas y eso envenena todo lo demás.
 */
import { neon } from "@neondatabase/serverless";
import { estadoSeed, restaurarSeed } from "./seed.mjs";
const sql = neon(process.env.DATABASE_URL);
const BASE = "http://localhost:3000";

const MOD = "aplicante@test.hotu.local";
const VICTIMA = "artista@test.hotu.local";
const COMPRADOR = "usuario@test.hotu.local";

// El restore vive en seed.mjs, compartido: banear pone owner_email en
// NULL y levantar el ban NO lo devuelve —a propósito—, así que probar un
// ban le quitaba reisen y bodega-prueba a duena@ de forma permanente.
const restaurar = () => restaurarSeed(sql);

await restaurar();

const J = new Map();
const g = (q, r) => {
  const j = J.get(q) ?? new Map();
  for (const x of r.headers.getSetCookie?.() ?? []) {
    const [pp] = x.split(";"); const i = pp.indexOf("=");
    const k = pp.slice(0, i).trim(), v = pp.slice(i + 1).trim();
    if (v === "") j.delete(k); else j.set(k, v);
  }
  J.set(q, j);
};
const ck = (q) => [...(J.get(q) ?? new Map())].map(([k, v]) => `${k}=${v}`).join("; ");
async function login(q, email) {
  J.set(q, new Map());
  const r1 = await fetch(`${BASE}/api/auth/csrf`); g(q, r1);
  const { csrfToken } = await r1.json();
  g(q, await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: ck(q) },
    body: new URLSearchParams({ csrfToken, email, password: "test1234", redirect: "false", json: "true" }),
    redirect: "manual",
  }));
  return await sesion(q);
}
const sesion = async (q) =>
  (await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: ck(q) } })).json())?.user?.email ?? null;
const req = async (q, m, r, b) => {
  const res = await fetch(`${BASE}${r}`, {
    method: m, headers: { "Content-Type": "application/json", cookie: ck(q) },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
/**
 * El texto que de verdad LEE una persona: sin etiquetas, sin scripts y sin
 * comentarios. React parte los nodos de texto, y Next en desarrollo mete
 * los logs del server en el payload del cliente, así que un grep sobre el
 * HTML crudo miente en las dos direcciones.
 */
const texto = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

let ok = 0, mal = 0;
const chk = (n, c, d = "") => { if (c) { ok++; console.log("   OK   " + n); } else { mal++; console.log("   MAL  " + n + " -> " + d); } };

await sql`INSERT INTO user_roles (email,role,country_code) VALUES (${MOD},'MODERATOR','COL') ON CONFLICT DO NOTHING`;
await login("mod", MOD);
const banear = (email, motivo) =>
  req("mod", "PATCH", "/api/admin/moderation/accounts", { email, accion: "banear", motivo });
const levantar = (email) =>
  req("mod", "PATCH", "/api/admin/moderation/accounts", { email, accion: "levantar" });

console.log("=== LA SESIÓN ABIERTA SE CORTA, NO SOLO EL INGRESO ===");
{
  const entro = await login("victima", VICTIMA);
  chk("la cuenta entra normalmente", entro === VICTIMA, String(entro));

  // Con la sesión YA abierta, se la banea desde otra cuenta.
  const b = await banear(VICTIMA, "Prueba de que la sesión abierta se corta.");
  chk("banear -> 200", b.status === 200, JSON.stringify(b));

  // La misma cookie, sin volver a entrar.
  chk("SU SESIÓN YA NO EXISTE", (await sesion("victima")) === null, String(await sesion("victima")));

  const perfil = await req("victima", "GET", "/api/collectives/reisen/owner");
  chk("y una ruta con sesión la rechaza -> 401", perfil.status === 401, JSON.stringify(perfil));

  chk("tampoco puede volver a entrar", (await login("victima", VICTIMA)) === null);
}

console.log("=== Y AL LEVANTARLO, VUELVE ===");
{
  const l = await levantar(VICTIMA);
  chk("levantar -> 200", l.status === 200, JSON.stringify(l));
  chk("puede entrar de nuevo", (await login("victima", VICTIMA)) === VICTIMA);
}

console.log("=== NO PUEDE PUBLICAR, CON LA SESIÓN ABIERTA ===");
{
  const [col] = await sql`SELECT slug FROM collectives WHERE lower(owner_email) = 'duena@test.hotu.local' AND entity_kind='collective' LIMIT 1`;
  await login("duena", "duena@test.hotu.local");
  const antes = await req("duena", "POST", "/api/events", {
    organizerSlug: col.slug, title: "ZB-antes del ban", date: "2026-12-01", venue: "X", city: "Bogotá",
  });
  chk("antes del ban publica -> 201", antes.status === 201, JSON.stringify(antes).slice(0, 120));
  if (antes.data?.id) await sql`DELETE FROM events WHERE id = ${antes.data.id}`;

  await banear("duena@test.hotu.local", "Prueba de que no puede publicar baneada.");
  const desp = await req("duena", "POST", "/api/events", {
    organizerSlug: col.slug, title: "ZB-durante el ban", date: "2026-12-01", venue: "X", city: "Bogotá",
  });
  chk("baneada NO publica -> 401", desp.status === 401, JSON.stringify(desp));
  const [n] = await sql`SELECT count(*)::int n FROM events WHERE title = 'ZB-durante el ban'`;
  chk("y no quedó el evento", n.n === 0, String(n.n));
  await levantar("duena@test.hotu.local");
}

console.log("=== NO PUEDE COMPRAR, CON LA SESIÓN ABIERTA ===");
{
  await login("comprador", COMPRADOR);
  chk("antes del ban tiene sesión", (await sesion("comprador")) === COMPRADOR);
  await banear(COMPRADOR, "Prueba de que no puede comprar baneado.");
  chk("baneado no tiene sesión", (await sesion("comprador")) === null);
  /**
   * La compra va por un Server Action, que exige sesión: sin sesión no
   * hay compra. Se comprueba por lo que la página MUESTRA.
   *
   * Y se lee el TEXTO VISIBLE, no el HTML crudo. La primera versión
   * hacía grep sobre el HTML y fallaba: el email aparecía una vez,
   * dentro del console.warn del propio ban, porque Next en desarrollo
   * reenvía los logs del server al payload del cliente. El producto
   * estaba bien y el chequeo mentía — la misma familia que los nodos de
   * texto partidos.
   */
  const html = await (await fetch(`${BASE}/perfil?panel=mi-perfil`, { headers: { cookie: ck("comprador") } })).text();
  const t = texto(html);
  chk("la página no lo reconoce", !t.includes(COMPRADOR), t.slice(0, 120));
  chk("y le ofrece iniciar sesión", /Inicia sesi/i.test(t), t.slice(0, 120));
  await levantar(COMPRADOR);
  chk("al levantarlo vuelve a tener sesión", (await login("comprador", COMPRADOR)) === COMPRADOR);
}

console.log("=== UN NO-MODERADOR NO PUEDE BANEAR NI DESBANEAR ===");
{
  await login("nadie", COMPRADOR);
  const b = await req("nadie", "PATCH", "/api/admin/moderation/accounts", {
    email: VICTIMA, accion: "banear", motivo: "un motivo bien largo",
  });
  chk("banear sin ser moderador -> 403", b.status === 403, JSON.stringify(b));
  const anon = (await fetch(`${BASE}/api/admin/moderation/accounts`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: VICTIMA, accion: "banear", motivo: "un motivo bien largo" }),
  })).status;
  chk("sin sesión -> 401", anon === 401, String(anon));
  const [x] = await sql`SELECT banned_at FROM user_profiles WHERE email = ${VICTIMA}`;
  chk("y no quedó baneada", x.banned_at === null, String(x.banned_at));
}

await restaurar();
console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
console.log("limpieza y seed:", JSON.stringify(await estadoSeed(sql)));
