/**
 * EL RIDER TÉCNICO: híbrido, normalizado, y que no se lo lleve otro guardado.
 *
 * Lo que se mide, y por qué cada cosa:
 *
 *   La NORMALIZACIÓN es la pieza frágil. La columna es jsonb, así que la base acepta
 *   cualquier forma: si el write path guardara crudo, un campo de más viajaría hasta la
 *   página. Se prueba que lo que no reconoce se descarta, que los textos se recortan, y que
 *   la cantidad fuera de rango no entra.
 *
 *   La INDEPENDENCIA entre secciones. El EPK guarda por sección con un PATCH parcial, así
 *   que un guardado de "sobre mí" no puede borrar el rider y viceversa. Es el mismo bug que
 *   ya apareció de verdad con door_price_cop en los eventos: un SELECT que no nombraba la
 *   columna la borraba en cada edición.
 *
 *   El VACIADO. Mandar el rider con todo en blanco TIENE que borrarlo: es la única manera
 *   que tiene el DJ de sacarlo, y un patch que "no hace nada" cuando está vacío deja un
 *   rider que no se puede borrar.
 *
 *   Y LOS PERMISOS, que son lo que no se puede dar por sentado nunca: el rider es contenido
 *   del perfil, así que lo edita su dueño y el SUPER_ADMIN, y NADIE más.
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

/** Nombres con palabras DISTINTAS, no numeradas: "Uno"/"Uno2" se matchean entre sí. */
const DUENO = "artista@test.hotu.local";
const ART = "test-camila";

const corrida = await abrirCorrida(sql, "rider tecnico");

const riderDe = async (slug) => {
  const [a] = await sql`SELECT rider FROM artists WHERE slug = ${slug}`;
  return a?.rider ?? null;
};

