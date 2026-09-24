/**
 * LA LIMPIEZA PRE-LANZAMIENTO HACE LO QUE DICE, Y NADA MÁS.
 *
 * Es el único camino de HOTU que borra de verdad, así que lo que hay que
 * probar no es tanto que funcione —eso se ve— sino que NO SE PUEDA
 * llegar a él por ningún otro lado, y que lo que promete dejar en pie
 * quede en pie.
 *
 * ============================================================
 * SE CORRE DOS VECES, CON EL INTERRUPTOR EN CADA POSICIÓN
 * ============================================================
 *
 * LIMPIEZA_PRELANZAMIENTO no se puede cambiar desde adentro de una
 * prueba: lo lee el server, y Next lo toma al arrancar. Así que esta
 * batería MIRA en qué posición está y prueba lo que corresponde:
 *
 *   sin la variable -> la ruta y la página tienen que dar 404
 *   con la variable en 1 -> todo lo demás
 *
 * Las dos corridas son parte de la prueba. Una sola no dice nada sobre
 * el interruptor, que es la garantía de que esto se apaga el día del
 * lanzamiento.
 */
import { neon } from "@neondatabase/serverless";
import { estadoSeed, restaurarSeed } from "./seed.mjs";

const sql = neon(process.env.DATABASE_URL);
const BASE = "http://localhost:3000";
const ENCENDIDA = process.env.LIMPIEZA_PRELANZAMIENTO === "1";

let ok = 0, mal = 0;
const chk = (n, c, d = "") => {
  if (c) { ok++; console.log("   OK   " + n); }
  else { mal++; console.log("   MAL  " + n + (d ? " -> " + d : "")); }
};

