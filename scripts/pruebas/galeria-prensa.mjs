/**
 * GALERÍA Y PRENSA DEL EPK.
 *
 * Lo que de verdad hay que medir acá, en orden de cuánto me preocupa:
 *
 *   EL TOPE DE 12, Y QUE SEA ATÓMICO. No se puede expresar como CHECK —Postgres rechaza
 *   subconsultas en un constraint— así que vive en el write path, adentro del INSERT. Se
 *   prueba la 13 secuencial, y además DOCE SUBIDAS A LA VEZ sobre una galería vacía: si el
 *   conteo estuviera fuera del INSERT, varias verían el mismo número y entrarían de más.
 *
 *   EL slug EN EL WHERE del borrado. Sin él, el dueño de un perfil podría borrar la foto de
 *   otro mandando un id ajeno: la autorización dice que puede editar ESTE perfil, no
 *   cualquiera. Se prueba con dos artistas de dueños distintos.
 *
 *   QUE LAS DOS SECCIONES NO SE VEAN VACÍAS a un visitante, y sí al dueño. Es la regla de
 *   UI del EPK.
 *
 *   Y la validación: solo http(s) llega a un href, el medio es obligatorio, la fecha es
 *   opcional pero si viene tiene que ser real.
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

const DUENO = "artista@test.hotu.local";
const OTRA = "duena@test.hotu.local";
const ART = "test-camila";
/** Nombres con palabras distintas, nunca uno prefijo del otro. */
const ART_AJENO = "zz-galeria-otro";
const FOTO = "https://example.com/zz-foto-uno.webp";

const corrida = await abrirCorrida(sql, "galeria y prensa");

const fotos = (slug) => sql`SELECT id, url, credit, sort_order FROM artist_photos WHERE artist_slug = ${slug} ORDER BY id`;
const notas = (slug) => sql`SELECT id, outlet, url, published_at FROM artist_press WHERE artist_slug = ${slug} ORDER BY id`;

