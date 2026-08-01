import Link from "next/link";

const SECTIONS = [
  {
    title: "SECCIONES",
    links: [
      { label: "Noticias", href: "/noticias" },
      { label: "Eventos", href: "/eventos" },
      { label: "Artistas", href: "/artistas" },
      { label: "Colectivos", href: "/colectivos" },
      { label: "Sets", href: "/sets" },
    ],
  },
  {
    title: "COMUNIDAD",
    links: [
      { label: "Discografía", href: "/discografia" },
      { label: "Tienda", href: "/tienda" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-4">
        <div>
          <span className="text-base font-bold text-chrome">HOUSE OF THE UNKNOWN</span>
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            Hub digital de cultura electrónica y techno desde Bogotá. HOTU · 2026.
          </p>
        </div>
        {SECTIONS.map((s) => (
          <div key={s.title}>
            <h4 className="font-mono text-[10px] tracking-widest text-primary">{s.title}</h4>
            <ul className="mt-4 space-y-2 font-mono text-xs">
              {s.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-foreground/80 hover:text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-6 font-mono text-[10px] tracking-widest text-muted-foreground">
          © 2026 HOUSE OF THE UNKNOWN · BOGOTÁ · ALL RIGHTS RESERVED
        </div>
      </div>
    </footer>
  );
}