/* ---------- sesiones, igual que las otras baterías ---------- */
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
const post = async (q, body) => {
  const res = await fetch(`${BASE}/api/admin/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(q ? { cookie: ck(q) } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const pagina = async (q) =>
  (await fetch(`${BASE}/admin/limpieza`, { headers: q ? { cookie: ck(q) } : {} })).status;

const SECRET = process.env.MIGRATE_SECRET;
if (!SECRET) { console.error("Falta MIGRATE_SECRET en el entorno."); process.exit(1); }

const JEFE = "duena@test.hotu.local";        // será SUPER_ADMIN
const MOD  = "aplicante@test.hotu.local";    // solo MODERATOR
const MOTIVO = "Limpieza de prueba de la bateria automatica";

await restaurarSeed(sql);

/* ===================================================================
 * EL INTERRUPTOR APAGADO
 * =================================================================== */
if (!ENCENDIDA) {
  console.log("=== INTERRUPTOR APAGADO: NADA DE ESTO EXISTE ===");
  await sql`INSERT INTO user_roles (email,role,country_code) VALUES (${JEFE},'SUPER_ADMIN','COL') ON CONFLICT DO NOTHING`;
  const quien = await login("jefe", JEFE);
  chk("el SUPER_ADMIN entra igual", quien === JEFE, String(quien));

  const r = await post("jefe", { secret: SECRET, accion: "vista-previa", emails: ["x@y.z"] });
  chk("la ruta da 404, no 403", r.status === 404, String(r.status));
  chk("y no dice por qué", (r.data?.error ?? "") === "Not found", JSON.stringify(r.data));

  chk("la página da 404 incluso para el SUPER_ADMIN", (await pagina("jefe")) === 404);

  const anon = await post(null, { secret: SECRET, accion: "vista-previa", emails: ["x@y.z"] });
  chk("y sin sesión también 404 (el interruptor va primero)", anon.status === 404, String(anon.status));

  await sql`DELETE FROM user_roles WHERE email LIKE '%@test.hotu.local'`;
  await restaurarSeed(sql);
  console.log(`\n=== ${ok} OK, ${mal} MAL (interruptor apagado) ===`);
  console.log("Volvé a correrla con LIMPIEZA_PRELANZAMIENTO=1 para el resto.");
  console.log("limpieza y seed:", JSON.stringify(await estadoSeed(sql)));
  process.exit(mal === 0 ? 0 : 1);
}

/* ===================================================================
 * DE ACÁ PARA ABAJO, EL INTERRUPTOR ESTÁ PUESTO
 * =================================================================== */
console.log("=== INTERRUPTOR PUESTO ===");

await sql`INSERT INTO user_roles (email,role,country_code) VALUES (${JEFE},'SUPER_ADMIN','COL') ON CONFLICT DO NOTHING`;
await sql`INSERT INTO user_roles (email,role,country_code) VALUES (${MOD},'MODERATOR','COL') ON CONFLICT DO NOTHING`;
chk("el SUPER_ADMIN entra", (await login("jefe", JEFE)) === JEFE);
chk("el moderador entra", (await login("mod", MOD)) === MOD);

console.log("\n=== QUIÉN NO PASA ===");
{
  const anon = await post(null, { secret: SECRET, accion: "vista-previa", emails: ["x@y.z"] });
  chk("sin sesión -> 401", anon.status === 401, String(anon.status));

  const m = await post("mod", { secret: SECRET, accion: "vista-previa", emails: ["x@y.z"] });
  chk("un MODERATOR -> 403 (moderar no es borrar)", m.status === 403, String(m.status));

  const malSecret = await post("jefe", { secret: SECRET + "x", accion: "vista-previa", emails: ["x@y.z"] });
  chk("SUPER_ADMIN con el secreto mal -> 403", malSecret.status === 403, String(malSecret.status));

  const sinSecret = await post("jefe", { accion: "vista-previa", emails: ["x@y.z"] });
  chk("SUPER_ADMIN sin secreto -> 403", sinSecret.status === 403, String(sinSecret.status));

  chk("la página: 404 para el MODERATOR", (await pagina("mod")) === 404);
  chk("la página: 200 para el SUPER_ADMIN", (await pagina("jefe")) === 200);
}

/* ---------- el fixture: una cuenta de prueba completa ---------- */
const CUENTA = "zz-limpieza@test.hotu.local";
const ART = "zz-limpieza-dj";
const COL = "zz-limpieza-col";

async function montar() {
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider)
            VALUES (${CUENTA},'ZZ Limpieza','credentials')`;
  await sql`INSERT INTO artists (slug, name, genre, city, bio, joined_at, district, owner_email)
            VALUES (${ART},'ZZ Limpieza DJ','techno','Bogota','fixture','2026-01-01','06',${CUENTA})`;
  await sql`INSERT INTO collectives (slug, name, type, sector, bio, owner_email)
            VALUES (${COL},'ZZ Limpieza Col','colectivo','centro','fixture',${CUENTA})`;
  await sql`INSERT INTO dj_sets (slug, title, artist_name, district, duration, recorded_at, artist_slug)
            VALUES (${ART + "-set"},'ZZ Set','ZZ Limpieza DJ','06','60:00','2026-01-01',${ART})`;
  await sql`INSERT INTO tracks (slug, title, artist_name, district, released_at, artist_slug)
            VALUES (${ART + "-track"},'ZZ Track','ZZ Limpieza DJ','06','2026-01-01',${ART})`;
  await sql`INSERT INTO artist_likes (artist_slug, user_email) VALUES ('test-camila', ${CUENTA})`;
  await sql`INSERT INTO user_roles (email, role, country_code) VALUES (${CUENTA},'ORGANIZER','COL')`;

  const [ev] = await sql`SELECT id FROM events ORDER BY id LIMIT 1`;
  const [o] = await sql`INSERT INTO orders (user_email, kind, status, amount_cop)
                        VALUES (${CUENTA},'tickets','paid',50000) RETURNING id`;
  const [oi] = await sql`INSERT INTO order_items (order_id, event_id, item_type, name, ticket_tier, unit_price_cop, quantity)
                         VALUES (${o.id}, ${ev.id}, 'ticket','ZZ Boleta de prueba','general',50000,1) RETURNING id`;
  const [t] = await sql`INSERT INTO tickets (ticket_code, order_id, order_item_id, user_email, event_id, tier, status)
                        VALUES (${"ZZ-" + Date.now()}, ${o.id}, ${oi.id}, ${CUENTA}, ${ev.id}, 'general','valid')
                        RETURNING id`;
  await sql`INSERT INTO ticket_attributions (ticket_id, seller_artist_slug, event_id, amount_cop)
            VALUES (${t.id}, 'test-camila', ${ev.id}, 50000)`;
  return { orderId: o.id, ticketId: t.id };
}

async function desmontar() {
  await sql`DELETE FROM ticket_attributions WHERE ticket_id IN (SELECT id FROM tickets WHERE user_email = ${CUENTA})`;
  await sql`DELETE FROM tickets WHERE user_email = ${CUENTA}`;
  await sql`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_email = ${CUENTA})`;
  await sql`DELETE FROM orders WHERE user_email = ${CUENTA}`;
  await sql`DELETE FROM dj_sets WHERE artist_slug = ${ART} OR slug LIKE 'zz-limpieza%'`;
  await sql`DELETE FROM tracks WHERE artist_slug = ${ART} OR slug LIKE 'zz-limpieza%'`;
  await sql`DELETE FROM artists WHERE slug = ${ART}`;
  await sql`DELETE FROM collectives WHERE slug = ${COL}`;
  await sql`DELETE FROM user_profiles WHERE email = ${CUENTA}`;
  await sql`DELETE FROM account_removals WHERE email = ${CUENTA}`;
}

console.log("\n=== LA VISTA PREVIA NO ESCRIBE NADA ===");
await desmontar();
await montar();
{
  const antes = await sql`SELECT
    (SELECT count(*)::int FROM user_profiles) u, (SELECT count(*)::int FROM orders) o,
    (SELECT count(*)::int FROM tickets) t, (SELECT count(*)::int FROM account_removals) r`;
  const r = await post("jefe", { secret: SECRET, accion: "vista-previa", emails: [CUENTA] });
  chk("la previa responde 200", r.status === 200, String(r.status));

  const inv = r.data?.inventarios?.[0];
  chk("dice 1 pedido", inv?.pedidos === 1, JSON.stringify(inv?.pedidos));
  chk("dice 1 boleta", inv?.boletas === 1, JSON.stringify(inv?.boletas));
  chk("dice 1 atribución", inv?.atribuciones === 1, JSON.stringify(inv?.atribuciones));
  chk("dice el monto", inv?.montoCop === 50000, JSON.stringify(inv?.montoCop));
  chk("NOMBRA al vendedor que pierde la venta", (inv?.vendedores ?? []).includes("test-camila"),
    JSON.stringify(inv?.vendedores));
  chk("dice 1 like", inv?.likes === 1, JSON.stringify(inv?.likes));
  chk("dice el rol", (inv?.roles ?? []).includes("ORGANIZER"), JSON.stringify(inv?.roles));
  chk("lista el artista", (inv?.artistas ?? []).some((a) => a.slug === ART), JSON.stringify(inv?.artistas));
  chk("lista el colectivo", (inv?.colectivos ?? []).some((c) => c.slug === COL), JSON.stringify(inv?.colectivos));
  chk("cuenta los sets y tracks", inv?.setsYTracks === 2, JSON.stringify(inv?.setsYTracks));

  const despues = await sql`SELECT
    (SELECT count(*)::int FROM user_profiles) u, (SELECT count(*)::int FROM orders) o,
    (SELECT count(*)::int FROM tickets) t, (SELECT count(*)::int FROM account_removals) r`;
  chk("y NO escribió una sola fila", JSON.stringify(antes[0]) === JSON.stringify(despues[0]),
    JSON.stringify(antes[0]) + " -> " + JSON.stringify(despues[0]));

  const inexistente = await post("jefe", { secret: SECRET, accion: "vista-previa", emails: ["zz-no-existe@test.hotu.local"] });
  chk("una cuenta que no existe sale en noEncontradas",
    (inexistente.data?.noEncontradas ?? []).length === 1, JSON.stringify(inexistente.data));
}

console.log("\n=== LO QUE NO SE PUEDE BORRAR ===");
{
  const yo = await post("jefe", {
    secret: SECRET, accion: "eliminar", emails: [JEFE], motivo: MOTIVO, destinoPerfiles: "desamparar",
  });
  chk("no me puedo borrar a mí mismo", yo.data?.resultados?.[0]?.ok === false, JSON.stringify(yo.data));
  chk("y sigo existiendo",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${JEFE}`)[0].n === 1);

  const otroMod = await post("jefe", {
    secret: SECRET, accion: "eliminar", emails: [MOD], motivo: MOTIVO, destinoPerfiles: "desamparar",
  });
  chk("no puedo borrar a otro moderador", otroMod.data?.resultados?.[0]?.ok === false, JSON.stringify(otroMod.data));
  chk("y el moderador sigue existiendo",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${MOD}`)[0].n === 1);

  const sinMotivo = await post("jefe", {
    secret: SECRET, accion: "eliminar", emails: [CUENTA], motivo: "corto", destinoPerfiles: "desamparar",
  });
  chk("un motivo de 5 letras no alcanza", sinMotivo.data?.resultados?.[0]?.ok === false, JSON.stringify(sinMotivo.data));
  chk("y la cuenta sigue viva",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${CUENTA}`)[0].n === 1);

  const sinDestino = await post("jefe", {
    secret: SECRET, accion: "eliminar", emails: [CUENTA], motivo: MOTIVO,
  });
  chk("sin destinoPerfiles -> 400", sinDestino.status === 400, String(sinDestino.status));
}

console.log("\n=== BORRADO CON LOS PERFILES DESAMPARADOS ===");
{
  const r = await post("jefe", {
    secret: SECRET, accion: "eliminar", emails: [CUENTA, CUENTA], // repetido a propósito
    motivo: MOTIVO, destinoPerfiles: "desamparar",
  });
  chk("responde 200", r.status === 200, String(r.status));
  chk("el email repetido se procesa UNA sola vez", (r.data?.resultados ?? []).length === 1,
    JSON.stringify((r.data?.resultados ?? []).length));
  chk("dice que la borró", r.data?.borradas === 1, JSON.stringify(r.data?.borradas));

  chk("la cuenta NO está",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${CUENTA}`)[0].n === 0);
  chk("los pedidos NO están",
    (await sql`SELECT count(*)::int n FROM orders WHERE user_email=${CUENTA}`)[0].n === 0);
  chk("las boletas NO están",
    (await sql`SELECT count(*)::int n FROM tickets WHERE user_email=${CUENTA}`)[0].n === 0);
  chk("el like se fue con ella (CASCADE)",
    (await sql`SELECT count(*)::int n FROM artist_likes WHERE user_email=${CUENTA}`)[0].n === 0);
  chk("el rol se fue con ella (CASCADE)",
    (await sql`SELECT count(*)::int n FROM user_roles WHERE email=${CUENTA}`)[0].n === 0);

  const [a] = await sql`SELECT owner_email, censored_at FROM artists WHERE slug=${ART}`;
  chk("EL ARTISTA SIGUE EN PIE", Boolean(a), "no está");
  chk("sin dueño", a?.owner_email === null, String(a?.owner_email));
  chk("y SIN censurar (se pidió desamparar)", a?.censored_at === null, String(a?.censored_at));

  const [c] = await sql`SELECT owner_email, censored_at FROM collectives WHERE slug=${COL}`;
  chk("EL COLECTIVO SIGUE EN PIE", Boolean(c), "no está");
  chk("sin dueño", c?.owner_email === null, String(c?.owner_email));

  const [s] = await sql`SELECT censored_at FROM dj_sets WHERE slug=${ART + "-set"}`;
  chk("el set sigue visible", s && s.censored_at === null, JSON.stringify(s));

  const [reg] = await sql`SELECT * FROM account_removals WHERE email=${CUENTA}`;
  chk("QUEDÓ EL REGISTRO, aunque la cuenta ya no exista", Boolean(reg), "no quedó");
  chk("con modo limpieza", reg?.mode === "limpieza", String(reg?.mode));
  chk("con el motivo", reg?.note === MOTIVO, String(reg?.note));
  chk("con quién lo hizo", String(reg?.removed_by).toLowerCase() === JEFE, String(reg?.removed_by));
  chk("con el plan", Number(reg?.plan?.pedidos) === 1, JSON.stringify(reg?.plan));
  chk("Y CON LA MEDICIÓN", reg?.measured !== null && reg?.measured !== undefined, JSON.stringify(reg?.measured));
  chk("la medición dice 1 pedido borrado", Number(reg?.measured?.pedidos) === 1, JSON.stringify(reg?.measured));
  chk("la medición dice 1 boleta borrada", Number(reg?.measured?.boletas) === 1, JSON.stringify(reg?.measured));
  chk("la medición dice 1 atribución borrada", Number(reg?.measured?.atribuciones) === 1, JSON.stringify(reg?.measured));
  chk("y deja escrito qué se hizo con los perfiles",
    reg?.measured?.destino_perfiles === "desamparar", JSON.stringify(reg?.measured?.destino_perfiles));
}

