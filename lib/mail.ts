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
  | { tipo: "reclamo_rechazado"; para: string; perfil: PerfilRef; motivo: string };

export type TipoAviso = Aviso["tipo"];

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
  asunto: string;
  estado: string;
  motivo: string | null;
  referencia: string | null;
  creadoEn: string;
};

export async function getMailOutbox(limite = 100): Promise<MailRegistrado[]> {
  const filas = await sql`
    SELECT id, tipo, para, asunto, estado, motivo, referencia, creado_en
    FROM mail_outbox ORDER BY creado_en DESC, id DESC LIMIT ${limite}
  `;
  return filas.map((f) => ({
    id: Number(f.id),
    tipo: f.tipo as string,
    para: f.para as string,
    asunto: f.asunto as string,
    estado: f.estado as string,
    motivo: (f.motivo as string | null) ?? null,
    referencia: (f.referencia as string | null) ?? null,
    creadoEn: String(f.creado_en),
  }));
}
