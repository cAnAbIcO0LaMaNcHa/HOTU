/**
 * ELIMINAR UNA CUENTA DESDE MODERACIÓN: lo que borra y lo que NO puede borrar.
 *
 * Lo central de esta batería no es que el borrado funcione. Es que este
 * camino —el normal, el que tiene cualquier moderador— NO PUEDA tocar
 * pedidos ni boletas por ninguna vía, ni siquiera mandando a mano el
 * parámetro que la limpieza pre-lanzamiento sí usa.
 */
import { neon } from "@neondatabase/serverless";
import { abrirCorrida } from "./seed.mjs";

const sql = neon(process.env.DATABASE_URL);
const BASE = "http://localhost:3000";

let ok = 0, mal = 0;
const chk = (n, c, d = "") => {
  if (c) { ok++; console.log("   OK   " + n); }
  else { mal++; console.log("   MAL  " + n + (d ? " -> " + d : "")); }
};

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
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: ck(q) },
    body: new URLSearchParams({ csrfToken, email, password: "test1234", redirect: "false", json: "true" }),
    redirect: "manual",
  }));
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
/**
 * El texto que de verdad LEE una persona. React parte los nodos de texto
 * y Next en dev mete los logs del server en el payload del cliente, así
 * que un grep sobre el HTML crudo miente en las dos direcciones.
 */
const texto = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const MOD = "aplicante@test.hotu.local";
const MOTIVO = "Cuenta creada por error durante las pruebas";
const RUTA = "/api/admin/moderation/accounts";

const LIMPIA = "zz-borrable@test.hotu.local";   // sin comercio: se puede
const CONPLATA = "zz-conplata@test.hotu.local"; // con boleta: NO se puede
const ART = "zz-borrable-dj";
const COL = "zz-borrable-col";

const corrida = await abrirCorrida(sql, "eliminar.mjs");
await sql`INSERT INTO user_roles (email,role,country_code) VALUES (${MOD},'MODERATOR','COL') ON CONFLICT DO NOTHING`;
chk("el moderador entra", (await login("mod", MOD)) === MOD);

async function limpiarFixture() {
  for (const c of [LIMPIA, CONPLATA]) {
    await sql`DELETE FROM ticket_attributions WHERE ticket_id IN (SELECT id FROM tickets WHERE user_email = ${c})`;
    await sql`DELETE FROM tickets WHERE user_email = ${c}`;
    await sql`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_email = ${c})`;
    await sql`DELETE FROM orders WHERE user_email = ${c}`;
    await sql`DELETE FROM account_removals WHERE email = ${c}`;
  }
  await sql`DELETE FROM dj_sets WHERE artist_slug = ${ART}`;
  await sql`DELETE FROM tracks WHERE artist_slug = ${ART}`;
  await sql`DELETE FROM artists WHERE slug = ${ART}`;
  await sql`DELETE FROM collectives WHERE slug = ${COL}`;
  await sql`DELETE FROM user_profiles WHERE email IN (${LIMPIA}, ${CONPLATA})`;
}

async function montar() {
  await limpiarFixture();
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider) VALUES (${LIMPIA},'ZZ Borrable','credentials')`;
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider) VALUES (${CONPLATA},'ZZ Con Plata','credentials')`;
  await sql`INSERT INTO artists (slug, name, genre, city, bio, joined_at, district, owner_email)
            VALUES (${ART},'ZZ Borrable DJ','techno','Bogota','fixture','2026-01-01','06',${LIMPIA})`;
  await sql`INSERT INTO collectives (slug, name, type, sector, bio, owner_email)
            VALUES (${COL},'ZZ Borrable Col','colectivo','centro','fixture',${LIMPIA})`;
  await sql`INSERT INTO dj_sets (slug, title, artist_name, district, duration, recorded_at, artist_slug)
            VALUES (${ART + "-set"},'ZZ Set','ZZ Borrable DJ','06','60:00','2026-01-01',${ART})`;
  await sql`INSERT INTO artist_likes (artist_slug, user_email) VALUES ('test-camila', ${LIMPIA})`;

  const [ev] = await sql`SELECT id FROM events ORDER BY id LIMIT 1`;
  const [o] = await sql`INSERT INTO orders (user_email, kind, status, amount_cop)
                        VALUES (${CONPLATA},'tickets','paid',90000) RETURNING id`;
  const [oi] = await sql`INSERT INTO order_items (order_id, event_id, item_type, name, ticket_tier, unit_price_cop, quantity)
                         VALUES (${o.id}, ${ev.id},'ticket','ZZ Boleta','general',90000,1) RETURNING id`;
  await sql`INSERT INTO tickets (ticket_code, order_id, order_item_id, user_email, event_id, tier, status)
            VALUES (${"ZZE-" + Date.now()}, ${o.id}, ${oi.id}, ${CONPLATA}, ${ev.id},'general','valid')`;
}

