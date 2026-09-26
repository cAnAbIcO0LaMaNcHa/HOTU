import Link from "next/link";
import { KeyRound } from "lucide-react";
import { getMisReclamos } from "@/lib/claims-write";

/**
 * LA BANDEJA DEL RECLAMANTE — el equivalente en pantalla de sus mails.
 *
 * ============================================================
 * POR QUÉ NO ALCANZA CON MANDAR EL MAIL
 * ============================================================
 *
 * Hoy HOTU no tiene transporte de correo: los avisos se registran en
 * mail_outbox y no le llegan a nadie. Si el estado del reclamo viviera
 * solo en el mail, el trámite sería completamente invisible para quien lo
 * inició — pide, y después nada, para siempre.
 *
 * Así que esto NO es una duplicación del mail por si acaso: es la vía
 * principal, y el mail es el agregado. El día que haya dominio, quien no
 * abra el correo igual ve acá en qué quedó.
 *
 * Es un server component y de solo lectura a propósito: no hay ninguna
 * acción que el reclamante pueda tomar sobre su propio reclamo. Un botón
 * de "cancelar" suena razonable y no está porque nadie lo pidió, y agregar
 * una escritura sin necesidad es agregar una guarda que mantener.
 */
export async function MisReclamos({ email }: { email: string }) {
  const reclamos = await getMisReclamos(email);
  if (reclamos.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <KeyRound className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
          PERFILES QUE RECLAMASTE
        </h2>
      </div>

      <ul className="mt-4 divide-y divide-border border border-border">
        {reclamos.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link
                href={r.tipo === "artist" ? `/artistas/${r.slug}` : `/colectivos/${r.slug}`}
                className="text-sm font-bold hover:text-primary"
              >
                {r.nombre}
              </Link>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {r.tipo === "artist" ? "PERFIL DE DJ" : "COLECTIVO"}
              </span>
              <span
                className={`ml-auto font-mono text-[10px] tracking-widest ${
                  r.estado === "aprobado"
                    ? "text-primary"
                    : r.estado === "rechazado"
                      ? "text-red-400"
                      : "text-muted-foreground"
                }`}
              >
                {r.estado === "esperando" && "ESPERANDO RESPUESTA"}
                {r.estado === "aprobado" && "APROBADO"}
                {r.estado === "rechazado" && "RECHAZADO"}
                {r.estado === "cerrado" && "CERRADO"}
              </span>
            </div>

            {r.estado === "esperando" && (
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Lo revisa una persona, así que no hay un plazo prometido.
              </p>
            )}
            {r.estado === "aprobado" && (
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Ya es tuyo: entrá al perfil y editalo donde lo ves.
              </p>
            )}
            {/* El motivo de un rechazo es lo único que la persona recibe, así
                que va completo y no recortado. */}
            {r.estado === "rechazado" && r.motivo && (
              <p className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">Motivo:</strong> {r.motivo}
              </p>
            )}
            {r.estado === "cerrado" && (
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {r.motivo ?? "Se cerró sin respuesta."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
