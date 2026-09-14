"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Heart } from "lucide-react";

/**
 * The follow button on a DJ's press kit.
 *
 * Optimistic: the heart fills on click and the count moves straight away,
 * because a follow is cheap and waiting for a round trip to acknowledge it
 * feels broken. If the request fails, both roll back to the server's last
 * known values rather than to a guess.
 *
 * Signed out, it is a link to sign in and not a dead button — the count is
 * still worth showing, since it is the DJ's audience and public either way.
 */
export function ArtistLikeButton({
  artistSlug,
  initialLiked,
  initialCount,
  signedIn,
}: {
  artistSlug: string;
  initialLiked: boolean;
  initialCount: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  const label = count === 1 ? "PERSONA SIGUE" : "PERSONAS SIGUEN";

  if (!signedIn) {
    return (
      <Link
        href={`/auth/signin?callbackUrl=${encodeURIComponent(`/artistas/${artistSlug}`)}`}
        className="inline-flex items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Heart className="h-3 w-3" /> SEGUIR
        {count > 0 && <span className="text-foreground/70">· {count}</span>}
      </Link>
    );
  }

  async function toggle() {
    const next = !liked;
    // Move first, reconcile after.
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    setBusy(true);
    try {
      const res = await fetch(`/api/likes/artists/${artistSlug}`, {
        method: next ? "POST" : "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLiked(!next);
        setCount(initialCount);
        return;
      }
      // The server's count is authoritative — somebody else may have
      // followed while this click was in flight.
      if (typeof data.count === "number") setCount(data.count);
      // So the profile's "artistas que me gustan" reflects it immediately.
      router.refresh();
    } catch {
      setLiked(!next);
      setCount(initialCount);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={liked}
      className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] disabled:opacity-50 ${
        liked
          ? "border-primary text-primary"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      <Heart className={`h-3 w-3 ${liked ? "fill-current" : ""}`} />
      {liked ? "SIGUIENDO" : "SEGUIR"}
      {count > 0 && (
        <span className="text-foreground/70">
          · {count} {label}
        </span>
      )}
    </button>
  );
}
