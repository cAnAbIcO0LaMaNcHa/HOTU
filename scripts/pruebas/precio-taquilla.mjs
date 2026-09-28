/**
 * El precio en taquilla, de punta a punta contra dev: se crea por la API, se ve
 * en /eventos, se edita, se borra, y 0 no se confunde con "no dijo".
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
const COL = "zz-pr-col";
const corrida = await abrirCorrida(sql, "prueba de precio en taquilla");

/** Una fecha futura, para que el evento caiga en la lista de próximos. */
const futura = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);

try {
  await sql`INSERT INTO collectives (slug,name,type,sector,bio,district,status,entity_kind,owner_email)
            VALUES (${COL},'ZZ Precio Col','LOCAL','Bogota','','D00','published','collective',${DUENO})`;
  chk("login del dueño", (await login("d", DUENO)) === DUENO);

  const crear = (extra) =>
    req("d", "POST", "/api/events", {
      organizerSlug: COL,
      title: "ZZ Fiesta Precio",
      date: futura,
      venue: "ZZ Bodega",
      city: "Bogota",
      lineup: "ZZ DJ",
      ...extra,
    });

  console.log("=== 1. CREAR CON PRECIO");
  let id;
  {
    const r = await crear({ doorPriceCop: "35.000" });
    chk("se crea con 35.000 escrito con punto", r.status === 201, JSON.stringify(r));
    id = r.data.id;
    const [e] = await sql`SELECT door_price_cop FROM events WHERE id = ${id}`;
    chk("quedó 35000 como entero", e.door_price_cop === 35000, `es ${e.door_price_cop}`);
  }

  console.log("\n=== 2. SE VE EN /eventos FORMATEADO");
  {
    const html = await (await fetch(`${BASE}/eventos`)).text();
    chk("la fiesta aparece", html.includes("ZZ Fiesta Precio"), "no aparece el evento");
    chk(
      "y dice el precio formateado",
      /Taquilla/.test(html) && /35\.000/.test(html),
      "no encontré 'Taquilla' con 35.000"
    );
    chk(
      "y NO quedó el precio falso de antes",
      !/Desde/.test(html) || !/30\.000/.test(html),
      "sigue apareciendo 'Desde $30.000', la constante vieja"
    );
  }

  console.log("\n=== 3. VACÍO Y 0 SON COSAS DISTINTAS");
  {
    const sinPrecio = await crear({ title: "ZZ Sin Precio", doorPriceCop: "" });
    chk("se crea sin precio", sinPrecio.status === 201, JSON.stringify(sinPrecio));
    const [a] = await sql`SELECT door_price_cop FROM events WHERE id = ${sinPrecio.data.id}`;
    chk("vacío guarda NULL y NO 0", a.door_price_cop === null, `es ${a.door_price_cop}`);

    const gratis = await crear({ title: "ZZ Gratis", doorPriceCop: "0" });
    chk("se crea con 0", gratis.status === 201, JSON.stringify(gratis));
    const [b] = await sql`SELECT door_price_cop FROM events WHERE id = ${gratis.data.id}`;
    chk("0 guarda 0 y NO NULL", b.door_price_cop === 0, `es ${b.door_price_cop}`);

    const html = await (await fetch(`${BASE}/eventos`)).text();

    /**
     * SE RECORTA HASTA </article> Y SE ANCLA AL TÍTULO RENDERIZADO.
     *
     * La primera versión hacía html.indexOf(titulo) + slice(700) y dio un MAL
     * falso: el nombre del evento aparece MÁS DE UNA VEZ en la página —el
     * payload de RSC que Next mete en la página lo repite— y el recorte caía en
     * la ocurrencia equivocada, mostrando JSON en vez del bloque del precio.
     * "Entrada libre" sí estaba renderizado; el chequeo miraba el lugar
     * equivocado y contestó mal.
     *
     * `>titulo<` ancla al nodo de texto del <h3>, y el corte en </article> es el
     * límite real de la tarjeta en vez de un número de caracteres a ojo.
     */
    const veces = (t) => html.split(t).length - 1;
    console.log(
      `      (el título aparece ${veces("ZZ Gratis")} vez/veces en la página: ` +
        "por eso el recorte va anclado y acotado)"
    );
    const trozo = (titulo) => {
      const i = html.indexOf(`>${titulo}<`);
      if (i < 0) return "";
      const fin = html.indexOf("</article>", i);
      return html.slice(i, fin < 0 ? i + 2000 : fin);
    };
    chk(
      "el de 0 dice 'Entrada libre' y no desaparece",
      /Entrada libre/.test(trozo("ZZ Gratis")),
      "una fiesta gratis quedó sin anuncio: el chequeo truthy está de vuelta"
    );
    chk(
      "el sin precio no dice nada de taquilla",
      !/Taquilla|Entrada libre/.test(trozo("ZZ Sin Precio")),
      "anuncia un precio que nadie escribió"
    );
  }

  console.log("\n=== 4. EDITAR Y BORRAR EL PRECIO");
  {
    const sube = await req("d", "PATCH", `/api/events/${id}`, { doorPriceCop: "45000" });
    chk("se puede cambiar", sube.status === 200, JSON.stringify(sube));
    const [a] = await sql`SELECT door_price_cop FROM events WHERE id = ${id}`;
    chk("quedó 45000", a.door_price_cop === 45000, `es ${a.door_price_cop}`);

    /** LA CLAVE AUSENTE NO PUEDE BORRARLO. */
    const otro = await req("d", "PATCH", `/api/events/${id}`, { title: "ZZ Fiesta Precio 2" });
    chk("editar otra cosa NO borra el precio", otro.status === 200, JSON.stringify(otro));
    const [b] = await sql`SELECT door_price_cop, title FROM events WHERE id = ${id}`;
    chk(
      "el precio sobrevive a un patch que no lo menciona",
      b.door_price_cop === 45000,
      `es ${b.door_price_cop} — el SELECT de 'actual' no trae la columna`
    );

    const vacia = await req("d", "PATCH", `/api/events/${id}`, { doorPriceCop: "" });
    chk("mandarlo vacío SÍ lo borra", vacia.status === 200, JSON.stringify(vacia));
    const [c] = await sql`SELECT door_price_cop FROM events WHERE id = ${id}`;
    chk("quedó NULL", c.door_price_cop === null, `es ${c.door_price_cop}`);
  }

  console.log("\n=== 5. LO QUE SE RECHAZA");
  {
    for (const [v, por] of [
      ["abc", "texto"],
      ["-5000", "negativo"],
      ["35000,50", "con centavos"],
    ]) {
      const r = await req("d", "PATCH", `/api/events/${id}`, { doorPriceCop: v });
      chk(`'${v}' rechazado (${por})`, r.status === 400, JSON.stringify(r));
    }
    const [c] = await sql`SELECT door_price_cop FROM events WHERE id = ${id}`;
    chk("y ninguno dejó basura", c.door_price_cop === null, `es ${c.door_price_cop}`);

    /**
     * NO HAY TOPE MÁXIMO, y esto lo afirma en vez de darlo por sentado.
     *
     * Hubo uno de 10.000.000 y se sacó: el precio es del organizador, no de la
     * plataforma. Este chequeo era antes "rechazado por encima del techo" y
     * FALLÓ cuando el tope se fue — que es lo que tenía que pasar. Queda
     * invertido para que, si alguien vuelve a poner un tope, la batería lo diga
     * en vez de que el rechazo aparezca en silencio para un organizador.
     *
     * OJO: en MAIN esto todavía rechazaría. El CHECK de allá conserva el tope
     * hasta que la próxima migración de events lo saque —está anotado en
     * PROGRESO.md— y el comparador de esquemas no ve los CHECK, así que esta
     * prueba es el único lugar donde la diferencia se nota.
     */
    const grande = await req("d", "PATCH", `/api/events/${id}`, { doorPriceCop: "99000000" });
    chk("un precio enorme se ACEPTA: no hay tope", grande.status === 200, JSON.stringify(grande));
    const [g] = await sql`SELECT door_price_cop FROM events WHERE id = ${id}`;
    chk("y quedó guardado tal cual", g.door_price_cop === 99000000, `es ${g.door_price_cop}`);
  }
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
