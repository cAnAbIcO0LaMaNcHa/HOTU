import type { Metadata } from "next";
import { ColaNoticias } from "@/components/cola-noticias";
import { getNewsInReview } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Noticias · Cola de aprobación",
  robots: { index: false, follow: false },
};

/**
 * /admin/noticias — la cola de aprobación (tanda 5 §4).
 *
 * ============================================================
 * ACÁ HABÍA UN CMS. YA NO.
 * ============================================================
 *
 * Esta pantalla era el formulario donde HOTU escribía sus noticias y
 * editaba las de todos, con selectores de alcance, idioma, destacado y
 * estado. Existía porque no había otra forma de que una noticia
 * existiera; eso fue una muleta y ahora sobra.
 *
 * Las noticias las escriben los colectivos y los venues desde su panel.
 * Acá solo se decide si salen. Lo que se aprueba es PUBLICAR: el texto
 * ya está escrito y su autor ya lo mandó, así que se revisa algo
 * completo y no un formulario vacío.
 *
 * El permiso lo pone el layout de /admin, que exige moderador. La ruta
 * de escritura lo vuelve a comprobar por su cuenta: esconder una
 * pantalla es presentación, nunca protección.
 */
export default async function AdminNoticiasPage() {
  const pendientes = await getNewsInReview();

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">NOTICIAS DE LA COMUNIDAD</h1>
        <span className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          {pendientes.length} ESPERANDO
        </span>
      </div>
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
        Lo más viejo primero. Cada tarjeta trae el texto entero: no hace falta abrir
        nada para decidir. Aprobar es lo que la publica; rechazar la devuelve a su
        autor con el motivo, y la puede corregir y volver a mandar sin límite.
      </p>

      <ColaNoticias pendientes={pendientes} />
    </section>
  );
}
