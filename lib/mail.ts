/**
 * EL CORREO DE HOTU, SIN PROVEEDOR TODAVÍA.
 *
 * ============================================================
 * POR QUÉ EXISTE ANTES DE PODER ENVIAR
 * ============================================================
 *
 * HOTU no tiene dominio propio, así que no puede mandar un solo mail: sin
 * dominio no hay SPF ni DKIM, y sin eso Gmail manda a spam o rechaza
 * directamente. Comprar el dominio quedó para cuando la web y la app
 * estén terminadas.
 *
 * Pero los avisos hacen falta AHORA: el flujo de reclamo los necesita
 * para no ser silencioso. Así que la interfaz existe entera, el transporte
 * REGISTRA en vez de enviar, y el día que haya dominio se enchufa Resend
 * detrás sin tocar ni un llamador.
 *
 * ============================================================
 * UNA UNIÓN DISCRIMINADA, NO enviar(to, subject, body)
 * ============================================================
 *
 * Cada aviso es una variante con sus propios campos, y `plantilla()` los
 * cubre con un switch exhaustivo. Agregar un aviso nuevo es un ERROR DE
 * TIPOS hasta que tenga plantilla.
 *
 * Con una firma genérica —un asunto y un cuerpo que arma cada llamador—
 * un aviso sin texto se manda vacío y nadie se entera hasta que alguien
 * recibe un mail en blanco. Y peor: el texto de lo que HOTU le dice a la
 * gente quedaría repartido por diez rutas, cada una escribiéndolo un poco
 * distinto.
 *
 * ============================================================
 * LA GUARDA NO ES PARTE DEL INTERRUPTOR
 * ============================================================
 *
 * MAIL_ENVIO decide si se envía de verdad. La guarda de dominios
 * imposibles corre SIEMPRE, encendido o apagado, porque no es una
 * precaución de desarrollo: es una regla.
 *
 * @perfil.hotu.local y @test.hotu.local no existen. Cada intento sería un
 * hard bounce, y una tanda de hard bounces es la forma más rápida de
 * quemar la reputación de un dominio nuevo — justo el día que se estrena.
 * Hoy en la base hay 20 cuentas de esos dominios, y las 18 cuentas dueñas
 * de los perfiles de producción son todas @perfil.hotu.local.
 *
 * Lo suprimido SE REGISTRA, con el motivo. "No se mandó" sin decir por
 * qué es indistinguible de un bug.
 */

import { neon } from "@neondatabase/serverless";
import { limpiarTexto, recortar } from "./texto";

const sql = neon(process.env.DATABASE_URL!);

/**
 * ¿Está encendido el envío real?
 *
 * Se lee en cada llamada y no una vez al importar: en serverless una
 * instancia puede vivir horas, y "lo apagué y sigue mandando" es la clase
 * de sorpresa que un interruptor de seguridad no puede dar.
 *
 * El default es APAGADO. Y hoy, aunque se encendiera, no hay transporte
 * detrás: la única implementación es la que registra.
 */
export function envioHabilitado(): boolean {
  return process.env.MAIL_ENVIO === "1";
}

/**
 * Dominios a los que NUNCA se escribe.
 *
 * No es una lista de "entornos de prueba": es una lista de dominios que
 * NO EXISTEN. Escribirles no falla en HOTU, falla en el servidor de
 * correo del otro lado, y esa falla la paga la reputación del remitente.
 */
const DOMINIOS_IMPOSIBLES = ["@perfil.hotu.local", "@test.hotu.local"];

export function dominioImposible(email: string): string | null {
  const e = email.trim().toLowerCase();
  return DOMINIOS_IMPOSIBLES.find((d) => e.endsWith(d)) ?? null;
}

/* ===================================================================
 * LOS AVISOS
 * =================================================================== */

/** Un perfil, sin importar si es artista o colectivo. */
export type PerfilRef = { tipo: "artist" | "collective"; slug: string; nombre: string };

