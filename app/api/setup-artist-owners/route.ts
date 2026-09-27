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
 * 1. Una cuenta por artista sin dueño: <slug>@perfil.hotu.local, SIN
 *    contraseña y con auth_provider 'credentials'.
 * 2. artists.owner_email de cada uno.
 * 3. collectives.owner_email de los colectivos sin dueño.
 * 4. La membresía del dueño se asegura como 'miembro'. Si no tenía ninguna
 *    —el caso de monte-negro— se crea. NO escribe 'residente': ver el
 *    comentario largo abajo, junto al UPDATE.
 *
 * Los que no quedan de dueños se quedan EXACTAMENTE como estaban. No hace
 * falta crearles membresías porque YA LAS TIENEN, y
 * repartirlos de nuevo sería reescribir datos reales con un criterio
 * inventado.
 *
 * ============================================================
 * LAS CUENTAS NACEN SIN CONTRASEÑA, Y NO PUEDEN ENTRAR
 * ============================================================
 *
 * password_hash queda en NULL. verifyCredentials devuelve null cuando no
 * hay hash —es el mismo camino por el que una cuenta de Google no entra
 * con contraseña— así que estas cuentas EXISTEN, son dueñas de su perfil
 * y satisfacen el FK, pero nadie puede iniciar sesión con ellas.
 *
 * La primera versión les ponía una contraseña común. Se descartó por tres
 * razones que se suman:
 *
 * 1. NO HAY FORMA DE CAMBIARLA. No existe ninguna ruta en el repo que
 *    escriba password_hash sobre una cuenta viva: createAccount es
 *    INSERT ... ON CONFLICT DO NOTHING, incapaz por diseño de pisar una
 *    fila existente. Doce contraseñas permanentes.
 * 2. EL EMAIL ES DEDUCIBLE. El patrón es <slug>@dominio y los slugs están
 *    en la URL de cada perfil. Una contraseña compartida más un usuario
 *    adivinable es una puerta abierta.
 * 3. SON PERFILES DE ARTISTAS REALES. El día que alguno reclame el suyo,
 *    el camino tiene que ser reclamarlo, no que alguien le pase una clave
 *    que comparte con otros once.
 *
 * CONSECUENCIA ACEPTADA: hasta que exista el flujo de reclamo, esos 12
 * perfiles solo los puede editar un SUPER_ADMIN — canEditArtist cae a
 * isSuperAdmin cuando quien mira no es el dueño. No quedan inalcanzables,
 * quedan reservados.
 *
 * Eso convierte "recuperar contraseña" de deuda anotada en REQUISITO, y
 * así está en PROGRESO.md: sin ese flujo, estos perfiles no se pueden
 * entregar.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dominio PROPIO, separado del de los fixtures.
 *
 * @test.hotu.local es el namespace declarado de seed-test. Meter doce
 * cuentas de producción ahí adentro dejaba una mina puesta a mano: la
 * limpieza obvia —DELETE FROM user_profiles WHERE email LIKE
 * '%@test.hotu.local'— no falla, porque el FK es ON DELETE SET NULL.
 * Pondría los doce owner_email en NULL en silencio y devolvería los
 * perfiles al estado que esta migración vino a arreglar. Alguien lo hace
 * un martes y nadie entiende el jueves.
 */
const DOMINIO = "@perfil.hotu.local";

