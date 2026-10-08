/**
 * BATERÍA DE RESIDENCIAS (§8 fase 2).
 *
 * Va por HTTP con sesiones reales, como el resto de las baterías, y no
 * importando los libs: así prueba la ruta, el auth y el lib juntos, que es lo
 * que de verdad corre cuando alguien aprieta un botón. (Node tampoco puede
 * importar estos .ts: usan imports sin extensión, que ESM no resuelve.)
 *
 * Cuatro cosas:
 *
 *   1. EL INVARIANTE, estático y sin base: un solo archivo escribe
 *      kind='residente'. Es la pieza que vuelve verificable todo lo demás —
 *      sin esto, "la residencia solo se concede por oferta" es una intención.
 *   2. UN MIEMBRO NO SE ASCIENDE SOLO, y el rechazo es el mismo para todos.
 *   3. LO QUE UN RESIDENTE NO PUEDE: invitar, quitar, repartir residencias,
 *      ceder, y subir imágenes de un colectivo ajeno.
 *   4. EL FUNDADOR QUE YA ES RESIDENTE de otro colectivo: se crea igual, no se
 *      le mueve nada, y le queda una oferta.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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

/* ===================================================================
 * 1. EL INVARIANTE, ESTÁTICO
 * =================================================================== */

const RAIZ = join(import.meta.dirname, "..", "..");
const EL_UNICO = "lib/residency-offers-write.ts";

/**
 * Las migraciones quedan afuera, y hay que decir por qué o parece una excepción
 * de conveniencia: setup-miembros y setup-residentes SON el renombre, así que
 * escribir 'residente' es literalmente su trabajo. Lo que este invariante
 * protege es el código de la APLICACIÓN, el que corre cuando alguien aprieta un
 * botón. Una migración la corre una persona, a mano, con el secreto.
 */
const esMigracion = (p) => p.replace(/\\/g, "/").includes("app/api/setup-");

function fuentes(dir, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const nombre of entradas) {
    if (nombre === "node_modules" || nombre === ".next" || nombre.startsWith(".")) continue;
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (/\.(ts|tsx)$/.test(nombre)) acc.push(p);
  }
  return acc;
}