export type Aviso =
  /** Al reclamante, en cuanto manda el reclamo. */
  | { tipo: "reclamo_recibido"; para: string; perfil: PerfilRef }
  /** A cada moderador: hay algo esperando una decisión. */
  | { tipo: "reclamo_en_cola"; para: string; perfil: PerfilRef; reclamante: string }
  /** Al contact_email público del perfil: alguien lo reclamó. */
  | { tipo: "reclamo_avisa_perfil"; para: string; perfil: PerfilRef }
  /** Al reclamante: ya es suyo. */
  | { tipo: "reclamo_aprobado"; para: string; perfil: PerfilRef }
  /** Al reclamante: no, y por qué. El motivo es lo único que recibe. */
  | { tipo: "reclamo_rechazado"; para: string; perfil: PerfilRef; motivo: string }

  /**
   * LAS TRES DE CONVOCATORIAS (§7) LLEVAN `evento` Y `colectivo` COMO TEXTO Y NO UN id.
   *
   * El aviso tiene que seguir siendo legible cuando el evento ya pasó, y con un id habría
   * que ir a buscar el título a la base cada vez que alguien lee la bandeja — o peor, el
   * título podría haber cambiado y el aviso diría algo distinto de lo que decía el día que
   * se mandó. Un aviso es una foto de lo que se dijo, no una consulta.
   *
   * `motivo` es string | null en las tres: opcional al rechazar —decidido, para que el dueño
   * no deje postulaciones sin resolver por no tener que escribirlo— y obligatorio al
   * cancelar, donde lo exige el write path y también un CHECK de la base. El tipo acepta
   * null porque hay un rechazo sin motivo legítimo: el que sale del cierre de la
   * convocatoria, que no lo escribió nadie.
   */
  | { tipo: "postulacion_aceptada"; para: string; artista: PerfilRef; evento: string; colectivo: string; motivo: string | null }
  | { tipo: "postulacion_rechazada"; para: string; artista: PerfilRef; evento: string; colectivo: string; motivo: string | null }
  | { tipo: "postulacion_cancelada"; para: string; artista: PerfilRef; evento: string; colectivo: string; motivo: string | null }

  /**
   * EL RECORTE DEL CIERRE: la fiesta se movió para atrás y la convocatoria se acortó con
   * ella. Va al DJ con postulación PENDIENTE, que es a quien le cambia algo — el plazo que
   * tiene para que le respondan.
   *
   * `cierraEn` es el DÍA, no un instante, porque es lo que la persona necesita saber. La
   * hora exacta del recorte es el fin de ese día en Bogotá y decirla no agregaría nada.
   */
  | { tipo: "convocatoria_cierre_recortado"; para: string; artista: PerfilRef; evento: string; colectivo: string; cierraEn: string };

export type TipoAviso = Aviso["tipo"];

/** Lo que se imprime si una cancelación llegara sin motivo, que no debería pasar. */
const SIN_MOTIVO = "(no dejaron motivo)";

const QUE_ES = (p: PerfilRef) => (p.tipo === "artist" ? "el perfil de DJ" : "el colectivo");
const DONDE = (p: PerfilRef) =>
  p.tipo === "artist" ? `/artistas/${p.slug}` : `/colectivos/${p.slug}`;

/**
 * El texto de cada aviso, en un solo lugar.
 *
 * El switch es exhaustivo por construcción: el `never` del default hace
 * que agregar una variante a Aviso sin plantilla no compile.
 *
 * Sin links absolutos a propósito: HOTU todavía no tiene dominio, y
 * escribir hotu-one.vercel.app en un mail que se va a mandar dentro de
 * meses es dejar una URL vieja en un texto que nadie va a releer. La ruta
 * relativa se completa cuando haya dominio, en un solo lugar.
 */
