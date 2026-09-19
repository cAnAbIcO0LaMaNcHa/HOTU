/**
 * MIGRACIÓN DE DATOS — dueños para los artistas y colectivos huérfanos.
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-artist-owners?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-artist-owners?secret=YOUR_SECRET
 *
 * ============================================================
 * POR QUÉ ESTO VA ANTES DE VACIAR EL ADMIN
 * ============================================================
 *
 * Los 12 artistas y 6 colectivos de producción no tienen owner_email:
 * entraron por /api/migrate desde datos estáticos, antes de que existiera
 * el alta de DJ. Nadie los puede editar porque no son de nadie, y hasta
 * hoy eso no importaba porque el admin era un CMS y editaba todo.
 *
 * En cuanto el admin deje de crear contenido, un perfil sin dueño es un
 * perfil que NADIE puede tocar. Por eso los dueños van primero: sacar la
 * muleta antes de que el paciente camine lo deja en el piso.
 *
 * NO ES UNA MIGRACIÓN DE SCHEMA. No crea ni altera una sola columna.
 * Crea cuentas y las vincula. Va igual con dryRun, dos corridas y
 * `verificado` porque toca producción y porque la regla no distingue.
 *
 * ============================================================
 * EL REPARTO SALE DE LOS DATOS, NO DE UN CRITERIO INVENTADO
 * ============================================================
 *
 * Había que elegir qué artista queda de dueño de cada colectivo. En vez
 * de inventarlo por afinidad de nombre —"Páramo Selecta suena a Páramo
 * Club"— sale de las membresías que YA EXISTEN: entraron desde el jsonb
 * en la tanda 2 y son datos reales sobre quién toca dónde.
 *
 *   El dueño de un colectivo es el PRIMERO POR SLUG de sus miembros
 *   activos que todavía no tenga cuenta.
 *
 * Y hay una coincidencia que cierra el caso sin forzar nada: en
 * producción `pereira-sonora` es el ÚNICO colectivo sin miembros, y
 * `monte-negro` el ÚNICO artista sin colectivo. Se emparejan solos. Esa
 * es la única asignación que no sale de una membresía preexistente, y es
 * la única posible.
 *
 * "Primero por slug" es arbitrario ENTRE IGUALES y hay que decirlo: si
 * cuatro personas ya tocan en un colectivo, cuál de las cuatro queda de
 * dueña no lo dice ningún dato. Lo que sí garantiza el criterio es que
 * el dueño SEA ALGUIEN QUE YA ESTABA AHÍ, que es la parte que importa.
 * Reasignarlo después es un UPDATE.
 *
 * ============================================================
 * QUÉ ESCRIBE
 * ============================================================
 *
 * 1. Una cuenta por artista sin dueño: <slug>@test.hotu.local, con
 *    contraseña común y auth_provider 'credentials'.
 * 2. artists.owner_email de cada uno.
 * 3. collectives.owner_email de los colectivos sin dueño.
 * 4. La membresía del dueño pasa a 'casa'. Si no tenía ninguna —el caso
 *    de monte-negro— se crea.
 *
 * Los que no quedan de dueños se quedan como estaban: residentes, sin
 * casa. No hace falta crearles membresías porque YA LAS TIENEN, y
 * repartirlos de nuevo sería reescribir datos reales con un criterio
 * inventado.
 *
 * ============================================================
 * LA CONTRASEÑA ES COMÚN Y ESO ES DELIBERADO
 * ============================================================
 *
 * Son cuentas de arranque para perfiles que hoy no tiene nadie, no
 * cuentas de personas. Cada hash lleva su propio salt igual —hashPassword
 * genera uno por llamada— así que la contraseña común no se nota en la
 * base y no habilita un ataque por tabla.
 *
 * Queda anotado en PROGRESO.md como deuda: cuando cada DJ real reclame su
 * perfil, hay que forzar el cambio. Hasta entonces, un perfil sin dueño
 * es peor que uno con una contraseña conocida por el equipo.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { hashPassword } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRASENA = "HOTU11111";
const DOMINIO = "@test.hotu.local";

type Plan = {
  artistSlug: string;
  artistName: string;
  email: string;
  /** El colectivo del que queda dueño, o null si es residente. */
  colectivo: string | null;
  rol: "dueño y casa" | "residente";
  /** De dónde salió la asignación, para poder auditarla. */
  motivo: string;
  /** Si ya hay una cuenta con ese email. true = NO se toca ese artista. */
  cuentaYaExiste: boolean;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  try {
    // --- de dónde partimos -----------------------------------------
    const huerfanos = await sql`
      SELECT slug, name FROM artists
      WHERE owner_email IS NULL AND status = 'published'
      ORDER BY slug
    `;
    const colectivosSinDuenio = await sql`
      SELECT slug, name FROM collectives
      WHERE owner_email IS NULL AND entity_kind = 'collective' AND status = 'published'
      ORDER BY slug
    `;
    // JOIN contra collectives filtrando entity_kind: sin eso, alguien
    // cuya única residencia activa es un VENUE cuenta como "ya está en un
    // colectivo" y queda fuera de los sueltos — justo quien más necesita
    // una casa.
    const membresias = await sql`
      SELECT ac.artist_slug, ac.collective_slug
      FROM artist_collectives ac
      JOIN collectives c ON c.slug = ac.collective_slug AND c.entity_kind = 'collective'
      WHERE ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
      ORDER BY ac.collective_slug, ac.artist_slug
    `;

    /**
     * Quién YA tiene una casa activa. No pueden quedar de dueños.
     *
     * El índice artist_collectives_one_active_casa_idx es UNIQUE
     * (artist_slug) WHERE kind='casa' AND to_date IS NULL: una sola casa
     * activa por artista, y NO mira accepted_at. Poner a alguien de dueño
     * de un colectivo teniendo casa en otro haría que el UPDATE a 'casa'
     * violara ese índice, la transacción de ESE artista revertiría, la
     * excepción saldría del bucle, y los artistas siguientes nunca se
     * procesarían. Peor: re-correr elegiría al mismo y volvería a
     * explotar. Determinísticamente irrecuperable sin tocar la base.
     *
     * Hoy en dev no dispara por casualidad —los dos que tienen casa son
     * fixtures y sus colectivos ya tienen dueño— pero AGENTS.md dice que
     * asignar las casas a mano es trabajo pendiente. Si eso se hace
     * primero, este es el caso NORMAL y no el borde.
     */
    const conCasa = new Set(
      (
        await sql`
          SELECT artist_slug FROM artist_collectives
          WHERE kind = 'casa' AND to_date IS NULL
        `
      ).map((r) => r.artist_slug as string)
    );

    /**
     * Las cuentas que YA existen con el email que esta ruta usaría.
     *
     * ESTO ES UN ROBO DE PERFIL SI NO SE MIRA. /api/accounts es público,
     * no hay verificación de correo —el dominio no existe, no se puede
     * verificar—, y el patrón <slug>@dominio es deducible: los slugs
     * están en la URL de cada perfil. Alguien registra
     * "subsuelo-x@test.hotu.local" ANTES de que esto corra, el INSERT de
     * acá choca y su ON CONFLICT DO NOTHING conserva la contraseña del
     * atacante, y el UPDATE siguiente le entrega el perfil igual.
     *
     * El ON CONFLICT protegía la cuenta y no el perfil, que es lo que
     * importaba.
     */
    const emailsPlaneados = huerfanos.map((r) => `${r.slug as string}${DOMINIO}`);
    const yaExisten = new Set(
      (
        await sql`
          SELECT email FROM user_profiles WHERE email = ANY(${emailsPlaneados}::text[])
        `
      ).map((r) => r.email as string)
    );

    const sinDuenio = huerfanos.map((r) => r.slug as string);
    const disponibles = new Set(sinDuenio);

    // Miembros activos por colectivo, solo los que todavía no tienen cuenta.
    const miembros = new Map<string, string[]>();
    for (const m of membresias) {
      const c = m.collective_slug as string;
      const a = m.artist_slug as string;
      if (!disponibles.has(a) || conCasa.has(a)) continue;
      if (!miembros.has(c)) miembros.set(c, []);
      miembros.get(c)!.push(a);
    }

    // --- quién queda de dueño de cada colectivo --------------------
    const duenioDe = new Map<string, { artista: string; motivo: string }>();
    const yaElegidos = new Set<string>();

    for (const c of colectivosSinDuenio) {
      const slug = c.slug as string;
      const candidatos = (miembros.get(slug) ?? []).filter((a) => !yaElegidos.has(a));
      if (candidatos.length > 0) {
        const elegido = candidatos[0];
        yaElegidos.add(elegido);
        duenioDe.set(slug, {
          artista: elegido,
          motivo:
            candidatos.length === 1
              ? "es su único miembro activo sin cuenta"
              : `primero por slug de sus ${candidatos.length} miembros activos sin cuenta`,
        });
      }
    }

    // Los colectivos que quedaron sin candidato: se les asigna un artista
    // que no esté en ningún colectivo. En producción esto es exactamente
    // un caso —pereira-sonora y monte-negro— y se emparejan solos.
    const enAlgunColectivo = new Set(
      membresias.map((m) => m.artist_slug as string).filter((a) => disponibles.has(a))
    );
    const sueltos = sinDuenio.filter(
      (a) => !enAlgunColectivo.has(a) && !yaElegidos.has(a) && !conCasa.has(a)
    );
    for (const c of colectivosSinDuenio) {
      const slug = c.slug as string;
      if (duenioDe.has(slug)) continue;
      const elegido = sueltos.shift();
      if (!elegido) {
        log.push(
          `ATENCIÓN: ${slug} se queda sin dueño. No tiene miembros activos sin cuenta y no quedan artistas sueltos para asignarle.`
        );
        continue;
      }
      yaElegidos.add(elegido);
      duenioDe.set(slug, {
        artista: elegido,
        motivo: "no tiene miembros; se le asigna el único artista sin ningún colectivo",
      });
    }

    // --- el plan, artista por artista ------------------------------
    const porArtista = new Map<string, { colectivo: string; motivo: string }>();
    for (const [colectivo, v] of duenioDe) {
      porArtista.set(v.artista, { colectivo, motivo: v.motivo });
    }

    const plan: Plan[] = huerfanos.map((r) => {
      const slug = r.slug as string;
      const d = porArtista.get(slug);
      const suyos = membresias
        .filter((m) => m.artist_slug === slug)
        .map((m) => m.collective_slug as string);
      return {
        artistSlug: slug,
        artistName: r.name as string,
        email: `${slug}${DOMINIO}`,
        colectivo: d ? d.colectivo : (suyos[0] ?? null),
        rol: d ? "dueño y casa" : "residente",
        motivo: d
          ? d.motivo
          : suyos.length > 0
            ? `ya es residente de ${suyos.join(", ")}; se queda como está`
            : "no está en ningún colectivo y no quedó ninguno sin dueño para asignarle",
        cuentaYaExiste: yaExisten.has(`${slug}${DOMINIO}`),
      };
    });

    const conflictivos = plan.filter((p) => p.cuentaYaExiste);

    const estado = async () => {
      const [a] = await sql`
        SELECT COUNT(*)::int AS n FROM artists WHERE owner_email IS NULL AND status = 'published'
      `;
      const [c] = await sql`
        SELECT COUNT(*)::int AS n FROM collectives
        WHERE owner_email IS NULL AND entity_kind = 'collective' AND status = 'published'
      `;
      const [u] = await sql`
        SELECT COUNT(*)::int AS n FROM user_profiles WHERE email LIKE ${"%" + DOMINIO}
      `;
      const [casas] = await sql`
        SELECT COUNT(*)::int AS n FROM collectives c
        JOIN artists a ON lower(a.owner_email) = lower(c.owner_email)
        JOIN artist_collectives ac
          ON ac.artist_slug = a.slug AND ac.collective_slug = c.slug
         AND ac.kind = 'casa' AND ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
        WHERE c.entity_kind = 'collective' AND c.owner_email IS NOT NULL
      `;
      return {
        artistasSinDuenio: a.n as number,
        colectivosSinDuenio: c.n as number,
        cuentasDelDominio: u.n as number,
        colectivosConDuenioYCasa: casas.n as number,
      };
    };

    const antes = await estado();

    if (dryRun) {
      log.push(
        `SIMULACIÓN: ${plan.length} artistas sin dueño, ${colectivosSinDuenio.length} colectivos sin dueño.`
      );
      log.push(
        `SIMULACIÓN: quedarían ${plan.filter((p) => p.rol === "dueño y casa").length} dueños y ${plan.filter((p) => p.rol === "residente").length} residentes.`
      );
      if (conflictivos.length > 0) {
        log.push(
          `PARÁ — ${conflictivos.length} de esos emails YA TIENEN CUENTA: ${conflictivos.map((c) => c.email).join(", ")}. La corrida real los va a SALTEAR sin asignarles el perfil. Si no los creaste vos, alguien se adelantó a registrarlos para quedarse con el perfil.`
        );
      }
      log.push("SIMULACIÓN: no se escribió nada. Mirá 'plan' fila por fila antes de correrlo.");
      return NextResponse.json({ ok: true, dryRun: true, verificado: null, plan, antes, log });
    }

    // --- escritura --------------------------------------------------
    // Una transacción POR ARTISTA y no una sola gigante: cada artista es
    // independiente, y si el hash de uno falla no hay razón para deshacer
    // los demás. Dentro de cada artista sí va todo junto: una cuenta sin
    // su owner_email es una cuenta que no sirve para nada.
    let escritos = 0;
    for (const p of plan) {
      // SE SALTEA, no se le entrega el perfil a una cuenta que no creamos
      // nosotros. Ver el comentario de yaExisten: el ON CONFLICT protegía
      // la cuenta, no el perfil.
      if (p.cuentaYaExiste) {
        log.push(
          `SALTEADO ${p.artistSlug}: ${p.email} ya tenía cuenta. NO se le asignó el perfil — hay que averiguar quién la creó antes de entregárselo.`
        );
        continue;
      }
      const hash = await hashPassword(CONTRASENA);
      const queries = [
        // ON CONFLICT DO NOTHING: si la cuenta ya existe, NO se le pisa la
        // contraseña. Una segunda corrida no puede sacarle la cuenta a
        // alguien que ya la esté usando.
        sql`
          INSERT INTO user_profiles
            (email, display_name, password_hash, auth_provider, updated_at)
          VALUES (${p.email}, ${p.artistName}, ${hash}, 'credentials', now())
          ON CONFLICT (email) DO NOTHING
        `,
        // WHERE owner_email IS NULL: no le cambia el dueño a un perfil que
        // ya tenga uno, pase lo que pase.
        sql`
          UPDATE artists SET owner_email = ${p.email}
          WHERE slug = ${p.artistSlug} AND owner_email IS NULL
        `,
      ];

      if (p.rol === "dueño y casa" && p.colectivo) {
        queries.push(
          sql`
            UPDATE collectives SET owner_email = ${p.email}
            WHERE slug = ${p.colectivo} AND owner_email IS NULL
          `,
          // El vínculo pasa a casa si ya existía; si no, se crea. Cambiar
          // el kind de un vínculo aceptado con UPDATE es el patrón que ya
          // usa chooseKind en membership-write, no una invención de acá.
          // accepted_at IS NOT NULL: una fila PENDIENTE lleva siempre
          // kind 'residente' —membership-write lo documenta como
          // invariante, justamente para que no pueda chocar con el índice
          // de una sola casa activa—. Sin este filtro, esto convertiría
          // una invitación sin responder en casa, y como el índice no mira
          // accepted_at, esa casa fantasma le ocuparía el cupo al DJ
          // cuando quisiera elegir la suya de verdad.
          sql`
            UPDATE artist_collectives SET kind = 'casa'
            WHERE artist_slug = ${p.artistSlug} AND collective_slug = ${p.colectivo}
              AND to_date IS NULL AND accepted_at IS NOT NULL
          `,
          sql`
            INSERT INTO artist_collectives
              (artist_slug, collective_slug, kind, from_date, accepted_at)
            SELECT ${p.artistSlug}, ${p.colectivo}, 'casa', CURRENT_DATE, now()
            WHERE NOT EXISTS (
              SELECT 1 FROM artist_collectives
              WHERE artist_slug = ${p.artistSlug} AND collective_slug = ${p.colectivo}
                AND to_date IS NULL
            )
          `
        );
      }

      await sql.transaction(queries);
      escritos += 1;
      // Un log por artista: si el bucle revienta a mitad de 14
      // transacciones separadas, esto es lo único que dice dónde quedó.
      log.push(
        `ok ${p.artistSlug} → ${p.rol}${p.colectivo ? " en " + p.colectivo : ""} (${p.email})`
      );
    }

    const despues = await estado();

    const problemas: string[] = [];
    if (despues.artistasSinDuenio > 0) {
      problemas.push(`quedan ${despues.artistasSinDuenio} artistas publicados sin dueño`);
    }
    if (despues.colectivosSinDuenio > 0) {
      problemas.push(`quedan ${despues.colectivosSinDuenio} colectivos publicados sin dueño`);
    }
    // POR DELTA Y NO POR ABSOLUTO. Contra el total, un colectivo que YA
    // tenía dueño y casa antes de esta corrida tapaba una casa que no se
    // escribió: con 1 preexistente alcanzaba con 5 de 6 nuevas para que
    // el número diera y el log dijera "VERIFICADO" mintiendo.
    const esperadosConCasa = plan.filter(
      (p) => p.rol === "dueño y casa" && !p.cuentaYaExiste
    ).length;
    const nuevasCasas = despues.colectivosConDuenioYCasa - antes.colectivosConDuenioYCasa;
    if (nuevasCasas < esperadosConCasa) {
      problemas.push(
        `se escribieron ${nuevasCasas} casas nuevas de dueño y se esperaban ${esperadosConCasa}`
      );
    }
    if (conflictivos.length > 0) {
      problemas.push(
        `${conflictivos.length} email(s) ya tenían cuenta y se saltearon: ${conflictivos.map((c) => c.email).join(", ")}`
      );
    }

    const verificado = problemas.length === 0;
    log.push(
      verificado
        ? `VERIFICADO: 0 artistas y 0 colectivos publicados sin dueño, y cada dueño tiene su casa en el colectivo que administra.`
        : `NO VERIFICADO: ${problemas.length} problema(s).`
    );
    for (const p of problemas) log.push(`  - ${p}`);
    log.push(
      `Artistas escritos: ${escritos} de ${plan.length}. Cuentas del dominio ${DOMINIO}: ${antes.cuentasDelDominio} antes, ${despues.cuentasDelDominio} después — ese número incluye las de seed-test, no solo las de esta corrida.`
    );

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado,
      problemas,
      plan,
      antes,
      despues,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
