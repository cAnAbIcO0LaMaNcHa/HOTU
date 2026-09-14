import Link from "next/link";
import { Heart } from "lucide-react";
import type { LikedArtist } from "@/lib/db";

/**
 * ARTISTAS QUE ME GUSTAN — the follows on the user's own profile.
 *
 * Renders nothing at all when the list is empty, which is the same rule
 * the press kit follows: the profile grows with the account, and an empty
 * heading is just clutter that makes the page look unfinished.
 *
 * Same horizontal carousel as the collective's roster, deliberately —
 * these are the same kind of card and should not look like two systems.
 * When likes reach collectives and venues this section takes them too,
 * which is why the layout is shared rather than copied.
 *
 * A server component: it only reads, so there is no reason to ship it.
 */
export function LikedArtists({ artists }: { artists: LikedArtist[] }) {
  if (artists.length === 0) return null;

  return (
    <div className="mt-16">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <Heart className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
          ARTISTAS QUE ME GUSTAN
        </h2>
      </div>

      <div className="mt-8 flex gap-4 overflow-x-auto pb-2">
        {artists.map((a) => (
          <Link
            key={a.slug}
            href={`/artistas/${a.slug}`}
            className="group w-28 shrink-0 text-center sm:w-32"
          >
            {a.photo ? (
              <img
                src={a.photo}
                alt={a.name}
                className="border-chrome aspect-square w-full rounded-full object-cover transition-colors group-hover:border-primary"
              />
            ) : (
              <span className="sheen border-chrome flex aspect-square w-full items-center justify-center overflow-hidden rounded-full transition-colors group-hover:border-primary">
                <span className="text-lg font-bold text-chrome">
                  {a.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              </span>
            )}
            <span className="mt-2 block truncate font-mono text-[11px] group-hover:text-primary">
              {a.name}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
