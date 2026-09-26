/**
 * EL FLUJO DE RECLAMO, Y LAS GUARDAS QUE LO SOSTIENEN.
 *
 * Lo que importa probar acá no es que se pueda reclamar —eso se ve— sino:
 *
 *   - Que reclamable incluya "tiene dueño FANTASMA" y no solo "sin dueño".
 *     Es la regla central: los 18 perfiles de producción TIENEN dueño.
 *   - Que una cuenta fantasma no pueda reclamar.
 *   - Que el tope y el índice único frenen el acoso en serie.
 *   - Que el registro del traspaso esté DENTRO de la transacción: si no se
 *     puede escribir, la propiedad no se mueve.
 *   - Que la guarda de dominios imposibles suprima con motivo.
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
const texto = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const MOD = "aplicante@test.hotu.local";
const RECLAMANTE = "usuario@test.hotu.local";
const NOTA = "Soy el DJ de este perfil, mi instagram es @zz-prueba y toque en la bodega en marzo";

/* Fixtures: un artista con dueño FANTASMA, otro con dueño REAL, y uno sin dueño. */
const FANTASMA_MAIL = "zz-fantasma@perfil.hotu.local";
const A_FANTASMA = "zz-rec-fantasma";
const A_CON_DUENO = "zz-rec-condueno";
const A_SIN_DUENO = "zz-rec-sindueno";
const C_FANTASMA = "zz-rec-col";

const corrida = await abrirCorrida(sql, "reclamos.mjs");
await sql`INSERT INTO user_roles (email,role,country_code) VALUES (${MOD},'MODERATOR','COL') ON CONFLICT DO NOTHING`;