type Plan = {
  artistSlug: string;
  artistName: string;
  email: string;
  /** El colectivo del que queda dueño, o null si es residente. */
  colectivo: string | null;
  rol: "dueño y miembro" | "miembro";
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
    // un colectivo.
    const membresias = await sql`
      SELECT ac.artist_slug, ac.collective_slug
      FROM artist_collectives ac
      JOIN collectives c ON c.slug = ac.collective_slug AND c.entity_kind = 'collective'
      WHERE ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
      ORDER BY ac.collective_slug, ac.artist_slug
    `;

    /**
     * Quién YA tiene una residencia activa en otro lado.
     *
     * OJO: EL MOTIVO ORIGINAL DE ESTA EXCLUSIÓN YA NO EXISTE, y decirlo
     * importa más que la exclusión misma.
     *
     * Decía —correctamente, hasta la fase 2— que poner de dueño a alguien con
     * casa en otro colectivo haría que el UPDATE a 'casa' violara el índice
     * único de una-sola-activa, que la transacción de ESE artista revertiría,
     * que la excepción saldría del bucle y que re-correr elegiría al mismo y
     * volvería a explotar: irrecuperable sin tocar la base.
     *
     * Eso se terminó cuando esta migración pasó a escribir 'miembro'. 'miembro'
     * no tiene índice de exclusividad, así que YA NO PUEDE CHOCAR con nada.
     *
     * La exclusión se deja, y ahora dice otra cosa: quien ya tiene su residencia
     * en OTRO colectivo probablemente no sea la persona indicada para quedar de
     * dueño de este. Es una regla de criterio y no una protección técnica, y la
     * próxima persona tiene derecho a saber que puede sacarla sin que nada
     * explote.
     *
     * PERO AHORA ES UN MAPA Y NO UN CONJUNTO, y eso arregla un bug que el
     * renombre dejó a la vista. Como conjunto, la exclusión sacaba a cualquiera
     * con residencia activa EN CUALQUIER PARTE, incluida la de este mismo
     * colectivo. Un colectivo cuyo único miembro es su residente se quedaba sin
     * ningún candidato y sin dueño PARA SIEMPRE — justo lo que esta migración
     * existe para evitar. Medido con un fixture plantado, no razonado.
     *
     * Ya estaba mal antes, por lo mismo: si la casa de alguien era ESTE
     * colectivo, el UPDATE a 'casa' era un no-op y no violaba ningún índice, así
     * que excluirlo no protegía de nada. No se notaba porque en producción
     * ningún colectivo tenía casa asignada.
     */
    const residenciaDe = new Map<string, string>(
      (
        await sql`
          SELECT artist_slug, collective_slug FROM artist_collectives
          WHERE kind = 'residente' AND to_date IS NULL
        `
      ).map((r) => [r.artist_slug as string, r.collective_slug as string])
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
      if (!disponibles.has(a)) continue;
      // Su residencia en ESTE colectivo no lo descalifica de administrarlo:
      // es justamente quien más cerca está de ser su dueño.
      const residencia = residenciaDe.get(a);
      if (residencia && residencia !== c) continue;
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
      (a) => !enAlgunColectivo.has(a) && !yaElegidos.has(a) && !residenciaDe.has(a)
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
        rol: d ? "dueño y miembro" : "miembro",
        motivo: d
          ? d.motivo
          : suyos.length > 0
            ? `ya es miembro de ${suyos.join(", ")}; se queda como está`
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
      const [vinculos] = await sql`
        SELECT COUNT(*)::int AS n FROM collectives c
        JOIN artists a ON lower(a.owner_email) = lower(c.owner_email)
        JOIN artist_collectives ac
          ON ac.artist_slug = a.slug AND ac.collective_slug = c.slug
         AND ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
        WHERE c.entity_kind = 'collective' AND c.owner_email IS NOT NULL
      `;
      return {
        artistasSinDuenio: a.n as number,
        colectivosSinDuenio: c.n as number,
        cuentasDelDominio: u.n as number,
        colectivosConDuenioYVinculo: vinculos.n as number,
      };
    };

    const antes = await estado();

    if (dryRun) {
      log.push(
        `SIMULACIÓN: ${plan.length} artistas sin dueño, ${colectivosSinDuenio.length} colectivos sin dueño.`
      );
      log.push(
        `SIMULACIÓN: quedarían ${plan.filter((p) => p.rol === "dueño y miembro").length} dueños y ${plan.filter((p) => p.rol === "miembro").length} miembros.`
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
      const queries = [
        // ON CONFLICT DO NOTHING: si la cuenta ya existe, NO se le pisa la
        // contraseña. Una segunda corrida no puede sacarle la cuenta a
        // alguien que ya la esté usando.
        sql`
          INSERT INTO user_profiles
            (email, display_name, auth_provider, updated_at)
          VALUES (${p.email}, ${p.artistName}, 'credentials', now())
          ON CONFLICT (email) DO NOTHING
        `,
        // WHERE owner_email IS NULL: no le cambia el dueño a un perfil que
        // ya tenga uno, pase lo que pase.
        sql`
          UPDATE artists SET owner_email = ${p.email}
          WHERE slug = ${p.artistSlug} AND owner_email IS NULL
        `,
      ];

      if (p.rol === "dueño y miembro" && p.colectivo) {
        queries.push(
          sql`
            UPDATE collectives SET owner_email = ${p.email}
            WHERE slug = ${p.colectivo} AND owner_email IS NULL
          `,
          /**
           * ESCRIBE 'miembro', Y ANTES ESCRIBÍA 'casa'. EL CAMBIO NO ES DE
           * NOMBRE: ES DE ALCANCE.
           *
           * Desde §8 fase 2, el valor que aquí era 'casa' se llama 'residente'
           * y ya no es una etiqueta: es PERMISO PARA EDITAR el colectivo. Y hay
           * un invariante del que depende que eso sea revisable —UN SOLO
           * archivo escribe kind='residente', lib/residency-offers-write.ts—
           * porque un segundo escritor es un camino para ganar permisos que
           * nadie auditó. Una migración escribiéndolo sería exactamente ese
           * segundo escritor.
           *
           * Y no hace falta: el dueño edita su colectivo PORQUE ES EL DUEÑO.
           * rolSobreColectivo le contesta "dueno" sin mirar artist_collectives
           * para nada. Lo único que se pierde escribiendo 'miembro' es que
           * aparezca en el carrusel de RESIDENTES, y eso se concede aparte,
           * a mano o con una oferta.
           *
           * HISTORIA DEL COMENTARIO QUE ESTABA ACÁ, porque decía algo que hoy
           * es falso y alguien lo va a volver a leer: afirmaba que "una fila
           * PENDIENTE lleva siempre kind 'residente'". Era verdad en la tanda
           * 3, cuando 'residente' era el vínculo GENERAL. Desde la fase 1 de §8
           * el vínculo general se llama 'miembro' y PENDING_KIND es 'miembro',
           * así que la frase quedó diciendo lo contrario de lo que pasa. Es el
           * riesgo que AGENTS.md advierte sobre esta palabra: cambió de
           * significado tres veces.
           *
           * accepted_at IS NOT NULL SIGUE HACIENDO FALTA igual. Sin ese filtro
           * esto tocaría invitaciones sin responder, y cambiarle el kind a algo
           * que el DJ todavía no aceptó es decidir por él.
           */
          sql`
            UPDATE artist_collectives SET kind = 'miembro'
            WHERE artist_slug = ${p.artistSlug} AND collective_slug = ${p.colectivo}
              AND to_date IS NULL AND accepted_at IS NOT NULL
              AND kind <> 'residente'
          `,
          sql`
            INSERT INTO artist_collectives
              (artist_slug, collective_slug, kind, from_date, accepted_at)
            SELECT ${p.artistSlug}, ${p.colectivo}, 'miembro', CURRENT_DATE, now()
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
    // tenía dueño y vínculo antes de esta corrida tapaba uno que no se
    // escribió: con 1 preexistente alcanzaba con 5 de 6 nuevas para que
    // el número diera y el log dijera "VERIFICADO" mintiendo.
    const esperadosConVinculo = plan.filter(
      (p) => p.rol === "dueño y miembro" && !p.cuentaYaExiste
    ).length;
    const nuevosVinculos = despues.colectivosConDuenioYVinculo - antes.colectivosConDuenioYVinculo;
    if (nuevosVinculos < esperadosConVinculo) {
      problemas.push(
        `se escribieron ${nuevosVinculos} vínculos nuevos de dueño y se esperaban ${esperadosConVinculo}`
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
        ? `VERIFICADO: 0 artistas y 0 colectivos publicados sin dueño, y cada dueño tiene su vínculo en el colectivo que administra.`
        : `NO VERIFICADO: ${problemas.length} problema(s).`
    );
    for (const p of problemas) log.push(`  - ${p}`);
    log.push(
      `Artistas escritos: ${escritos} de ${plan.length}. Cuentas del dominio ${DOMINIO}: ${antes.cuentasDelDominio} antes, ${despues.cuentasDelDominio} después — ese dominio es solo de esta migración, separado del de los fixtures.`
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