function plantilla(a: Aviso): { asunto: string; cuerpo: string; referencia: string } {
  switch (a.tipo) {
    case "reclamo_recibido":
      return {
        asunto: `Recibimos tu reclamo de ${a.perfil.nombre}`,
        cuerpo:
          `Pedí ${QUE_ES(a.perfil)} ${a.perfil.nombre} (${DONDE(a.perfil)}).\n\n` +
          "Lo revisa una persona, no un automático, así que no te podemos prometer un " +
          "plazo. Mientras tanto podés ver el estado de tu reclamo en tu perfil.\n\n" +
          "Si no fuiste vos, ignorá este mensaje: sin aprobación no cambia nada.",
        referencia: `${a.perfil.tipo}:${a.perfil.slug}`,
      };

    case "reclamo_en_cola":
      return {
        asunto: `Hay un reclamo esperando: ${a.perfil.nombre}`,
        cuerpo:
          `${a.reclamante} reclama ${QUE_ES(a.perfil)} ${a.perfil.nombre} ` +
          `(${DONDE(a.perfil)}).\n\n` +
          "Está en la cola de reclamos del panel, con lo que escribió y cómo se " +
          "registró.",
        referencia: `${a.perfil.tipo}:${a.perfil.slug}`,
      };

    case "reclamo_avisa_perfil":
      return {
        asunto: `Alguien reclamó ${a.perfil.nombre}`,
        cuerpo:
          `Recibimos un reclamo sobre ${QUE_ES(a.perfil)} ${a.perfil.nombre} ` +
          `(${DONDE(a.perfil)}).\n\n` +
          "Te escribimos a la dirección de contacto del perfil porque hoy no tiene " +
          "dueño en HOTU. Si el perfil es tuyo y no fuiste vos quien lo reclamó, " +
          "respondé este mensaje antes de que lo aprobemos.",
        referencia: `${a.perfil.tipo}:${a.perfil.slug}`,
      };

    case "reclamo_aprobado":
      return {
        asunto: `${a.perfil.nombre} ya es tuyo`,
        cuerpo:
          `Aprobamos tu reclamo de ${QUE_ES(a.perfil)} ${a.perfil.nombre}.\n\n` +
          `Entrá a ${DONDE(a.perfil)} con tu cuenta y editalo donde lo ves: la foto, ` +
          "la biografía, tus sets y tus tracks.",
        referencia: `${a.perfil.tipo}:${a.perfil.slug}`,
      };

    case "reclamo_rechazado":
      return {
        asunto: `No aprobamos tu reclamo de ${a.perfil.nombre}`,
        cuerpo:
          `Revisamos tu reclamo de ${QUE_ES(a.perfil)} ${a.perfil.nombre} y no lo ` +
          `aprobamos.\n\nMotivo:\n${a.motivo}\n\n` +
          "Si podés aportar algo que no tuvimos en cuenta, volvé a reclamarlo.",
        referencia: `${a.perfil.tipo}:${a.perfil.slug}`,
      };

    case "postulacion_aceptada":
      return {
        asunto: `Te aceptaron para ${a.evento}`,
        cuerpo:
          `${a.colectivo} aceptó tu postulación para ${a.evento}.` +
          `\n\nYa estás en el lineup, así que la fiesta te va a aparecer en tu ` +
          `perfil (${DONDE(a.artista)}).` +
          `\n\nSi no vas a poder, decíselo al colectivo cuanto antes: hay gente ` +
          `que ya vio el lineup.`,
        referencia: `artist:${a.artista.slug}`,
      };

    case "postulacion_rechazada":
      return {
        asunto: `No quedaste para ${a.evento}`,
        cuerpo:
          `${a.colectivo} no te eligió para ${a.evento}.` +
          (a.motivo
            ? `\n\nLo que te dejaron escrito:\n${a.motivo}`
            : `\n\nNo dejaron un motivo, y no siempre lo hay: en una convocatoria ` +
              `con más postulaciones que cupos, la mayoría de las negativas no son sobre ` +
              `vos.`) +
          `\n\nPodés seguir postulándote a otras convocatorias.`,
        referencia: `artist:${a.artista.slug}`,
      };

    case "postulacion_cancelada":
      return {
        asunto: `Se cayó tu fecha en ${a.evento}`,
        cuerpo:
          `${a.colectivo} canceló tu participación en ${a.evento}, así que ya no estás en ` +
          `el lineup.` +
          /**
           * El fallback no debería alcanzarse nunca: cancelar exige motivo en el write path y
           * lo exige event_applications_cancelacion_check. Está igual porque el tipo acepta
           * null —lo necesita el rechazo del cierre automático— y una plantilla que imprimiera
           * "null" en un mail a una persona es peor que una rama que no se usa.
           */
          `\n\nEl motivo que dejaron:\n${a.motivo ?? SIN_MOTIVO}` +
          `\n\nSi habías anunciado la fecha, conviene que la bajes. Y si esto no ` +
          `te cierra, escribile al colectivo: la cancelación la decidieron ellos, no HOTU.`,
        referencia: `artist:${a.artista.slug}`,
      };

    case "convocatoria_cierre_recortado":
      return {
        asunto: `Se movió ${a.evento}, y la convocatoria cierra antes`,
        cuerpo:
          `${a.colectivo} cambió la fecha de ${a.evento}, así que la convocatoria a la ` +
          `que te postulaste ahora cierra el ${a.cierraEn}.` +
          `\n\nTu postulación sigue en pie y no tenés que hacer nada. Te lo ` +
          `avisamos porque el plazo para que te respondan es más corto que antes.`,
        referencia: `artist:${a.artista.slug}`,
      };

    default: {
      // Si esto no compila, hay una variante de Aviso sin plantilla.
      const falta: never = a;
      throw new Error(`Aviso sin plantilla: ${JSON.stringify(falta)}`);
    }
  }
}