await montar();

console.log("\n=== LA VISTA PREVIA ===");
{
  const anon = await req(null, "GET", `${RUTA}?email=${encodeURIComponent(LIMPIA)}`);
  chk("sin sesión -> 401", anon.status === 401, String(anon.status));

  const r = await req("mod", "GET", `${RUTA}?email=${encodeURIComponent(LIMPIA)}`);
  chk("el moderador la ve", r.status === 200, String(r.status));
  chk("dice 0 pedidos", r.data?.pedidos === 0, JSON.stringify(r.data?.pedidos));
  chk("lista el artista", (r.data?.artistas ?? []).some((a) => a.slug === ART));
  chk("lista el colectivo", (r.data?.colectivos ?? []).some((c) => c.slug === COL));

  const conplata = await req("mod", "GET", `${RUTA}?email=${encodeURIComponent(CONPLATA)}`);
  chk("la de la boleta avisa ANTES de confirmar",
    conplata.data?.pedidos === 1 && conplata.data?.boletas === 1, JSON.stringify(conplata.data));

  const no = await req("mod", "GET", `${RUTA}?email=zz-no-existe@test.hotu.local`);
  chk("una cuenta inexistente -> 404", no.status === 404, String(no.status));
}

console.log("\n=== LO QUE ESTE CAMINO NO PUEDE HACER ===");
{
  const plata = await req("mod", "DELETE", RUTA, {
    email: CONPLATA, motivo: MOTIVO, destinoPerfiles: "desamparar",
  });
  chk("una cuenta con boletas -> 409", plata.status === 409, String(plata.status));
  chk("y el mensaje dice que hay que BANEARLA",
    String(plata.data?.error ?? "").includes("BANEARLA"), String(plata.data?.error));
  chk("la cuenta sigue viva",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${CONPLATA}`)[0].n === 1);
  chk("y su boleta también",
    (await sql`SELECT count(*)::int n FROM tickets WHERE user_email=${CONPLATA}`)[0].n === 1);

  /**
   * LA PRUEBA CENTRAL: mandar a mano el parámetro de la limpieza.
   *
   * Si la ruta leyera borrarComercio del body, esto borraría una boleta
   * desde el panel de cualquier moderador. Tiene que dar exactamente el
   * mismo 409 que arriba.
   */
  const colado = await req("mod", "DELETE", RUTA, {
    email: CONPLATA, motivo: MOTIVO, destinoPerfiles: "desamparar",
    borrarComercio: true, modo: "limpieza", mode: "limpieza",
  });
  chk("mandando borrarComercio:true a mano -> SIGUE 409", colado.status === 409, String(colado.status));
  chk("la boleta sigue ahí",
    (await sql`SELECT count(*)::int n FROM tickets WHERE user_email=${CONPLATA}`)[0].n === 1);
  chk("y el pedido también",
    (await sql`SELECT count(*)::int n FROM orders WHERE user_email=${CONPLATA}`)[0].n === 1);

  const yo = await req("mod", "DELETE", RUTA, { email: MOD, motivo: MOTIVO, destinoPerfiles: "desamparar" });
  chk("no me puedo borrar a mí mismo", yo.status >= 400, String(yo.status));

  const corto = await req("mod", "DELETE", RUTA, { email: LIMPIA, motivo: "no", destinoPerfiles: "desamparar" });
  chk("motivo de 2 letras -> 400", corto.status === 400, String(corto.status));

  const sinDestino = await req("mod", "DELETE", RUTA, { email: LIMPIA, motivo: MOTIVO });
  chk("sin destinoPerfiles -> 400", sinDestino.status === 400, String(sinDestino.status));

  chk("después de todo eso la cuenta limpia sigue intacta",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${LIMPIA}`)[0].n === 1);
}