try {
  chk("login del dueño", (await login("d", DUENO)) === DUENO);

  const [art] = await sql`SELECT slug, owner_email FROM artists WHERE slug = ${ART}`;
  chk(`el artista ${ART} existe y es del dueño`, art?.owner_email === DUENO, JSON.stringify(art));

  const guardar = (q, rider) => req(q, "PATCH", `/api/artists/${ART}`, { rider });

  console.log("\n=== 1. SE GUARDA Y SE LEE CON LA FORMA ESPERADA ===");
  {
    const r = await guardar("d", {
      cdj: { marca: "Pioneer", modelo: "CDJ-3000", cantidad: "2" },
      mixer: { marca: "Pioneer", modelo: "DJM-900NXS2" },
      monitores: { marca: "Pioneer", modelo: "XPRS12", cantidad: 2 },
      otros: "Un sampler y una pedalera.",
    });
    chk("guardar el rider -> 200", r.status === 200, JSON.stringify(r));
    const d = await riderDe(ART);
    chk("cdj con marca, modelo y cantidad", d?.cdj?.marca === "Pioneer" && d?.cdj?.modelo === "CDJ-3000" && d?.cdj?.cantidad === 2, JSON.stringify(d?.cdj));
    chk("la cantidad llegó como NÚMERO aunque se mandó string", typeof d?.cdj?.cantidad === "number", typeof d?.cdj?.cantidad);
    chk("otros se guardó", d?.otros === "Un sampler y una pedalera.", JSON.stringify(d?.otros));

    /**
     * EL MIXER NO GUARDA CANTIDAD, y esto es la prueba de que RIDER_LLEVA_CANTIDAD manda
     * del lado del servidor y no solo esconde un input. Si solo lo escondiera la UI,
     * cualquiera podría mandarla por la API.
     */
    const conCantidad = await guardar("d", { mixer: { marca: "Pioneer", modelo: "DJM-A9", cantidad: 3 } });
    chk("mandar cantidad en el mixer -> 200", conCantidad.status === 200, JSON.stringify(conCantidad));
    const e = await riderDe(ART);
    chk("y la cantidad del mixer NO se guardó", e?.mixer?.cantidad === undefined, JSON.stringify(e?.mixer));
  }

  console.log("\n=== 2. LO QUE NO RECONOCE SE DESCARTA, SIN FALLAR ===");
  {
    const r = await guardar("d", {
      cdj: { marca: "Pioneer", modelo: "CDJ-2000", cantidad: 2, voltaje: "220v" },
      pirotecnia: { marca: "Acme" },
      otros: "Nada raro.",
      colorFavorito: "rojo",
    });
    chk("un rider con campos de más -> 200, no 400", r.status === 200, JSON.stringify(r));
    const d = await riderDe(ART);
    chk("la clave desconocida NO se guardó", d?.pirotecnia === undefined, JSON.stringify(Object.keys(d ?? {})));
    chk("ni la de nivel raíz", d?.colorFavorito === undefined, JSON.stringify(Object.keys(d ?? {})));
    chk("ni el campo de más adentro de un equipo", d?.cdj?.voltaje === undefined, JSON.stringify(d?.cdj));
    chk("y lo que SÍ reconoce quedó", d?.cdj?.modelo === "CDJ-2000", JSON.stringify(d?.cdj));
  }

  console.log("\n=== 3. LOS LÍMITES: CANTIDAD Y LARGO ===");
  {
    for (const [valor, que] of [[0, "cero"], [13, "más que el tope"], [-2, "negativa"], [2.5, "con decimales"], ["dos", "que no es número"]]) {
      await guardar("d", { cdj: { modelo: "CDJ-3000", cantidad: valor } });
      const d = await riderDe(ART);
      chk(`cantidad ${que} (${JSON.stringify(valor)}) se descarta`, d?.cdj?.cantidad === undefined, JSON.stringify(d?.cdj));
    }
    await guardar("d", { cdj: { modelo: "CDJ-3000", cantidad: 12 } });
    chk("y 12, que es el tope, SÍ entra", (await riderDe(ART))?.cdj?.cantidad === 12);

    const largo = "M".repeat(200);
    await guardar("d", { cdj: { modelo: largo, cantidad: 2 } });
    const d = await riderDe(ART);
    chk("un modelo de 200 caracteres se recorta a 80", d?.cdj?.modelo?.length === 80, String(d?.cdj?.modelo?.length));

    const otrosLargo = "x".repeat(900);
    await guardar("d", { otros: otrosLargo });
    chk("otros de 900 se recorta a 400", (await riderDe(ART))?.otros?.length === 400, String((await riderDe(ART))?.otros?.length));
  }

  console.log("\n=== 4. LOS BLANCOS, INCLUIDO EL ESPACIO DURO ===");
  {
    /**
     * El \u00A0 va como ESCAPE en este archivo, igual que en el código que prueba. Un
     * modelo hecho solo de espacios duros tiene que quedar en nada: si el recorte usara
     * solo \s, pasaría como si fuera texto y la ficha mostraría un campo en blanco con su
     * etiqueta, que se lee como un bug del sitio y no como un campo vacío.
     */
    await guardar("d", { cdj: { marca: "   ", modelo: "\u00A0\u00A0", cantidad: "" }, otros: " \t\n " });
    const d = await riderDe(ART);
    chk("marca de espacios normales -> descartada", d?.cdj?.marca === undefined, JSON.stringify(d?.cdj));
    chk("modelo de ESPACIOS DUROS -> descartado", d?.cdj?.modelo === undefined, JSON.stringify(d?.cdj));
    chk("otros de blancos -> descartado", d?.otros === undefined, JSON.stringify(d?.otros));
    chk("y el equipo vacío entero no se guarda", d?.cdj === undefined, JSON.stringify(d));

    await guardar("d", { cdj: { marca: "  Pioneer  ", modelo: " CDJ-3000 " } });
    const e = await riderDe(ART);
    chk("los blancos de los bordes se recortan", e?.cdj?.marca === "Pioneer" && e?.cdj?.modelo === "CDJ-3000", JSON.stringify(e?.cdj));
  }

  console.log("\n=== 5. VACIARLO LO BORRA ===");
  {
    await guardar("d", { cdj: { marca: "Pioneer", modelo: "CDJ-3000", cantidad: 2 }, otros: "algo" });
    chk("parte con rider cargado", !!(await riderDe(ART))?.cdj);
    const r = await guardar("d", {
      cdj: { marca: "", modelo: "", cantidad: "" },
      mixer: { marca: "", modelo: "" },
      monitores: { marca: "", modelo: "", cantidad: "" },
      otros: "",
    });
    chk("guardar todo en blanco -> 200", r.status === 200, JSON.stringify(r));
    const d = await riderDe(ART);
    chk("EL RIDER QUEDÓ EN {}", JSON.stringify(d) === "{}", JSON.stringify(d));
  }

  console.log("\n=== 6. UNA SECCIÓN NO SE LLEVA A LA OTRA ===");
  {
    await guardar("d", { cdj: { marca: "Pioneer", modelo: "CDJ-3000", cantidad: 2 }, otros: "monitoreo propio" });
    const [antes] = await sql`SELECT bio, origin, rider FROM artists WHERE slug = ${ART}`;

    /**
     * Guardar SOBRE MÍ no puede tocar el rider.
     *
     * LA BIO LLEVA LA MARCA DE ESTA CORRIDA, y la aserción es que QUEDÓ lo que se mandó,
     * no que CAMBIÓ respecto de antes. La primera versión comparaba contra el valor previo
     * y fallaba en la segunda corrida seguida: la bio ya estaba en ese valor de la corrida
     * anterior, así que "cambió" era falso aunque el guardado hubiera funcionado perfecto.
     * Una prueba que depende del estado que dejó la corrida anterior no es idempotente, y
     * la regla del repo es que todo se corre dos veces.
     */
    const bioNueva = `Una bio de prueba, suficientemente larga. Corrida ${Date.now()}.`;
    const r = await req("d", "PATCH", `/api/artists/${ART}`, { bio: bioNueva, origin: "Bogotá" });
    chk("guardar sobre mí -> 200", r.status === 200, JSON.stringify(r));
    const [d] = await sql`SELECT bio, origin, rider FROM artists WHERE slug = ${ART}`;
    chk("la bio quedó con lo que se mandó", d.bio === bioNueva, d.bio);
    chk("EL RIDER SOBREVIVIÓ ENTERO", JSON.stringify(d.rider) === JSON.stringify(antes.rider), JSON.stringify(d.rider));

    /** Y guardar el rider no puede tocar sobre mí. */
    await guardar("d", { cdj: { marca: "Denon", modelo: "SC6000", cantidad: 2 } });
    const [e] = await sql`SELECT bio, origin, rider FROM artists WHERE slug = ${ART}`;
    chk("la bio sobrevivió al guardado del rider", e.bio === d.bio, e.bio);
    chk("y el origen también", e.origin === d.origin, e.origin);
    chk("y el rider sí cambió", e.rider?.cdj?.marca === "Denon", JSON.stringify(e.rider));
  }

  console.log("\n=== 7. UN RIDER QUE NO ES OBJETO SE RECHAZA ===");
  {
    for (const [v, que] of [[[1, 2], "un array"], ["texto", "un string"], [42, "un número"], [null, "null"]]) {
      const r = await guardar("d", v);
      chk(`${que} -> 400`, r.status === 400, JSON.stringify(r));
    }
  }

  console.log("\n=== 8. PERMISOS: EL RIDER ES CONTENIDO DEL PERFIL ===");
  {
    const antes = await riderDe(ART);

    const sin = await req(null, "PATCH", `/api/artists/${ART}`, { rider: { cdj: { modelo: "ZZ Sin Sesion" } } });
    chk("sin sesión -> 401", sin.status === 401, JSON.stringify(sin));

    /**
     * UN TERCERO LOGUEADO DE VERDAD, no un intento sin sesión disfrazado de prueba de
     * permisos. 401 y 403 prueban cosas distintas, y solo el segundo dice algo sobre la
     * PROPIEDAD del perfil: el primero solo dice que hace falta estar logueado.
     *
     * La primera versión de esta sección se conformaba con el 401 y dejaba anotado que no
     * se había podido loguear a un tercero. Sí se podía: duena@test.hotu.local es una
     * cuenta del seed, con la misma contraseña, y no es dueña de test-camila. El fixture
     * ya existía y no lo busqué.
     */
    const tercero = "duena@test.hotu.local";
    chk("login del tercero", (await login("t", tercero)) === tercero);
    const [suyo] = await sql`SELECT owner_email FROM artists WHERE slug = ${ART}`;
    chk("y NO es dueño de este artista", suyo.owner_email !== tercero, suyo.owner_email);

    const ajeno = await guardar("t", { cdj: { marca: "ZZ Intruso", modelo: "ZZ Modelo" } });
    chk("UN TERCERO EDITANDO EL RIDER AJENO -> 403", ajeno.status === 403, JSON.stringify(ajeno));

    const despues = await riderDe(ART);
    chk("y el rider no cambió ni una coma", JSON.stringify(antes) === JSON.stringify(despues), JSON.stringify(despues));
    chk("ni quedó el nombre del intruso", !JSON.stringify(despues).includes("ZZ Intruso"), JSON.stringify(despues));
  }
  console.log("\n=== 9. SE VE EN EL PERFIL, Y NO SE VE CUANDO ESTÁ VACÍO ===");
  {
    await guardar("d", { cdj: { marca: "Pioneer", modelo: "CDJ-3000", cantidad: 2 }, otros: "Sampler propio" });
    const html = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    chk("la sección RIDER TÉCNICO aparece", html.includes("RIDER TÉCNICO"), "no aparece");
    chk("muestra 2× Pioneer CDJ-3000", html.includes("2× Pioneer CDJ-3000"), "no está la línea armada");
    chk("y la línea libre", html.includes("Sampler propio"), "no está otros");

    await guardar("d", { cdj: { marca: "", modelo: "", cantidad: "" }, mixer: { marca: "", modelo: "" }, monitores: { marca: "", modelo: "", cantidad: "" }, otros: "" });
    const vacio = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    /**
     * SIN SESIÓN, o sea como lo ve un visitante: la sección vacía NO se muestra. Al dueño
     * sí se le muestra, y por eso este fetch va sin cookie — pedirlo con la sesión del
     * dueño mediría lo contrario y daría un falso MAL.
     */
    chk("vacío y sin sesión: la sección NO se muestra", !vacio.includes("RIDER TÉCNICO"), "se sigue mostrando");
    chk("y la página sigue en pie", vacio.includes("</html>"), "la página se rompió");
  }
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