try {
  chk("login del dueño", (await login("d", DUENO)) === DUENO);
  chk("login de la otra cuenta", (await login("o", OTRA)) === OTRA);

  await sql`DELETE FROM artist_photos WHERE artist_slug = ${ART}`;
  await sql`DELETE FROM artist_press WHERE artist_slug = ${ART}`;

  console.log("\n=== 1. SE AGREGA, SE LEE Y SE BORRA UNA FOTO ===");
  {
    const r = await req("d", "POST", `/api/artists/${ART}/photos`, { url: FOTO, credit: "ZZ Fotografa" });
    chk("crear una foto -> 201", r.status === 201, JSON.stringify(r));
    const f = await fotos(ART);
    chk("quedó una fila", f.length === 1, String(f.length));
    chk("con su url", f[0]?.url === FOTO, f[0]?.url);
    chk("y su crédito", f[0]?.credit === "ZZ Fotografa", f[0]?.credit);
    chk("sin posición manual (sort_order NULL)", f[0]?.sort_order === null, String(f[0]?.sort_order));

    const sinCredito = await req("d", "POST", `/api/artists/${ART}/photos`, { url: "https://example.com/zz-foto-dos.webp" });
    chk("el crédito es OPCIONAL -> 201", sinCredito.status === 201, JSON.stringify(sinCredito));
    chk("y queda en NULL", (await fotos(ART))[1]?.credit === null);

    const d = await req("d", "DELETE", `/api/artists/${ART}/photos/${r.data.id}`);
    chk("borrar -> 200", d.status === 200, JSON.stringify(d));
    chk("quedó una sola", (await fotos(ART)).length === 1);
  }

  console.log("\n=== 2. SOLO http(s) LLEGA A UN src ===");
  {
    for (const [u, que] of [
      ["javascript:alert(1)", "javascript:"],
      ["data:image/png;base64,AAA", "data:"],
      ["ftp://example.com/a.jpg", "ftp:"],
      ["no-es-una-url", "texto cualquiera"],
      ["", "vacía"],
    ]) {
      const r = await req("d", "POST", `/api/artists/${ART}/photos`, { url: u });
      chk(`${que} -> 400`, r.status === 400, JSON.stringify(r));
    }
    chk("y ninguna entró", (await fotos(ART)).length === 1, String((await fotos(ART)).length));
  }

  console.log("\n=== 3. EL TOPE DE 12, SECUENCIAL ===");
  {
    await sql`DELETE FROM artist_photos WHERE artist_slug = ${ART}`;
    for (let i = 1; i <= 12; i++) {
      const r = await req("d", "POST", `/api/artists/${ART}/photos`, { url: `https://example.com/zz-f${i}.webp` });
      if (r.status !== 201) {
        chk(`la foto ${i} entra`, false, JSON.stringify(r));
        break;
      }
    }
    chk("entraron 12", (await fotos(ART)).length === 12, String((await fotos(ART)).length));

    const trece = await req("d", "POST", `/api/artists/${ART}/photos`, { url: "https://example.com/zz-f13.webp" });
    chk("LA 13 -> 409", trece.status === 409, JSON.stringify(trece));
    chk("y el mensaje dice el número", /12/.test(trece.data?.error ?? ""), trece.data?.error);
    chk("siguen siendo 12", (await fotos(ART)).length === 12, String((await fotos(ART)).length));

    /** Borrar una libera un lugar: el tope es un tope, no un contador de subidas. */
    const f = await fotos(ART);
    await req("d", "DELETE", `/api/artists/${ART}/photos/${f[0].id}`);
    const otra = await req("d", "POST", `/api/artists/${ART}/photos`, { url: "https://example.com/zz-f14.webp" });
    chk("borrando una, entra otra -> 201", otra.status === 201, JSON.stringify(otra));
    chk("y vuelven a ser 12", (await fotos(ART)).length === 12, String((await fotos(ART)).length));
  }

  console.log("\n=== 4. EL TOPE AGUANTA DOCE SUBIDAS A LA VEZ ===");
  {
    /**
     * ESTE ES EL CHEQUEO QUE JUSTIFICA EL DISEÑO. Con el conteo FUERA del INSERT —un COUNT
     * y después un INSERT, dos requests— varias de estas verían el mismo número y
     * entrarían de más. Con el conteo adentro del WHERE del INSERT, no puede pasar.
     *
     * Se lanzan 20 sobre una galería vacía: tienen que entrar exactamente 12.
     */
    await sql`DELETE FROM artist_photos WHERE artist_slug = ${ART}`;
    const todas = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        req("d", "POST", `/api/artists/${ART}/photos`, { url: `https://example.com/zz-par${i}.webp` })
      )
    );
    const creadas = todas.filter((r) => r.status === 201).length;
    const rechazadas = todas.filter((r) => r.status === 409).length;
    const guardadas = (await fotos(ART)).length;
    chk("EN LA BASE QUEDARON EXACTAMENTE 12", guardadas === 12, `quedaron ${guardadas}`);
    chk("la API dijo 201 doce veces", creadas === 12, String(creadas));
    chk("y 409 las otras ocho", rechazadas === 8, String(rechazadas));
  }

  console.log("\n=== 5. UN id AJENO NO SE PUEDE BORRAR ===");
  {
    /**
     * Dos artistas de DUEÑOS DISTINTOS. El de la otra cuenta tiene una foto, y el dueño
     * del primero intenta borrarla por id. Sin el artist_slug en el WHERE, saldría.
     */
    await sql`INSERT INTO artists (slug, name, genre, district, city, bio, joined_at, status, review_status, owner_email)
              VALUES (${ART_AJENO}, 'ZZ Galeria Otro', 'techno', 'D00', 'Bogota', 'bio', CURRENT_DATE, 'published', 'aprobado', ${OTRA})
              ON CONFLICT (slug) DO UPDATE SET owner_email = ${OTRA}`;
    const suya = await req("o", "POST", `/api/artists/${ART_AJENO}/photos`, { url: "https://example.com/zz-ajena.webp" });
    chk("la otra cuenta sube una foto a SU artista -> 201", suya.status === 201, JSON.stringify(suya));

    const robo = await req("d", "DELETE", `/api/artists/${ART}/photos/${suya.data.id}`);
    chk("el dueño del otro perfil la borra por id -> 404", robo.status === 404, JSON.stringify(robo));
    chk("y la foto ajena SIGUE AHÍ", (await fotos(ART_AJENO)).length === 1, String((await fotos(ART_AJENO)).length));

    /** Y por la ruta del perfil ajeno tampoco: ahí la puerta es la autorización. */
    const porLaRutaAjena = await req("d", "DELETE", `/api/artists/${ART_AJENO}/photos/${suya.data.id}`);
    chk("y por la ruta del perfil ajeno -> 403", porLaRutaAjena.status === 403, JSON.stringify(porLaRutaAjena));
    chk("la foto ajena sigue ahí", (await fotos(ART_AJENO)).length === 1);
  }

  console.log("\n=== 6. PRENSA: MEDIO OBLIGATORIO, FECHA OPCIONAL ===");
  {
    const r = await req("d", "POST", `/api/artists/${ART}/press`, {
      outlet: "ZZ Revista",
      url: "https://example.com/zz-nota",
      publishedAt: "2026-02-14",
    });
    chk("crear una nota -> 201", r.status === 201, JSON.stringify(r));
    const n = await notas(ART);
    chk("quedó con su medio", n[0]?.outlet === "ZZ Revista", n[0]?.outlet);
    /**
     * LA FECHA SE COMPARA CONTRA LO QUE DEVUELVE EL LECTOR, no contra el Date crudo del
     * driver. Una columna DATE vuelve como objeto Date, así que String(ese Date) da
     * "Sat Feb 14 2026 00:00:00 GMT-0500" y la comparación con "2026-02-14" fallaba — la
     * fecha guardada estaba perfecta, la aserción no.
     *
     * Y comparar contra el lector es lo que de verdad importa: lo que la página muestra
     * sale de getPressByArtist, que pasa por toISODate. MEDIDO de paso que ese camino no
     * corre la fecha un día en las dos zonas que nos tocan —Bogotá en dev y UTC en Vercel—
     * aunque sí la correría en un server ADELANTADO de UTC, porque toISODate va por
     * toISOString(). No se puede disparar hoy; queda anotado y no se toca acá, que es una
     * función que usan todas las fechas del sitio.
     */
    const [fila] = await sql`SELECT to_char(published_at, 'YYYY-MM-DD') AS f FROM artist_press WHERE id = ${r.data.id}`;
    chk("y su fecha, preguntada a Postgres en texto", fila?.f === "2026-02-14", String(fila?.f));

    const sinFecha = await req("d", "POST", `/api/artists/${ART}/press`, { outlet: "ZZ Blog", url: "https://example.com/zz-blog" });
    chk("sin fecha -> 201", sinFecha.status === 201, JSON.stringify(sinFecha));
    chk("y la fecha queda NULL, no hoy", (await notas(ART))[1]?.published_at === null, String((await notas(ART))[1]?.published_at));

    for (const [b, que] of [
      [{ url: "https://example.com/x" }, "sin medio"],
      [{ outlet: "   ", url: "https://example.com/x" }, "medio de blancos"],
      [{ outlet: "\u00A0\u00A0", url: "https://example.com/x" }, "medio de espacios DUROS"],
      [{ outlet: "ZZ X", url: "javascript:alert(1)" }, "url javascript:"],
      [{ outlet: "ZZ X" }, "sin url"],
      [{ outlet: "ZZ X", url: "https://example.com/x", publishedAt: "2026-02-30" }, "fecha que no existe"],
      [{ outlet: "ZZ X", url: "https://example.com/x", publishedAt: "14/02/2026" }, "fecha con otro formato"],
    ]) {
      const bad = await req("d", "POST", `/api/artists/${ART}/press`, b);
      chk(`${que} -> 400`, bad.status === 400, JSON.stringify(bad));
    }
    chk("y siguen siendo 2 notas", (await notas(ART)).length === 2, String((await notas(ART)).length));

    const d = await req("d", "DELETE", `/api/artists/${ART}/press/${r.data.id}`);
    chk("borrar una nota -> 200", d.status === 200, JSON.stringify(d));
    chk("queda una", (await notas(ART)).length === 1);
  }

  console.log("\n=== 7. PERMISOS ===");
  {
    const sin = await req(null, "POST", `/api/artists/${ART}/photos`, { url: "https://example.com/zz-sin.webp" });
    chk("subir sin sesión -> 401", sin.status === 401, JSON.stringify(sin));
    const sinP = await req(null, "POST", `/api/artists/${ART}/press`, { outlet: "X", url: "https://example.com/x" });
    chk("prensa sin sesión -> 401", sinP.status === 401, JSON.stringify(sinP));

    const tercero = await req("o", "POST", `/api/artists/${ART}/photos`, { url: "https://example.com/zz-intrusa.webp" });
    chk("un tercero logueado subiendo a un perfil ajeno -> 403", tercero.status === 403, JSON.stringify(tercero));
    const terceroP = await req("o", "POST", `/api/artists/${ART}/press`, { outlet: "ZZ Intruso", url: "https://example.com/x" });
    chk("y una nota -> 403", terceroP.status === 403, JSON.stringify(terceroP));
    chk("no quedó nada del intruso", !(await notas(ART)).some((x) => x.outlet === "ZZ Intruso"));
  }

  console.log("\n=== 8. UN id QUE NO ES UN NÚMERO ES 404, NO 500 ===");
  {
    for (const id of ["abc", "0", "-1", "1.5"]) {
      const r = await req("d", "DELETE", `/api/artists/${ART}/photos/${id}`);
      chk(`id '${id}' -> 404`, r.status === 404, JSON.stringify(r));
    }
  }

  console.log("\n=== 9. EN LA PÁGINA ===");
  {
    /**
     * SE CREA LO QUE ESTA SECCIÓN NECESITA, en vez de apoyarse en lo que dejó la 6. La
     * primera versión buscaba la fecha de la nota de la sección 6 y fallaba: esa sección
     * TERMINA borrándola —su último chequeo es "borrar una nota"— así que para cuando llega
     * acá no queda ninguna nota fechada.
     *
     * Es el segundo caso igual en esta misma sesión, con la bio del rider. La regla: una
     * sección que se apoya en el estado final de otra se rompe cuando la otra crece un
     * paso, y el síntoma aparece acá, lejos de la causa.
     */
    /**
     * Y SE PARTE DE CERO, que fue el segundo tropiezo de esta misma sección: la 4 deja 12
     * fotos —el tope— así que la foto de esta sección era la 13 y el 409 la rechazaba. El
     * crédito no aparecía en la página porque la foto no existía. Útil al revés: confirmó
     * que el tope funciona incluso cuando el que choca con él es el propio test.
     */
    await sql`DELETE FROM artist_photos WHERE artist_slug = ${ART}`;
    await sql`DELETE FROM artist_press WHERE artist_slug = ${ART}`;
    await req("d", "POST", `/api/artists/${ART}/photos`, { url: "https://example.com/zz-pag.webp", credit: "ZZ Credito Visible" });
    await req("d", "POST", `/api/artists/${ART}/press`, {
      outlet: "ZZ Medio Fechado",
      url: "https://example.com/zz-fechada",
      publishedAt: "2026-02-14",
    });

    const html = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    chk("la sección GALERÍA aparece", html.includes("GALERÍA"), "no aparece");
    chk("la sección PRENSA aparece", html.includes("PRENSA"), "no aparece");
    chk("el medio se ve", html.includes("ZZ Medio Fechado"), "no está el medio");
    chk("LA FECHA SE VE Y NO CORRIDA", html.includes("2026-02-14"), "no sale, o sale otro día");
    chk("y el crédito del fotógrafo también", html.includes("ZZ Credito Visible"), "no está el crédito");

    /** Vacías y sin sesión: no se muestran. Es la regla de UI del EPK. */
    await sql`DELETE FROM artist_photos WHERE artist_slug = ${ART}`;
    await sql`DELETE FROM artist_press WHERE artist_slug = ${ART}`;
    const vacio = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    chk("vacías y sin sesión: GALERÍA no se muestra", !vacio.includes("GALERÍA"), "se muestra igual");
    chk("ni PRENSA", !vacio.includes("PRENSA"), "se muestra igual");
    chk("y la página sigue en pie", vacio.includes("</html>"), "se rompió");

    /** Al dueño SÍ, porque para él el vacío es una invitación a completar. */
    const comoDueno = await (await fetch(`${BASE}/artistas/${ART}`, { headers: { cookie: ck("d") } })).text();
    chk("al dueño SÍ se le muestran vacías", comoDueno.includes("GALERÍA") && comoDueno.includes("PRENSA"), "no se le muestran");
  }

  console.log("\n=== 10. EL REORDEN: LA LISTA ENTERA, DE UNA ===");
  {
    await sql`DELETE FROM artist_photos WHERE artist_slug = ${ART}`;
    const ids = [];
    for (const n of ["uno", "dos", "tres", "cuatro"]) {
      const r = await req("d", "POST", `/api/artists/${ART}/photos`, { url: `https://example.com/zz-ord-${n}.webp` });
      ids.push(r.data.id);
    }
    chk("cuatro fotos creadas", ids.length === 4 && ids.every(Boolean), JSON.stringify(ids));

    const alRevés = [...ids].reverse();
    const r = await req("d", "PUT", `/api/artists/${ART}/photos`, { ids: alRevés });
    chk("PUT con el orden invertido -> 200", r.status === 200, JSON.stringify(r));
    chk("dice que movió las cuatro", r.data?.movidas === 4, JSON.stringify(r.data));

    const leidas = await sql`
      SELECT id, sort_order FROM artist_photos WHERE artist_slug = ${ART}
      ORDER BY sort_order ASC NULLS LAST, created_at DESC`;
    chk(
      "EL LECTOR LAS DEVUELVE EN EL ORDEN NUEVO",
      JSON.stringify(leidas.map((x) => x.id)) === JSON.stringify(alRevés),
      JSON.stringify(leidas.map((x) => x.id))
    );
    chk("y el sort_order quedó 0,1,2,3 sin huecos", JSON.stringify(leidas.map((x) => x.sort_order)) === "[0,1,2,3]", JSON.stringify(leidas.map((x) => x.sort_order)));

    /**
     * EXIGE LA LISTA COMPLETA. Mandar de menos dejaría a las que faltan con su sort_order
     * viejo, y la lista quedaría mezclada de dos órdenes distintos. Suele significar que la
     * página estaba vieja, y ahí lo correcto es recargar y no escribir a medias.
     */
    const incompleto = await req("d", "PUT", `/api/artists/${ART}/photos`, { ids: ids.slice(0, 2) });
    chk("mandar solo 2 de 4 -> 409", incompleto.status === 409, JSON.stringify(incompleto));
    chk("y el mensaje manda a recargar", /recarg/i.test(incompleto.data?.error ?? ""), incompleto.data?.error);

    const conAjeno = await req("d", "PUT", `/api/artists/${ART}/photos`, { ids: [...ids.slice(0, 3), 999999] });
    chk("con un id que no es de este perfil -> 409", conAjeno.status === 409, JSON.stringify(conAjeno));

    const repetido = await req("d", "PUT", `/api/artists/${ART}/photos`, { ids: [ids[0], ids[0], ids[1], ids[2]] });
    chk("con un id repetido -> 400", repetido.status === 400, JSON.stringify(repetido));

    for (const [b, que] of [
      [{ ids: [] }, "lista vacía"],
      [{ ids: "no-es-lista" }, "no es lista"],
      [{}, "sin ids"],
      [{ ids: [1, "abc"] }, "un id que no es número"],
      [{ ids: [1, 0] }, "un id en cero"],
    ]) {
      const bad = await req("d", "PUT", `/api/artists/${ART}/photos`, b);
      chk(`${que} -> 400`, bad.status === 400, JSON.stringify(bad));
    }

    /** Y después de todos los rechazos, el orden bueno sigue intacto. */
    const despues = await sql`
      SELECT id FROM artist_photos WHERE artist_slug = ${ART}
      ORDER BY sort_order ASC NULLS LAST, created_at DESC`;
    chk(
      "NINGÚN RECHAZO TOCÓ EL ORDEN",
      JSON.stringify(despues.map((x) => x.id)) === JSON.stringify(alRevés),
      JSON.stringify(despues.map((x) => x.id))
    );
  }

  console.log("\n=== 11. EL REORDEN DE PRENSA, Y SUS PERMISOS ===");
  {
    await sql`DELETE FROM artist_press WHERE artist_slug = ${ART}`;
    const ids = [];
    for (const m of ["ZZ Medio Alfa", "ZZ Medio Beta", "ZZ Medio Gama"]) {
      const r = await req("d", "POST", `/api/artists/${ART}/press`, { outlet: m, url: `https://example.com/${encodeURIComponent(m)}` });
      ids.push(r.data.id);
    }
    chk("tres notas creadas", ids.every(Boolean), JSON.stringify(ids));

    const nuevo = [ids[2], ids[0], ids[1]];
    const r = await req("d", "PUT", `/api/artists/${ART}/press`, { ids: nuevo });
    chk("PUT del orden -> 200", r.status === 200, JSON.stringify(r));
    const leidas = await sql`
      SELECT id FROM artist_press WHERE artist_slug = ${ART}
      ORDER BY sort_order ASC NULLS LAST, published_at DESC NULLS LAST`;
    chk("quedaron en el orden pedido", JSON.stringify(leidas.map((x) => x.id)) === JSON.stringify(nuevo), JSON.stringify(leidas.map((x) => x.id)));

    const sin = await req(null, "PUT", `/api/artists/${ART}/press`, { ids: nuevo });
    chk("reordenar sin sesión -> 401", sin.status === 401, JSON.stringify(sin));
    const tercero = await req("o", "PUT", `/api/artists/${ART}/press`, { ids: nuevo });
    chk("un tercero reordenando lo ajeno -> 403", tercero.status === 403, JSON.stringify(tercero));
    const fotosAjenas = await req("o", "PUT", `/api/artists/${ART}/photos`, { ids: [1] });
    chk("y las fotos ajenas tampoco -> 403", fotosAjenas.status === 403, JSON.stringify(fotosAjenas));
  }

  console.log("\n=== 12. LAS FLECHAS EXISTEN EN EL HTML, NO SOLO EL ARRASTRE ===");
  {
    /**
     * El arrastre nativo NO FUNCIONA EN TOUCH, así que una lista que solo se reordena
     * arrastrando no se reordena en un celular. Esto comprueba que los botones están en el
     * HTML que recibe el dueño: es lo único de la accesibilidad del reorden que se puede
     * medir sin un navegador.
     */
    const html = await (await fetch(`${BASE}/artistas/${ART}`, { headers: { cookie: ck("d") } })).text();
    chk("hay botón de mover una foto antes", html.includes("Mover la foto antes"), "no está");
    chk("y después", html.includes("Mover la foto despu"), "no está");
    chk("hay botón de subir una nota", /Subir la nota de/.test(html), "no está");
    chk("y de bajarla", /Bajar la nota de/.test(html), "no está");
    chk("y las filas quedan arrastrables", /draggable="true"/.test(html), "no hay nada draggable");

    /** A un visitante NO: draggable sin permiso de editar solo despega la imagen. */
    const visitante = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    chk("un visitante no recibe botones de mover", !visitante.includes("Mover la foto antes"), "los recibe");
    chk("ni filas arrastrables", !/draggable="true"/.test(visitante), "las recibe");
  }

  await sql`DELETE FROM artist_photos WHERE artist_slug = ${ART_AJENO}`;
  await sql`DELETE FROM artists WHERE slug = ${ART_AJENO}`;
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
