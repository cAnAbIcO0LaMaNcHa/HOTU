import Link from "next/link";
import { getAllEvents, getAllNews, getAllArtists, getAllTracks, getAllSets, getAllCollectives } from "@/lib/db";

export const revalidate = 0;

export default async function AdminHome() {
  const [events, news, artists, tracks, sets, collectives] = await Promise.all([
    getAllEvents({ includeAll: true }),
    getAllNews({ includeAll: true }),
    getAllArtists({ includeAll: true }),
    getAllTracks({ includeAll: true }),
    getAllSets({ includeAll: true }),
    getAllCollectives({ includeAll: true }),
  ]);

  const stats = [
    { label: "EVENTOS", count: events.length, href: "/admin/eventos", editable: true },
    { label: "NOTICIAS", count: news.length, href: "/admin/noticias", editable: true },
    { label: "ARTISTAS", count: artists.length, href: "/artistas", editable: false },
    { label: "DISCOGRAFÍA", count: tracks.length, href: "/discografia", editable: false },
    { label: "SETS", count: sets.length, href: "/sets", editable: false },
    { label: "COLECTIVOS", count: collectives.length, href: "/colectivos", editable: false },
  ];

  return (
    <div>
      <p className="font-mono text-sm text-muted-foreground">Los cambios que hagas acá se publican al instante en el sitio.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="sheen border-chrome block p-6 transition-colors hover:border-primary">
            <div className="font-mono text-[10px] tracking-widest text-primary">{s.label}</div>
            <div className="mt-2 text-4xl font-bold">{s.count}</div>
            <div className="mt-3 font-mono text-[10px] tracking-widest text-muted-foreground">{s.editable ? "EDITABLE →" : "SOLO LECTURA"}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