export type ResultadoEnvio =
  | { estado: "registrado"; id: number }
  | { estado: "suprimido"; id: number; motivo: string }
  | { estado: "enviado"; id: number }
  | { estado: "fallo"; id: number; motivo: string };

/**
 * Deja constancia del aviso y, si algún día hay transporte, lo manda.
 *
 * NUNCA TIRA. Un aviso que falla no puede voltear la acción que lo
 * disparó: si un reclamo se aprobó, se aprobó, y que el mail no saliera
 * es un problema del mail. El llamador puede mirar el resultado, y lo que
 * pasó queda en la tabla igual.
 *
 * Por eso tampoco va dentro de la transacción de quien lo llama: sería
 * darle a un aviso el poder de deshacer una decisión.
 */
export async function enviar(a: Aviso): Promise<ResultadoEnvio> {
  const para = limpiarTexto(a.para).toLowerCase();
  const { asunto, cuerpo, referencia } = plantilla(a);

  /* ---------- la guarda, antes que el interruptor ---------- */
  const imposible = para === "" ? "sin destinatario" : dominioImposible(para);
  if (imposible) {
    const motivo =
      imposible === "sin destinatario"
        ? "no había destinatario"
        : `${imposible} no existe: mandarle sería un hard bounce`;
    const id = await registrar({
      tipo: a.tipo,
      // Con destinatario vacío la fila no se puede insertar (CHECK de
      // para no vacío), así que se guarda algo que diga qué pasó.
      para: para === "" ? "(vacío)" : para,
      asunto,
      cuerpo,
      referencia,
      estado: "suprimido",
      motivo,
    });
    return { estado: "suprimido", id, motivo };
  }

  const id = await registrar({
    tipo: a.tipo,
    para,
    asunto,
    cuerpo,
    referencia,
    estado: "registrado",
    motivo: null,
  });

  /**
   * ACÁ VA RESEND, Y HOY NO HAY NADA.
   *
   * Cuando haya dominio: si envioHabilitado(), llamar al proveedor y
   * marcar la fila 'enviado' con enviado_en, o 'fallo' con el motivo. La
   * fila ya existe, así que un proveedor que se cae deja la constancia de
   * lo que se quiso mandar, no un hueco.
   *
   * Mientras tanto queda 'registrado', que significa exactamente eso: se
   * decidió mandarlo y no hay por dónde.
   */
  if (envioHabilitado()) {
    const motivo = "MAIL_ENVIO está encendido pero no hay proveedor configurado todavía";
    await sql`UPDATE mail_outbox SET estado = 'fallo', motivo = ${motivo} WHERE id = ${id}`;
    console.warn("[mail]", motivo);
    return { estado: "fallo", id, motivo };
  }

  return { estado: "registrado", id };
}