console.log("=== 1. UN SOLO ARCHIVO ESCRIBE kind='residente' ===");
{
  const archivos = [
    ...fuentes(join(RAIZ, "lib")),
    ...fuentes(join(RAIZ, "app")),
    ...fuentes(join(RAIZ, "components")),
  ].filter((p) => !esMigracion(p));

  const escritores = new Set();
  const detalle = [];

  for (const p of archivos) {
    const texto = readFileSync(p, "utf8");
    const rel = relative(RAIZ, p).replace(/\\/g, "/");

    for (const m of texto.matchAll(/SET\s+kind\s*=\s*'residente'/gi)) {
      escritores.add(rel);
      detalle.push(`${rel}: ${m[0].replace(/\s+/g, " ")}`);
    }

    /**
     * Un INSERT sobre artist_collectives que mencione 'residente' en cualquier
     * parte del statement: el valor puede estar en el VALUES, en un SELECT, o
     * varias líneas más abajo.
     */
    for (const m of texto.matchAll(/INSERT\s+INTO\s+artist_collectives[\s\S]*?`/gi)) {
      if (/'residente'/.test(m[0])) {
        escritores.add(rel);
        detalle.push(`${rel}: INSERT INTO artist_collectives con 'residente'`);
      }
    }
  }

  console.log(`   archivos escaneados: ${archivos.length}`);
  for (const d of detalle) console.log(`   escritura -> ${d}`);

  chk(
    `el único escritor es ${EL_UNICO}`,
    escritores.size === 1 && escritores.has(EL_UNICO),
    `escritores: ${[...escritores].join(", ") || "ninguno"}`
  );
  chk(
    "y encontró al menos una escritura (si no, el grep está roto y no prueba nada)",
    detalle.some((d) => d.startsWith(EL_UNICO)),
    "cero escrituras encontradas"
  );
}

/* ===================================================================
 * SESIONES
 * =================================================================== */

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
      body: new URLSearchParams({
        csrfToken,
        email,
        password: "test1234",
        redirect: "false",
        json: "true",
      }),
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

/* ===================================================================
 * FIXTURES
 *
 * Las CUENTAS son las del seed, porque tienen la contraseña que login()
 * conoce. Los PERFILES son zz-, para que el barrido por delta se los lleve.
 * =================================================================== */

const DUENO = "duena@test.hotu.local";
const DJ_MAIL = "aplicante@test.hotu.local";
const DJ2_MAIL = "usuario@test.hotu.local";

const DJ = "zz-res-dj";
const DJ2 = "zz-res-dj2";
const COL = "zz-res-col";
const COL2 = "zz-res-col2";
const VENUE = "zz-res-venue";

const corrida = await abrirCorrida(sql, "bateria de residencias");

try {
  const artista = (slug, nombre, mail) => sql`
    INSERT INTO artists (slug, name, genre, city, bio, joined_at, district, status, owner_email)
    VALUES (${slug}, ${nombre}, 'techno', 'Bogota', 'fixture', '2026-01-01', '06', 'published', ${mail})`;
  const colectivo = (slug, nombre, tipo) => sql`
    INSERT INTO collectives (slug,name,type,sector,bio,district,status,entity_kind,owner_email)
    VALUES (${slug}, ${nombre}, 'LOCAL','Bogota','','D00','published', ${tipo}, ${DUENO})`;

  await artista(DJ, "ZZ Res Uno", DJ_MAIL);
  await artista(DJ2, "ZZ Res Dos", DJ2_MAIL);
  await colectivo(COL, "ZZ Res Col", "collective");
  await colectivo(COL2, "ZZ Res Col2", "collective");
  await colectivo(VENUE, "ZZ Res Venue", "venue");

  const vincular = (art, col, kind) => sql`
    INSERT INTO artist_collectives
      (artist_slug, collective_slug, kind, from_date, accepted_at, requested_by)
    VALUES (${art}, ${col}, ${kind}, (now() AT TIME ZONE 'America/Bogota')::date, now(), 'collective') RETURNING id`;

  const [vDJ] = await vincular(DJ, COL, "miembro");
  const [vDJ2] = await vincular(DJ2, COL2, "miembro");

  chk("login del dueño", (await login("d", DUENO)) === DUENO);
  chk("login del DJ", (await login("dj", DJ_MAIL)) === DJ_MAIL);
  chk("login del DJ2", (await login("dj2", DJ2_MAIL)) === DJ2_MAIL);

  /**
   * Los DJ no pueden tener SUPER_ADMIN, o los chequeos negativos pasarían por
   * el motivo equivocado. Se comprueba en vez de suponerse: otra batería les
   * pone roles y restaurarSeed no siempre corrió.
   */
  const roles = await sql`
    SELECT email, role FROM user_roles WHERE email IN (${DJ_MAIL}, ${DJ2_MAIL})`;
  chk(
    "ningún DJ es SUPER_ADMIN (si no, los negativos pasarían por otra razón)",
    !roles.some((r) => r.role === "SUPER_ADMIN"),
    JSON.stringify(roles)
  );

  console.log("\n=== 2. UN MIEMBRO NO SE ASCIENDE SOLO ===");
  {
    const r = await req("dj", "PATCH", `/api/memberships/${vDJ.id}`, {
      action: "kind",
      kind: "residente",
    });
    chk("PATCH kind=residente -> 403", r.status === 403, JSON.stringify(r));
    const [v] = await sql`SELECT kind FROM artist_collectives WHERE id = ${vDJ.id}`;
    chk("el vínculo sigue en 'miembro'", v.kind === "miembro", `kind=${v.kind}`);

    /** Y no ganó permisos: la prueba real es intentar editar algo. */
    const edit = await req("dj", "PATCH", `/api/collectives/${COL}`, { bio: "no deberia poder" });
    chk("y NO puede editar el colectivo", edit.status === 403 || edit.status === 404, JSON.stringify(edit));
  }

  console.log("\n=== 2b. ACEPTAR UNA INVITACIÓN TAMPOCO DA LA RESIDENCIA ===");
  {
    const [pend] = await sql`
      INSERT INTO artist_collectives
        (artist_slug, collective_slug, kind, from_date, requested_by)
      VALUES (${DJ}, ${COL2}, 'miembro', (now() AT TIME ZONE 'America/Bogota')::date, 'collective') RETURNING id`;
    const r = await req("dj", "PATCH", `/api/memberships/${pend.id}`, {
      action: "accept",
      kind: "residente",
    });
    chk("accept con kind=residente -> 403, no 200 mintiendo", r.status === 403, JSON.stringify(r));
    const [v] = await sql`SELECT accepted_at, kind FROM artist_collectives WHERE id = ${pend.id}`;
    chk("y NO la aceptó de rebote", v.accepted_at === null, JSON.stringify(v));

    const limpio = await req("dj", "PATCH", `/api/memberships/${pend.id}`, { action: "accept" });
    chk("aceptar sin kind sí funciona", limpio.status === 200, JSON.stringify(limpio));
    const [v2] = await sql`SELECT kind FROM artist_collectives WHERE id = ${pend.id}`;
    chk("y queda de miembro", v2.kind === "miembro", `kind=${v2.kind}`);
  }

  console.log("\n=== 3. LA OFERTA: el dueño ofrece, el DJ acepta ===");
  let ofertaDJ2;
  {
    const ajeno = await req("dj", "POST", `/api/collectives/${COL2}/residency-offers`, {
      artistSlug: DJ,
    });
    chk("un miembro NO puede ofrecerse la residencia a sí mismo", ajeno.status === 403, JSON.stringify(ajeno));

    const r = await req("d", "POST", `/api/collectives/${COL2}/residency-offers`, {
      artistSlug: DJ2,
    });
    chk("el dueño sí puede ofrecer", r.status === 200, JSON.stringify(r));
    ofertaDJ2 = r.data.id;

    const repe = await req("d", "POST", `/api/collectives/${COL2}/residency-offers`, {
      artistSlug: DJ2,
    });
    chk("una segunda oferta abierta al mismo par -> 409", repe.status === 409, JSON.stringify(repe));

    const mias = await req("dj2", "GET", `/api/artists/${DJ2}/residency-offers`);
    chk(
      "el DJ2 la ve en su bandeja",
      mias.status === 200 && mias.data.ofertas?.some((o) => o.id === ofertaDJ2),
      JSON.stringify(mias.data)
    );
    const ajenas = await req("dj", "GET", `/api/artists/${DJ2}/residency-offers`);
    chk("y otro DJ no puede leerla", ajenas.status === 403, JSON.stringify(ajenas));

    const otro = await req("dj", "PATCH", `/api/residency-offers/${ofertaDJ2}`, { action: "aceptar" });
    chk("y otro DJ no puede aceptarla", otro.status === 403, JSON.stringify(otro));

    const acepta = await req("dj2", "PATCH", `/api/residency-offers/${ofertaDJ2}`, {
      action: "aceptar",
    });
    chk("el DJ2 la acepta", acepta.status === 200, JSON.stringify(acepta));
    const [v] = await sql`SELECT kind FROM artist_collectives WHERE id = ${vDJ2.id}`;
    chk("ahora SÍ es residente", v.kind === "residente", `kind=${v.kind}`);
    const [o] = await sql`SELECT outcome, resolved_at FROM residency_offers WHERE id = ${ofertaDJ2}`;
    chk("y la oferta quedó resuelta como 'accepted'", o.outcome === "accepted" && o.resolved_at, JSON.stringify(o));

    const devuelta = await req("dj2", "PATCH", `/api/residency-offers/${ofertaDJ2}`, {
      action: "aceptar",
    });
    chk("aceptarla dos veces -> 409", devuelta.status === 409, JSON.stringify(devuelta));
  }

  console.log("\n=== 4. LO QUE UN RESIDENTE SÍ PUEDE: editar contenido ===");
  {
    const r = await req("dj2", "PATCH", `/api/collectives/${COL2}`, { bio: "editado por el residente" });
    chk("el residente edita la info del colectivo", r.status === 200, JSON.stringify(r));
    const [c] = await sql`SELECT bio FROM collectives WHERE slug = ${COL2}`;
    chk("y el cambio quedó", c.bio === "editado por el residente", `bio=${c.bio}`);
  }

  console.log("\n=== 4b. CADA EDICIÓN QUEDA REGISTRADA CON SU AUTOR ===");
  {
    const filas = await sql`
      SELECT actor_email, actor_rol, entidad, entidad_id, accion, detalle
      FROM edit_log WHERE collective_slug = ${COL2} ORDER BY id DESC`;
    chk("la edición del residente dejó fila en edit_log", filas.length >= 1, JSON.stringify(filas));
    const ultima = filas[0];
    chk("con su email", ultima?.actor_email === DJ2_MAIL, JSON.stringify(ultima));
    chk("y con el rol 'residente', no 'dueno'", ultima?.actor_rol === "residente", JSON.stringify(ultima));
    chk("dice QUÉ campo cambió", (ultima?.detalle?.campos ?? []).includes("bio"), JSON.stringify(ultima?.detalle));
    chk(
      "y NO guarda el valor nuevo",
      !JSON.stringify(ultima?.detalle ?? {}).includes("editado por el residente"),
      "el texto editado quedó guardado en el log"
    );

    /** El dueño editando queda con rol 'dueno', no con el del residente. */
    const r = await req("d", "PATCH", `/api/collectives/${COL2}`, { bio: "editado por el dueño" });
    chk("el dueño también edita", r.status === 200, JSON.stringify(r));
    const [comoDueno] = await sql`
      SELECT actor_email, actor_rol FROM edit_log
      WHERE collective_slug = ${COL2} ORDER BY id DESC LIMIT 1`;
    chk(
      "y queda registrado como 'dueno'",
      comoDueno.actor_rol === "dueno" && comoDueno.actor_email === DUENO,
      JSON.stringify(comoDueno)
    );
  }

  console.log("\n=== 4c. EL SUPER_ADMIN EDITA, QUEDA REGISTRADO, Y NO SALE EN EL ROSTER ===");
  {
    /**
     * Se le da el rol y se le saca al final. Si la batería se cae en el medio,
     * restaurarSeed lo limpia igual: 'roles_prestados' es uno de los conteos
     * que el barrido mira.
     */
    await sql`
      INSERT INTO user_roles (email, role, country_code) VALUES (${DJ_MAIL}, 'SUPER_ADMIN', 'COL')
      ON CONFLICT DO NOTHING`;
    await login("dj", DJ_MAIL);

    const r = await req("dj", "PATCH", `/api/collectives/${COL2}`, { bio: "editado por moderación" });
    chk("el SUPER_ADMIN puede editar un colectivo ajeno", r.status === 200, JSON.stringify(r));

    const [fila] = await sql`
      SELECT actor_email, actor_rol FROM edit_log
      WHERE collective_slug = ${COL2} ORDER BY id DESC LIMIT 1`;
    chk(
      "y queda en LA MISMA tabla, con rol 'super_admin'",
      fila.actor_rol === "super_admin" && fila.actor_email === DJ_MAIL,
      JSON.stringify(fila)
    );

    /**
     * Y NO aparece en la lista pública de editores. Esa lista es el carrusel
     * RESIDENTES, que sale de artist_collectives — donde el SUPER_ADMIN no
     * tiene fila. Se mide sobre la tabla y sobre el HTML de la página, porque
     * "por construcción" es un razonamiento y esto es una comprobación.
     */
    const enRoster = await sql`
      SELECT 1 FROM artist_collectives ac
      JOIN artists a ON a.slug = ac.artist_slug
      WHERE ac.collective_slug = ${COL2} AND ac.kind = 'residente' AND ac.to_date IS NULL
        AND lower(a.owner_email) = lower(${DJ_MAIL})`;
    chk("no tiene vínculo de residente en ese colectivo", enRoster.length === 0, JSON.stringify(enRoster));

    const html = await (await fetch(`${BASE}/colectivos/${COL2}`)).text();
    chk("la página del colectivo muestra el carrusel RESIDENTES", html.includes("RESIDENTES"), "no aparece el título");

    /**
     * SE MIDE LA SECCIÓN DE RESIDENTES, NO LA PÁGINA ENTERA, y la primera
     * versión de este chequeo se equivocó justo ahí: buscaba el nombre en todo
     * el HTML y daba MAL porque el moderador ES miembro de ese colectivo y sale
     * —correctamente— en el carrusel MIEMBROS. Preguntar "¿aparece en la
     * página?" no es preguntar "¿aparece como editor?".
     */
    /**
     * LOS NOMBRES DE LOS FIXTURES NO PUEDEN SER PREFIJO UNO DEL OTRO, y esto
     * costó una corrida: se llamaban "ZZ Res DJ" y "ZZ Res DJ2", y buscar el
     * primero encontraba al segundo. El chequeo daba MAL diciendo que el
     * moderador figuraba entre los residentes cuando el que figuraba era el
     * residente de verdad. Es la misma familia que el filesystem de Windows que
     * no distingue mayúsculas: el nombre salía de algo que el test varía, así
     * que la herramienta no falló — contestó mal.
     */
    const desde = html.indexOf("RESIDENTES");
    const hasta = html.indexOf("MIEMBROS", desde);
    const seccionResidentes = desde >= 0 ? html.slice(desde, hasta > desde ? hasta : undefined) : "";
    chk(
      "y NO figura en la sección RESIDENTES",
      seccionResidentes.length > 0 && !seccionResidentes.includes("ZZ Res Uno"),
      `la sección de residentes nombra al moderador: ${seccionResidentes.slice(0, 200)}`
    );
    chk(
      "mientras que SÍ sigue saliendo como miembro, que es lo que es",
      html.includes("ZZ Res Uno"),
      "desapareció del roster: el chequeo de arriba estaría pasando por la razón equivocada"
    );

    await sql`DELETE FROM user_roles WHERE email = ${DJ_MAIL} AND role = 'SUPER_ADMIN'`;
    await login("dj", DJ_MAIL);
  }

  console.log("\n=== 5. LO QUE UN RESIDENTE NO PUEDE ===");
  {
    const invitar = await req("dj2", "POST", "/api/memberships", {
      collectiveSlug: COL2,
      artistSlug: DJ,
      requestedBy: "collective",
    });
    chk("NO puede invitar", invitar.status === 403, JSON.stringify(invitar));

    const quitar = await req("dj2", "DELETE", `/api/collectives/${COL2}/members/${DJ}`);
    chk("NO puede quitar a otro miembro", quitar.status === 403, JSON.stringify(quitar));

    const repartir = await req("dj2", "POST", `/api/collectives/${COL2}/residency-offers`, {
      artistSlug: DJ,
    });
    chk(
      "NO puede ofrecer residencias: no reparte su propio permiso",
      repartir.status === 403,
      JSON.stringify(repartir)
    );

    const verOfertas = await req("dj2", "GET", `/api/collectives/${COL2}/residency-offers`);
    chk("NO puede ver a quién le ofrecieron la residencia", verOfertas.status === 403, JSON.stringify(verOfertas));

    const ceder = await req("dj2", "PATCH", `/api/collectives/${COL2}/owner`, {
      email: DJ_MAIL,
    });
    chk("NO puede ceder el colectivo", ceder.status === 403, JSON.stringify(ceder));

    /** Subir imágenes: solo donde ES residente, no en cualquiera. */
    const subirAjeno = await req("dj2", "POST", `/api/upload?tipo=collective&slug=${COL}`, {});
    chk(
      "NO puede subir imágenes a un colectivo donde no es nada",
      subirAjeno.status === 403 || subirAjeno.status === 400,
      JSON.stringify(subirAjeno)
    );
  }

  console.log("\n=== 6. UN VENUE NO ES LA RESIDENCIA DE NADIE ===");
  {
    await vincular(DJ, VENUE, "miembro");
    const r = await req("d", "POST", `/api/collectives/${VENUE}/residency-offers`, {
      artistSlug: DJ,
    });
    chk("no se puede ofrecer residencia en un venue -> 400", r.status === 400, JSON.stringify(r));
  }

  console.log("\n=== 7. EL FUNDADOR QUE YA ES RESIDENTE DE OTRO COLECTIVO ===");
  {
    const antes = await sql`
      SELECT collective_slug FROM artist_collectives
      WHERE artist_slug = ${DJ2} AND kind = 'residente' AND to_date IS NULL`;
    chk("parte siendo residente de COL2", antes.length === 1 && antes[0].collective_slug === COL2, JSON.stringify(antes));

    const creado = await req("dj2", "POST", "/api/collectives", {
      name: "ZZ Res Fundado",
      entityKind: "collective",
      primaryBranch: "ACI",
      tags: [
        { slug: "acid-bass", branchCode: "ACI" },
        { slug: "acid-breaks", branchCode: "ACI" },
        { slug: "acid-disco", branchCode: "ACI" },
      ],
    });
    chk("crear el colectivo NO falla", creado.status === 201, JSON.stringify(creado).slice(0, 200));

    if (creado.status === 201) {
      const nuevo = creado.data.slug;
      chk("entra como 'miembro' del nuevo", creado.data.kind === "miembro", `kind=${creado.data.kind}`);

      const despues = await sql`
        SELECT collective_slug FROM artist_collectives
        WHERE artist_slug = ${DJ2} AND kind = 'residente' AND to_date IS NULL`;
      chk(
        "su residencia NO se movió: sigue en COL2",
        despues.length === 1 && despues[0].collective_slug === COL2,
        JSON.stringify(despues)
      );

      const pendiente = creado.data.ofertaPendiente;
      chk("le quedó una oferta, y no un silencio", Boolean(pendiente?.id), JSON.stringify(pendiente));
      chk("la oferta dice cuál es su residencia actual", pendiente?.actual?.slug === COL2, JSON.stringify(pendiente));

      const mias = await req("dj2", "GET", `/api/artists/${DJ2}/residency-offers`);
      chk(
        "aparece en su bandeja",
        mias.data.ofertas?.some((o) => o.collectiveSlug === nuevo),
        JSON.stringify(mias.data.ofertas?.map((o) => o.collectiveSlug))
      );

      /** IGNORARLA no rompe nada. */
      const [d] = await sql`SELECT owner_email FROM collectives WHERE slug = ${nuevo}`;
      chk("ignorándola, sigue siendo dueño del nuevo", d.owner_email === DJ2_MAIL, `dueno=${d.owner_email}`);

      /** ACEPTAR sin decidir devuelve el conflicto y no mueve nada. */
      const sinDecidir = await req("dj2", "PATCH", `/api/residency-offers/${pendiente.id}`, {
        action: "aceptar",
      });
      chk(
        "aceptar sin decidir devuelve el conflicto",
        sinDecidir.status === 200 && sinDecidir.data.conflict === "residencia",
        JSON.stringify(sinDecidir)
      );
      const todavia = await sql`
        SELECT collective_slug FROM artist_collectives
        WHERE artist_slug = ${DJ2} AND kind = 'residente' AND to_date IS NULL`;
      chk("y NO movió nada", todavia[0]?.collective_slug === COL2, JSON.stringify(todavia));

      /** Con la decisión sí se mueve. */
      const conDecision = await req("dj2", "PATCH", `/api/residency-offers/${pendiente.id}`, {
        action: "aceptar",
        decision: { respuesta: "renunciar", anterior: "miembro" },
      });
      chk("renunciando a la anterior, se mueve", conDecision.status === 200, JSON.stringify(conDecision));

      const final = await sql`
        SELECT collective_slug, kind FROM artist_collectives
        WHERE artist_slug = ${DJ2} AND to_date IS NULL ORDER BY collective_slug`;
      const residencias = final.filter((f) => f.kind === "residente");
      chk(
        "es residente del nuevo y de nada más",
        residencias.length === 1 && residencias[0].collective_slug === nuevo,
        JSON.stringify(final)
      );
      chk(
        "y en COL2 quedó de miembro, porque eso eligió",
        final.some((f) => f.collective_slug === COL2 && f.kind === "miembro"),
        JSON.stringify(final)
      );
      chk(
        "una sola residencia activa en total, siempre",
        residencias.length === 1,
        `${residencias.length} residencias`
      );
    }
  }

  console.log("\n=== 8. RENUNCIAR SIEMPRE SE PUEDE ===");
  {
    const [v] = await sql`
      SELECT id, collective_slug FROM artist_collectives
      WHERE artist_slug = ${DJ2} AND kind = 'residente' AND to_date IS NULL`;
    const r = await req("dj2", "PATCH", `/api/memberships/${v.id}`, {
      action: "kind",
      kind: "miembro",
    });
    chk("bajar a miembro -> 200", r.status === 200, JSON.stringify(r));
    const [k] = await sql`SELECT kind FROM artist_collectives WHERE id = ${v.id}`;
    chk("quedó de miembro", k.kind === "miembro", `kind=${k.kind}`);
    const [n] = await sql`
      SELECT COUNT(*)::int AS n FROM artist_collectives
      WHERE artist_slug = ${DJ2} AND kind = 'residente' AND to_date IS NULL`;
    chk("y no le quedó ninguna residencia", n.n === 0, `${n.n} residencias`);
  }
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