console.log("\n=== EL BORRADO QUE SÍ ===");
{
  const r = await req("mod", "DELETE", RUTA, {
    email: LIMPIA, motivo: MOTIVO, destinoPerfiles: "desamparar",
  });
  chk("responde 200", r.status === 200, JSON.stringify(r.data));

  chk("la cuenta NO está",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${LIMPIA}`)[0].n === 0);
  chk("el like se fue con ella",
    (await sql`SELECT count(*)::int n FROM artist_likes WHERE user_email=${LIMPIA}`)[0].n === 0);

  const [a] = await sql`SELECT owner_email, censored_at FROM artists WHERE slug=${ART}`;
  chk("el artista SIGUE EN PIE, sin dueño", a && a.owner_email === null, JSON.stringify(a));
  chk("y visible", a?.censored_at === null, String(a?.censored_at));
  const [c] = await sql`SELECT owner_email FROM collectives WHERE slug=${COL}`;
  chk("el colectivo también", c && c.owner_email === null, JSON.stringify(c));

  const [reg] = await sql`SELECT * FROM account_removals WHERE email=${LIMPIA}`;
  chk("quedó el registro", Boolean(reg), "no quedó");
  chk("con modo NORMAL, no limpieza", reg?.mode === "normal", String(reg?.mode));
  chk("y sin nada de comercio en el plan",
    Number(reg?.plan?.pedidos) === 0 && Number(reg?.plan?.boletas) === 0, JSON.stringify(reg?.plan));
  chk("con la medición escrita", reg?.measured != null, JSON.stringify(reg?.measured));
}

console.log("\n=== OCULTANDO LOS PERFILES ===");
await montar();
{
  const r = await req("mod", "DELETE", RUTA, {
    email: LIMPIA, motivo: MOTIVO, destinoPerfiles: "ocultar",
  });
  chk("responde 200", r.status === 200, JSON.stringify(r.data));
  const [a] = await sql`SELECT censored_at, censor_reason FROM artists WHERE slug=${ART}`;
  chk("el artista quedó censurado", a?.censored_at !== null, String(a?.censored_at));
  chk("con el motivo del borrado", a?.censor_reason === MOTIVO, String(a?.censor_reason));
  const [s] = await sql`SELECT censored_at FROM dj_sets WHERE slug=${ART + "-set"}`;
  chk("y su set también", s?.censored_at !== null, String(s?.censored_at));
}

console.log("\n=== LA PANTALLA ===");
{
  const t = texto(await (await fetch(`${BASE}/admin/moderacion`, { headers: { cookie: ck("mod") } })).text());
  chk("el panel ofrece eliminar", t.includes("ELIMINAR UNA CUENTA"), t.slice(0, 120));
  chk("y avisa que casi siempre corresponde banear",
    t.includes("Casi siempre lo que corresponde es banear"), "no está el aviso");
  chk("YA NO PROMETE que nada borra datos",
    !t.includes("Nada de lo que pasa acá borra datos"), "sigue la promesa vieja");
  chk("el registro de eliminadas se ve", t.includes("ELIMINADAS ("), "no está el registro");
  chk("y nombra la cuenta que se borró", t.includes(LIMPIA), "no la nombra");
}

await limpiarFixture();
await sql`DELETE FROM user_roles WHERE email LIKE '%@test.hotu.local'`;
const fin = await corrida.cerrar();
console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
console.log("borrado por esta corrida:", JSON.stringify(fin.borrado));
console.log("seed:", JSON.stringify(fin.estado));
process.exit(mal === 0 ? 0 : 1);