console.log("\n=== BORRADO OCULTANDO LOS PERFILES ===");
await desmontar();
await montar();
{
  const r = await post("jefe", {
    secret: SECRET, accion: "eliminar", emails: [CUENTA], motivo: MOTIVO, destinoPerfiles: "ocultar",
  });
  chk("responde 200", r.status === 200, String(r.status));

  const [a] = await sql`SELECT owner_email, censored_at, censor_reason, censored_by FROM artists WHERE slug=${ART}`;
  chk("el artista sigue existiendo", Boolean(a), "no está");
  chk("pero CENSURADO", a?.censored_at !== null, String(a?.censored_at));
  chk("con el motivo del borrado", a?.censor_reason === MOTIVO, String(a?.censor_reason));
  chk("firmado por quien borró, no por la cuenta borrada",
    String(a?.censored_by).toLowerCase() === JEFE, String(a?.censored_by));

  const [c] = await sql`SELECT censored_at FROM collectives WHERE slug=${COL}`;
  chk("el colectivo también censurado", c?.censored_at !== null, String(c?.censored_at));

  const [s] = await sql`SELECT censored_at FROM dj_sets WHERE slug=${ART + "-set"}`;
  chk("EL SET TAMBIÉN (si no, esconder a medias)", s?.censored_at !== null, String(s?.censored_at));
  const [t] = await sql`SELECT censored_at FROM tracks WHERE slug=${ART + "-track"}`;
  chk("Y EL TRACK", t?.censored_at !== null, String(t?.censored_at));

  const [reg] = await sql`SELECT measured FROM account_removals WHERE email=${CUENTA}`;
  chk("el registro cuenta lo ocultado", Number(reg?.measured?.artistas_ocultados) === 1, JSON.stringify(reg?.measured));
  chk("incluidos sets y tracks", Number(reg?.measured?.sets_ocultados) === 1, JSON.stringify(reg?.measured));
}

