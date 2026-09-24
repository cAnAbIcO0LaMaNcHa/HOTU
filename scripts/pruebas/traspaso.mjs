/**
 * Batería del traspaso de propiedad.
 *
 * ARRANCA RESTAURANDO EL SEED, no solo verificándolo al final: una
 * corrida anterior había dejado test-camila derivado de artista@ a
 * usuario@, porque reasignarDueno mueve todo lo del dueño y el test no
 * contó con el radio. Verificar al final avisa después del daño;
 * restaurar al empezar hace que no importe.
 */
import { neon } from "@neondatabase/serverless";
import { estadoSeed, restaurarSeed } from "./seed.mjs";
const sql = neon(process.env.DATABASE_URL);
const BASE = "http://localhost:3000";

await restaurarSeed(sql);

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
  return (await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: ck(q) } })).json())?.user?.email ?? null;
}
const req = async (q, m, r, b) => {
  const res = await fetch(`${BASE}${r}`, {
    method: m, headers: { "Content-Type": "application/json", cookie: ck(q) },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

/**
 * El texto que de verdad LEE una persona.
 *
 * React parte los nodos de texto con <!-- -->, así que un grep de la
 * frase entera sobre el HTML crudo da falso negativo — ya me pasó. Esto
 * saca las etiquetas y los comentarios y deja el texto corrido, que es lo
 * más cerca del textContent del DOM sin montar un navegador.
 */
const texto = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

let ok = 0, mal = 0;
const chk = (n, c, d = "") => { if (c) { ok++; console.log("   OK   " + n); } else { mal++; console.log("   MAL  " + n + " -> " + d); } };

const MOD = "aplicante@test.hotu.local";
const REAL = "duena@test.hotu.local";
const DESTINO = "usuario@test.hotu.local";
await sql`INSERT INTO user_roles (email,role,country_code) VALUES (${MOD},'MODERATOR','COL') ON CONFLICT DO NOTHING`;
await login("mod", MOD);

/* Fixtures propios, con prefijo zz-. */
const FANTASMA = "zz-fant@perfil.hotu.local";
async function montar() {
  await sql`DELETE FROM collective_ownership WHERE collective_slug LIKE 'zz-%'`;
  await sql`DELETE FROM artist_collectives WHERE collective_slug LIKE 'zz-%'`;
  await sql`DELETE FROM collectives WHERE slug LIKE 'zz-%'`;
  await sql`DELETE FROM artists WHERE slug LIKE 'zz-%'`;
  await sql`DELETE FROM user_profiles WHERE email = ${FANTASMA}`;
  // Un fantasma con DOS perfiles.
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider) VALUES (${FANTASMA},'ZZ Fant','credentials')`;
  await sql`INSERT INTO artists (slug,name,genre,district,city,photo,bio,status,joined_at,owner_email)
            VALUES ('zz-a-fant','ZZ A Fant','techno','D00','Bogotá','','','published',CURRENT_DATE,${FANTASMA})`;
  await sql`INSERT INTO collectives (slug,name,type,sector,bio,district,status,entity_kind,owner_email)
            VALUES ('zz-c-fant','ZZ C Fant','LOCAL','Bogotá','','D00','published','collective',${FANTASMA})`;
  // Y un colectivo de una cuenta REAL, que ya tiene su perfil de artista.
  await sql`INSERT INTO collectives (slug,name,type,sector,bio,district,status,entity_kind,owner_email)
            VALUES ('zz-c-real','ZZ C Real','LOCAL','Bogotá','','D00','published','collective',${REAL})`;
}
await montar();

console.log("=== EL CRITERIO DE FANTASMA, MEDIDO ===");
{
  const r = await req("mod", "GET", `/api/admin/moderation/owner?tipo=collective&slug=zz-c-fant`);
  chk("cuenta sin contraseña ni proveedor -> modo 'todo'", r.data.modo === "todo", JSON.stringify(r.data.modo));
  chk("y se mueven los DOS perfiles", r.data.seMueve.artistas.length === 1 && r.data.seMueve.colectivos.length === 1, JSON.stringify(r.data.seMueve));
  chk("y no se queda nada", r.data.seQueda.artistas.length === 0 && r.data.seQueda.colectivos.length === 0, JSON.stringify(r.data.seQueda));

  const r2 = await req("mod", "GET", `/api/admin/moderation/owner?tipo=collective&slug=zz-c-real`);
  chk("cuenta con contraseña -> modo 'solo_nombrado'", r2.data.modo === "solo_nombrado", JSON.stringify(r2.data.modo));
  chk("se mueve solo el colectivo nombrado", r2.data.seMueve.colectivos.length === 1 && r2.data.seMueve.artistas.length === 0, JSON.stringify(r2.data.seMueve));
  chk("y su perfil de DJ SE QUEDA", r2.data.seQueda.artistas.length >= 1, JSON.stringify(r2.data.seQueda));

  // La cuenta de Google: el caso que casi fue bug.
  const [gg] = await sql`SELECT email FROM user_profiles WHERE auth_provider = 'google' LIMIT 1`;
  if (gg) {
    await sql`UPDATE collectives SET owner_email = ${gg.email} WHERE slug = 'zz-c-real'`;
    const r3 = await req("mod", "GET", `/api/admin/moderation/owner?tipo=collective&slug=zz-c-real`);
    chk("una cuenta de GOOGLE (sin contraseña) NO es fantasma", r3.data.modo === "solo_nombrado", JSON.stringify(r3.data.modo));
    await sql`UPDATE collectives SET owner_email = ${REAL} WHERE slug = 'zz-c-real'`;
  } else {
    console.log("   (no hay cuenta de Google en dev: ese caso no se corrió)");
  }
}

console.log("\n=== UNA CUENTA REAL: SE MUEVE SOLO LO NOMBRADO ===");
{
  const r = await req("mod", "PATCH", "/api/admin/moderation/owner", {
    tipo: "collective", slug: "zz-c-real", email: DESTINO,
    motivo: "Traspaso de prueba desde una cuenta activa.", modo: "solo_nombrado",
  });
  chk("traspasar -> 200", r.status === 200, JSON.stringify(r).slice(0, 160));
  chk("informa modo solo_nombrado", r.data.modo === "solo_nombrado", String(r.data.modo));
  const [c] = await sql`SELECT owner_email FROM collectives WHERE slug = 'zz-c-real'`;
  chk("el colectivo cambió de dueño", c.owner_email === DESTINO, String(c.owner_email));
  const [a] = await sql`SELECT owner_email FROM artists WHERE slug = 'test-duena'`;
  chk("SU PERFIL DE DJ SE QUEDÓ con ella", a.owner_email === REAL, String(a.owner_email));
  const [o] = await sql`SELECT count(*)::int n FROM collectives WHERE lower(owner_email) = ${REAL}`;
  chk("y sus otros colectivos también", o.n >= 1, String(o.n));
  chk("la cuenta real NO se borró", (await sql`SELECT count(*)::int n FROM user_profiles WHERE email = ${REAL}`)[0].n === 1);
}

console.log("\n=== UN FANTASMA CON DOS PERFILES: SE MUEVEN TODOS ===");
{
  const r = await req("mod", "PATCH", "/api/admin/moderation/owner", {
    tipo: "collective", slug: "zz-c-fant", email: DESTINO,
    motivo: "Traspaso de prueba desde una cuenta fantasma.", modo: "todo",
  });
  chk("traspasar -> 200", r.status === 200, JSON.stringify(r).slice(0, 160));
  chk("informa modo todo", r.data.modo === "todo", String(r.data.modo));
  const [a] = await sql`SELECT owner_email FROM artists WHERE slug = 'zz-a-fant'`;
  const [c] = await sql`SELECT owner_email FROM collectives WHERE slug = 'zz-c-fant'`;
  chk("se movió el artista", a.owner_email === DESTINO, String(a.owner_email));
  chk("y el colectivo", c.owner_email === DESTINO, String(c.owner_email));
  chk("y la cuenta fantasma se borró", r.data.cuentaBorrada === true, String(r.data.cuentaBorrada));
  chk("de verdad no está", (await sql`SELECT count(*)::int n FROM user_profiles WHERE email = ${FANTASMA}`)[0].n === 0);
}

console.log("\n=== LA CARRERA: LA CUENTA SE ACTIVA ENTRE LA PREVIA Y EL CONFIRMAR ===");
await montar();
{
  const previa = await req("mod", "GET", `/api/admin/moderation/owner?tipo=collective&slug=zz-c-fant`);
  chk("la previa dice 'todo'", previa.data.modo === "todo", String(previa.data.modo));

  // Alguien le pone contraseña: ya no es fantasma.
  await sql`UPDATE user_profiles SET password_hash = 's1:x:y' WHERE email = ${FANTASMA}`;

  const r = await req("mod", "PATCH", "/api/admin/moderation/owner", {
    tipo: "collective", slug: "zz-c-fant", email: DESTINO,
    motivo: "Traspaso con el modo viejo.", modo: "todo",
  });
  chk("el traspaso se RECHAZA -> 409", r.status === 409, JSON.stringify(r));
  chk("y el mensaje dice que revise de nuevo", /cambió desde la vista previa/i.test(r.data.error ?? ""), r.data.error);
  const [a] = await sql`SELECT owner_email FROM artists WHERE slug = 'zz-a-fant'`;
  const [c] = await sql`SELECT owner_email FROM collectives WHERE slug = 'zz-c-fant'`;
  chk("NO escribió nada: el artista sigue igual", a.owner_email === FANTASMA, String(a.owner_email));
  chk("ni el colectivo", c.owner_email === FANTASMA, String(c.owner_email));

  // Con el modo correcto sí pasa, y mueve solo lo nombrado.
  const r2 = await req("mod", "PATCH", "/api/admin/moderation/owner", {
    tipo: "collective", slug: "zz-c-fant", email: DESTINO,
    motivo: "Traspaso con el modo correcto.", modo: "solo_nombrado",
  });
  chk("con el modo recalculado -> 200", r2.status === 200, JSON.stringify(r2).slice(0, 140));
  const [a2] = await sql`SELECT owner_email FROM artists WHERE slug = 'zz-a-fant'`;
  chk("y el artista NO se movió", a2.owner_email === FANTASMA, String(a2.owner_email));
}

console.log("\n=== IDEMPOTENCIA: REPETIRLO NO DEJA NADA A MEDIAS ===");
{
  const antes = await sql`SELECT slug, owner_email FROM collectives WHERE slug LIKE 'zz-%' ORDER BY slug`;
  const r = await req("mod", "PATCH", "/api/admin/moderation/owner", {
    tipo: "collective", slug: "zz-c-fant", email: DESTINO, motivo: "Repetido, ya es de esa cuenta.",
  });
  chk("repetir el mismo traspaso -> 409", r.status === 409, JSON.stringify(r));
  chk("y dice que ya es de esa cuenta", /ya es de esa cuenta/i.test(r.data.error ?? ""), r.data.error);
  const despues = await sql`SELECT slug, owner_email FROM collectives WHERE slug LIKE 'zz-%' ORDER BY slug`;
  chk("nada cambió", JSON.stringify(antes) === JSON.stringify(despues), JSON.stringify(despues));
  const [n] = await sql`SELECT count(*)::int n FROM collective_ownership WHERE collective_slug LIKE 'zz-%'`;
  chk("y no se duplicaron filas de registro", n.n === 0, String(n.n));
}

console.log("\n=== LAS CESIONES ABIERTAS SE CIERRAN EN LOS DOS MODOS ===");
for (const [modo, slug, dueno] of [["solo_nombrado", "zz-c-real", REAL], ["todo", "zz-c-fant", FANTASMA]]) {
  await montar();
  if (modo === "todo") await sql`UPDATE user_profiles SET password_hash = NULL WHERE email = ${FANTASMA}`;
  await sql`INSERT INTO collective_ownership (collective_slug, kind, from_email, to_email)
            VALUES (${slug}, 'cesion', ${dueno}, ${DESTINO})`;
  const r = await req("mod", "PATCH", "/api/admin/moderation/owner", {
    tipo: "collective", slug, email: DESTINO, motivo: `Traspaso con cesión abierta, modo ${modo}.`,
  });
  chk(`modo ${modo}: traspaso -> 200`, r.status === 200, JSON.stringify(r).slice(0, 140));
  chk(`modo ${modo}: cerró 1 cesión`, r.data.cesionesCerradas === 1, String(r.data.cesionesCerradas));
  const [o] = await sql`SELECT revoked_at FROM collective_ownership WHERE collective_slug = ${slug} AND kind='cesion'`;
  chk(`modo ${modo}: con revoked_at`, o && o.revoked_at !== null, JSON.stringify(o));
}

console.log("\n=== LA PANTALLA LO DICE, LEÍDO COMO TEXTO ===");
await montar();
{
  const t = texto(await (await fetch(`${BASE}/admin/moderacion`, { headers: { cookie: ck("mod") } })).text());
  chk("explica que no verifica, que verifica el moderador", /no verifica nada: lo verific/i.test(t), t.slice(0, 0) || "no está");
  chk("y pide cómo se verificó", /C.MO LO VERIFICASTE/i.test(t), "no lo pide");
  chk("el texto sale limpio (sin etiquetas)", !t.includes("<") && !t.includes("&nbsp;"), t.slice(0, 80));
}

/* ---------- limpieza y seed otra vez ---------- */
await restaurarSeed(sql);
console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
console.log("limpieza y seed:", JSON.stringify(await estadoSeed(sql)));