async function registrar(f: {
  tipo: string;
  para: string;
  asunto: string;
  cuerpo: string;
  referencia: string | null;
  estado: "registrado" | "suprimido";
  motivo: string | null;
}): Promise<number> {
  const [fila] = await sql`
    INSERT INTO mail_outbox (tipo, para, asunto, cuerpo, estado, motivo, referencia)
    VALUES (
      ${f.tipo}, ${recortar(f.para, 320)}, ${recortar(f.asunto, 300)},
      ${recortar(f.cuerpo, 8000)}, ${f.estado}, ${f.motivo}, ${f.referencia}
    )
    RETURNING id
  `;
  return Number(fila.id);
}

/**
 * Manda el mismo aviso a varios, y devuelve uno por destinatario.
 *
 * No corta al primer problema: si hay tres moderadores y el primero tiene
 * un mail imposible, los otros dos tienen que enterarse igual.
 */
export async function enviarA(
  destinatarios: string[],
  construir: (para: string) => Aviso
): Promise<ResultadoEnvio[]> {
  const unicos = [...new Set(destinatarios.map((d) => limpiarTexto(d).toLowerCase()).filter(Boolean))];
  const out: ResultadoEnvio[] = [];
  for (const para of unicos) out.push(await enviar(construir(para)));
  return out;
}

/* ===================================================================
 * LECTURA, para que la bandeja se pueda mirar desde el panel
 * =================================================================== */

export type MailRegistrado = {
  id: number;
  tipo: string;
  para: string;
  /**
   * NULL cuando la fila se purgó por retención. Era `string` a secas, y la migración de los
   * 90 días lo volvió mentiroso: `asunto` pasó a NULLABLE y el tipo seguía prometiendo que
   * siempre hay uno. Hoy el único consumidor es el smoke, que no lo imprime, así que nadie
   * se habría roto — y eso es exactamente lo que lo hace peligroso: el próximo que lo lea
   * va a confiar en el tipo.
   */
  asunto: string | null;
  estado: string;
  motivo: string | null;
  referencia: string | null;
  creadoEn: string;
  /**
   * Cuándo se vació el contenido, o NULL si todavía lo tiene. Va en el tipo porque un asunto
   * en NULL sin esto sería ambiguo: no se podría distinguir "se purgó a los 90 días" de
   * "nunca tuvo asunto". El CHECK de la base garantiza que las dos cosas van juntas.
   */
  purgadoEn: string | null;
};

export async function getMailOutbox(limite = 100): Promise<MailRegistrado[]> {
  const filas = await sql`
    SELECT id, tipo, para, asunto, estado, motivo, referencia, creado_en, purgado_en
    FROM mail_outbox ORDER BY creado_en DESC, id DESC LIMIT ${limite}
  `;
  return filas.map((f) => ({
    id: Number(f.id),
    tipo: f.tipo as string,
    para: f.para as string,
    asunto: (f.asunto as string | null) ?? null,
    estado: f.estado as string,
    motivo: (f.motivo as string | null) ?? null,
    referencia: (f.referencia as string | null) ?? null,
    creadoEn: String(f.creado_en),
    purgadoEn: f.purgado_en ? new Date(f.purgado_en as string).toISOString() : null,
  }));
}