async function montar() {
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider)
            VALUES (${FANTASMA_MAIL},'ZZ Fantasma','credentials')`;
  /**
   * Fantasma de verdad, con la forma EXACTA que dejó setup-artist-owners:
   * password_hash NULL y auth_provider credentials. No NULL — la columna
   * es NOT NULL, y la primera versión de este fixture reventó ahí.
   *
   * esCuentaFantasma mira "tiene contraseña" y "tiene proveedor externo
   * vinculado", y lo segundo es auth_provider === google. Una cuenta de
   * credenciales sin hash no puede entrar por ninguna vía: eso es el
   * fantasma.
   */
  await sql`UPDATE user_profiles SET password_hash = NULL, auth_provider = 'credentials' WHERE email = ${FANTASMA_MAIL}`;
  const art = async (slug, owner) => sql`
    INSERT INTO artists (slug, name, genre, city, bio, joined_at, district, owner_email, status, review_status)
    VALUES (${slug}, ${"ZZ " + slug}, 'techno','Bogota','fixture','2026-01-01','06', ${owner}, 'published','aprobado')`;
  await art(A_FANTASMA, FANTASMA_MAIL);
  await art(A_CON_DUENO, "artista@test.hotu.local");
  await art(A_SIN_DUENO, null);
  await sql`INSERT INTO collectives (slug, name, type, sector, bio, owner_email)
            VALUES (${C_FANTASMA},'ZZ Rec Col','colectivo','centro','fixture',${FANTASMA_MAIL})`;
}
await montar();

chk("el moderador entra", (await login("mod", MOD)) === MOD);
chk("el reclamante entra", (await login("rec", RECLAMANTE)) === RECLAMANTE);

console.log("\n=== LA REGLA CENTRAL: DUEÑO FANTASMA TAMBIÉN SE RECLAMA ===");
{
  const t = texto(await (await fetch(`${BASE}/artistas/${A_FANTASMA}`)).text());
  chk("el perfil de dueño FANTASMA ofrece reclamarlo", t.includes("ESTE PERFIL NO TIENE DUEÑO"), t.slice(0, 100));
  const t2 = texto(await (await fetch(`${BASE}/artistas/${A_SIN_DUENO}`)).text());
  chk("el perfil SIN dueño también", t2.includes("ESTE PERFIL NO TIENE DUEÑO"));
  const t3 = texto(await (await fetch(`${BASE}/artistas/${A_CON_DUENO}`)).text());
  chk("el de dueño REAL no lo ofrece", !t3.includes("ESTE PERFIL NO TIENE DUEÑO"), t3.slice(0, 100));
}

console.log("\n=== QUIÉN NO PUEDE RECLAMAR ===");
{
  const anon = await req(null, "POST", "/api/claims", { tipo: "artist", slug: A_FANTASMA, nota: NOTA });
  chk("sin sesión -> 401", anon.status === 401, String(anon.status));

  const conDueno = await req("rec", "POST", "/api/claims", { tipo: "artist", slug: A_CON_DUENO, nota: NOTA });
  chk("un perfil con dueño real -> 409", conDueno.status === 409, JSON.stringify(conDueno.data));

  const corta = await req("rec", "POST", "/api/claims", { tipo: "artist", slug: A_FANTASMA, nota: "es mio" });
  chk("una nota de 6 caracteres -> 400", corta.status === 400, String(corta.status));

  // La cuenta fantasma no puede reclamar: se le fabrica una sesión no,
  // así que se prueba el lib por la vía del estado de la base.
  const [f] = await sql`SELECT password_hash, auth_provider FROM user_profiles WHERE email = ${FANTASMA_MAIL}`;
  chk("la cuenta fantasma del fixture es fantasma de verdad",
    f.password_hash === null && f.auth_provider === "credentials", JSON.stringify(f));
}

console.log("\n=== EL RECLAMO QUE SÍ ===");
let reclamoId = 0;
{
  const r = await req("rec", "POST", "/api/claims", { tipo: "artist", slug: A_FANTASMA, nota: NOTA });
  chk("responde 200", r.status === 200, JSON.stringify(r.data));
  reclamoId = Number(r.data?.reclamoId ?? 0);
  chk("devuelve el id", reclamoId > 0, String(reclamoId));

  const [fila] = await sql`SELECT * FROM profile_ownership WHERE id = ${reclamoId}`;
  chk("queda fila kind='reclamo'", fila?.kind === "reclamo", String(fila?.kind));
  chk("sobre el artista y no sobre un colectivo",
    fila?.artist_slug === A_FANTASMA && fila.collective_slug === null, JSON.stringify(fila?.artist_slug));
  chk("con el reclamante en to_email", String(fila?.to_email).toLowerCase() === RECLAMANTE);
  chk("y el dueño fantasma en from_email", fila?.from_email === FANTASMA_MAIL, String(fila?.from_email));
  chk("con la nota completa", fila?.note === NOTA);

  chk("el perfil NO cambió de dueño todavía",
    (await sql`SELECT owner_email FROM artists WHERE slug=${A_FANTASMA}`)[0].owner_email === FANTASMA_MAIL);
}

console.log("\n=== EL MAIL: REGISTRADO, NO ENVIADO, Y LOS IMPOSIBLES SUPRIMIDOS ===");
{
  const filas = await sql`SELECT tipo, para, estado, motivo FROM mail_outbox ORDER BY id`;
  chk("hay avisos registrados", filas.length > 0, String(filas.length));
  chk("el acuse al reclamante quedó registrado",
    filas.some((f) => f.tipo === "reclamo_recibido" && f.para === RECLAMANTE && f.estado === "suprimido"),
    JSON.stringify(filas.filter((f) => f.tipo === "reclamo_recibido")));
  /**
   * El reclamante es @test.hotu.local, o sea un dominio IMPOSIBLE: el
   * aviso tiene que quedar SUPRIMIDO con motivo, no enviado ni perdido.
   * Es la guarda que protege la reputación del dominio el día que exista.
   */
  const sup = filas.filter((f) => f.estado === "suprimido");
  chk("los avisos a dominios imposibles quedan SUPRIMIDOS", sup.length > 0, String(sup.length));
  chk("y todos con motivo", sup.every((f) => f.motivo && f.motivo.length > 0), JSON.stringify(sup[0]));
  chk("el motivo nombra el dominio",
    sup.some((f) => String(f.motivo).includes("hotu.local")), JSON.stringify(sup[0]?.motivo));
  chk("NINGUNO quedó 'enviado' (no hay proveedor)",
    filas.every((f) => f.estado !== "enviado"), JSON.stringify(filas.map((f) => f.estado)));
  chk("se avisó a los moderadores",
    filas.some((f) => f.tipo === "reclamo_en_cola"), JSON.stringify(filas.map((f) => f.tipo)));
}

console.log("\n=== ANTI-ACOSO: UNO POR PERFIL, Y TOPE POR CUENTA ===");
{
  const otra = await req("rec", "POST", "/api/claims", { tipo: "artist", slug: A_FANTASMA, nota: NOTA });
  chk("el MISMO perfil dos veces -> 409 (índice único parcial)", otra.status === 409, JSON.stringify(otra.data));
  chk("y sigue habiendo un solo reclamo abierto sobre ese perfil",
    (await sql`SELECT count(*)::int n FROM profile_ownership WHERE kind='reclamo' AND artist_slug=${A_FANTASMA}
               AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`)[0].n === 1);

  // Ya tiene 1. Dos más llegan al tope de 3, el cuarto rebota.
  const r2 = await req("rec", "POST", "/api/claims", { tipo: "artist", slug: A_SIN_DUENO, nota: NOTA });
  chk("segundo reclamo, otro perfil -> 200", r2.status === 200, JSON.stringify(r2.data));
  const r3 = await req("rec", "POST", "/api/claims", { tipo: "collective", slug: C_FANTASMA, nota: NOTA });
  chk("tercero -> 200", r3.status === 200, JSON.stringify(r3.data));

  // Un cuarto perfil para intentar pasarse del tope.
  await sql`INSERT INTO artists (slug, name, genre, city, bio, joined_at, district, status, review_status)
            VALUES ('zz-rec-cuarto','ZZ Cuarto','techno','Bogota','fixture','2026-01-01','06','published','aprobado')`;
  const r4 = await req("rec", "POST", "/api/claims", { tipo: "artist", slug: "zz-rec-cuarto", nota: NOTA });
  chk("el CUARTO -> 409 por el tope", r4.status === 409, JSON.stringify(r4.data));
  chk("y el mensaje dice cuál es el máximo",
    String(r4.data?.error ?? "").includes("3"), String(r4.data?.error));
  chk("quedaron 3 abiertos y no 4",
    (await sql`SELECT count(*)::int n FROM profile_ownership WHERE kind='reclamo' AND lower(to_email)=${RECLAMANTE}
               AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`)[0].n === 3);
}

console.log("\n=== EL PERFIL NO PUBLICA EL NÚMERO ===");
{
  const t = texto(await (await fetch(`${BASE}/artistas/${A_FANTASMA}`)).text());
  chk("dice que hay una solicitud en revisión",
    t.includes("Hay una solicitud de propiedad en revisión"), t.slice(0, 160));
  chk("NO publica un conteo", !/\d+ reclamo/.test(t), (t.match(/\d+ reclamo[^.]*/) ?? [""])[0]);
}

console.log("\n=== RECHAZAR Y APROBAR ===");
{
  const sinMotivo = await req("mod", "PATCH", `/api/claims/${reclamoId}`, { accion: "rechazar", motivo: "no" });
  chk("rechazar sin motivo -> 400", sinMotivo.status === 400, String(sinMotivo.status));

  const ajeno = await req("rec", "PATCH", `/api/claims/${reclamoId}`, { accion: "aprobar" });
  chk("un no-moderador no responde -> 403", ajeno.status === 403, String(ajeno.status));

  const ap = await req("mod", "PATCH", `/api/claims/${reclamoId}`, { accion: "aprobar", motivo: "Lo cruce con su instagram" });
  chk("aprobar -> 200", ap.status === 200, JSON.stringify(ap.data));
  chk("EL PERFIL YA ES DEL RECLAMANTE",
    String((await sql`SELECT owner_email FROM artists WHERE slug=${A_FANTASMA}`)[0].owner_email).toLowerCase() === RECLAMANTE);
  const [f] = await sql`SELECT accepted_at, decided_by FROM profile_ownership WHERE id=${reclamoId}`;
  chk("el reclamo quedó aceptado", f?.accepted_at !== null);
  chk("con quién decidió", String(f?.decided_by).toLowerCase() === MOD);
  /**
   * Scopeado por REFERENCIA y no un conteo global de la tabla. La primera
   * versión contaba todos los avisos tipo reclamo_aprobado que hubiera:
   * pasaba sola y fallaba en la suite, porque mail_outbox no estaba en la
   * lista que el arnés limpia y las filas se acumulaban entre baterías.
   * Un conteo global es una prueba que depende del orden de las otras.
   */
  chk("y se le avisó al reclamante",
    (await sql`SELECT count(*)::int n FROM mail_outbox
               WHERE tipo='reclamo_aprobado' AND referencia=${"artist:" + A_FANTASMA}`)[0].n === 1,
    JSON.stringify(await sql`SELECT tipo, referencia FROM mail_outbox WHERE tipo='reclamo_aprobado'`));

  const otraVez = await req("mod", "PATCH", `/api/claims/${reclamoId}`, { accion: "aprobar" });
  chk("responder dos veces -> 409", otraVez.status === 409, String(otraVez.status));
}

console.log("\n=== EL RASTRO DEL TRASPASO VA DENTRO DE LA TRANSACCIÓN ===");
{
  /**
   * LA PRUEBA QUE PEDISTE: se fuerza a que el INSERT del registro falle
   * —agregando un CHECK imposible sobre kind='moderacion'— y se verifica
   * que la PROPIEDAD NO SE MOVIÓ. Si el registro estuviera fuera de la
   * transacción, el traspaso pasaría igual y quedaría sin auditoría.
   */
  const VICTIMA = "zz-rec-traspaso";
  await sql`INSERT INTO artists (slug, name, genre, city, bio, joined_at, district, owner_email, status, review_status)
            VALUES (${VICTIMA},'ZZ Traspaso','techno','Bogota','fixture','2026-01-01','06',${FANTASMA_MAIL},'published','aprobado')`;
  const antes = (await sql`SELECT owner_email FROM artists WHERE slug=${VICTIMA}`)[0].owner_email;
  chk("arranca a nombre del fantasma", antes === FANTASMA_MAIL);

  await sql`ALTER TABLE profile_ownership ADD CONSTRAINT zz_rompe_moderacion CHECK (kind <> 'moderacion')`;
  let r;
  try {
    r = await req("mod", "PATCH", "/api/admin/moderation/owner", {
      tipo: "artist", slug: VICTIMA, email: RECLAMANTE,
      motivo: "Prueba de que sin rastro no hay traspaso", modo: "todo",
    });
  } finally {
    await sql`ALTER TABLE profile_ownership DROP CONSTRAINT zz_rompe_moderacion`;
  }
  chk("con el registro roto, el traspaso FALLA", r.status >= 400, JSON.stringify(r).slice(0, 140));
  const despues = (await sql`SELECT owner_email FROM artists WHERE slug=${VICTIMA}`)[0].owner_email;
  chk("Y LA PROPIEDAD NO SE MOVIÓ", despues === FANTASMA_MAIL, String(despues));
  chk("no quedó ninguna fila de moderacion",
    (await sql`SELECT count(*)::int n FROM profile_ownership WHERE kind='moderacion' AND artist_slug=${VICTIMA}`)[0].n === 0);

  // Y ahora, sin el CHECK roto, el mismo traspaso funciona y SÍ deja rastro.
  const bien = await req("mod", "PATCH", "/api/admin/moderation/owner", {
    tipo: "artist", slug: VICTIMA, email: RECLAMANTE,
    motivo: "Prueba de que con rastro si hay traspaso", modo: "todo",
  });
  chk("sin el CHECK roto, el traspaso anda", bien.status === 200, JSON.stringify(bien.data).slice(0, 140));
  chk("la propiedad SÍ se movió",
    String((await sql`SELECT owner_email FROM artists WHERE slug=${VICTIMA}`)[0].owner_email).toLowerCase() === RECLAMANTE);
  const reg = await sql`SELECT note, decided_by, to_email FROM profile_ownership
                        WHERE kind='moderacion' AND artist_slug=${VICTIMA}`;
  chk("Y QUEDÓ EL RASTRO", reg.length === 1, String(reg.length));
  chk("con el motivo", String(reg[0]?.note).includes("con rastro"), String(reg[0]?.note));
  chk("y quién lo hizo", String(reg[0]?.decided_by).toLowerCase() === MOD);
}

console.log("\n=== LA COLA Y LA BANDEJA EN PANTALLA ===");
{
  const t = texto(await (await fetch(`${BASE}/admin/reclamos`, { headers: { cookie: ck("mod") } })).text());
  chk("la cola se ve", t.includes("RECLAMOS DE PERFIL"), t.slice(0, 120));
  chk("muestra el proveedor como señal y no como tilde",
    t.includes("email y contraseña") || t.includes("Google"), "no está la señal");
  chk("y dice que no hay verificación automática",
    t.includes("No hay verificación automática"), "no está el aviso");

  const inicio = texto(await (await fetch(`${BASE}/admin`, { headers: { cookie: ck("mod") } })).text());
  chk("el contador de reclamos está en /admin", inicio.includes("RECLAMOS"), inicio.slice(0, 200));

  const mio = texto(await (await fetch(`${BASE}/perfil?panel=mi-perfil`, { headers: { cookie: ck("rec") } })).text());
  chk("la bandeja del reclamante se ve", mio.includes("PERFILES QUE RECLAMASTE"), mio.slice(0, 200));
  chk("y muestra el aprobado", mio.includes("APROBADO"), "no aparece el estado");
}

await sql`DELETE FROM profile_ownership WHERE artist_slug LIKE 'zz-rec-%' OR collective_slug LIKE 'zz-rec-%'`;
await sql`DELETE FROM artists WHERE slug LIKE 'zz-rec-%'`;
await sql`DELETE FROM collectives WHERE slug LIKE 'zz-rec-%'`;
await sql`DELETE FROM user_profiles WHERE email = ${FANTASMA_MAIL}`;
await sql`DELETE FROM user_roles WHERE email LIKE '%@test.hotu.local'`;
const fin = await corrida.cerrar();
console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
console.log("borrado por esta corrida:", JSON.stringify(fin.borrado));
console.log("seed:", JSON.stringify(fin.estado));
process.exit(mal === 0 ? 0 : 1);