console.log("\n=== EL RESTRICT NO SE AFLOJÓ EN NINGÚN MOMENTO ===");
{
  // Una cuenta con un pedido, borrada por SQL directo: la base tiene que
  // seguir negándose. Si la limpieza hubiera tocado el constraint, esto
  // pasaría, y ese es justo el modo de falla que no se vería de otra forma.
  const OTRA = "zz-restrict@test.hotu.local";
  await sql`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_email=${OTRA})`;
  await sql`DELETE FROM orders WHERE user_email=${OTRA}`;
  await sql`DELETE FROM user_profiles WHERE email=${OTRA}`;
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider) VALUES (${OTRA},'ZZ R','credentials')`;
  const [o] = await sql`INSERT INTO orders (user_email, kind, status, amount_cop)
                        VALUES (${OTRA},'tickets','pending',1000) RETURNING id`;
  let negado = false;
  try { await sql`DELETE FROM user_profiles WHERE email=${OTRA}`; }
  catch (e) { negado = e.message.includes("violates foreign key"); }
  chk("borrar por SQL una cuenta con pedido SIGUE rechazado", negado);
  await sql`DELETE FROM order_items WHERE order_id=${o.id}`;
  await sql`DELETE FROM orders WHERE id=${o.id}`;
  await sql`DELETE FROM user_profiles WHERE email=${OTRA}`;
}

console.log("\n=== EL TOPE ===");
{
  const muchos = Array.from({ length: 51 }, (_, i) => `zz-${i}@test.hotu.local`);
  const r = await post("jefe", { secret: SECRET, accion: "vista-previa", emails: muchos });
  chk("más de 50 cuentas -> 400", r.status === 400, String(r.status));
  const ninguna = await post("jefe", { secret: SECRET, accion: "vista-previa", emails: [] });
  chk("ninguna cuenta -> 400", ninguna.status === 400, String(ninguna.status));
}

await desmontar();
await sql`DELETE FROM user_roles WHERE email LIKE '%@test.hotu.local'`;
await restaurarSeed(sql);
console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
console.log("limpieza y seed:", JSON.stringify(await estadoSeed(sql)));
process.exit(mal === 0 ? 0 : 1);
