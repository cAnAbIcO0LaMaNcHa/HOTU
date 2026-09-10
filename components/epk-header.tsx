"use client";

import { useState } from "react";
import { MapPin, Mail, Globe } from "lucide-react";
import { EpkEditableSection, Field } from "./epk-editable-section";
import { SOCIAL_PLATFORMS, type Artist, type SocialPlatform } from "@/lib/db";

/** Display names for the social row. Keys match lib/db's SOCIAL_PLATFORMS. */
const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  spotify: "Spotify",
  beatport: "Beatport",
  soundcloud: "SoundCloud",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  shazam: "Shazam",
  appleMusic: "Apple Music",
  web: "Web",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function EpkHeader({ artist, canEdit }: { artist: Artist; canEdit: boolean }) {
  const [name, setName] = useState(artist.name);
  const [genre, setGenre] = useState(artist.genre);
  const [city, setCity] = useState(artist.city);
  const [contactEmail, setContactEmail] = useState(artist.contactEmail ?? "");
  const [photo, setPhoto] = useState(artist.photo ?? "");
  const [coverUrl, setCoverUrl] = useState(artist.coverUrl ?? "");
  const [socials, setSocials] = useState<Record<string, string>>(() =>
    Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, artist.socials?.[p] ?? ""]))
  );

  const links = SOCIAL_PLATFORMS.filter((p) => artist.socials?.[p]);

  return (
    <EpkEditableSection
      slug={artist.slug}
      canEdit={canEdit}
      title="la cabecera"
      buildPatch={() => ({
        name,
        genre,
        city,
        contactEmail: contactEmail.trim() === "" ? null : contactEmail,
        photo: photo.trim() === "" ? null : photo,
        coverUrl: coverUrl.trim() === "" ? null : coverUrl,
        socials,
      })}
      form={(saving) => (
        <>
          <Field label="NOMBRE" value={name} onChange={setName} disabled={saving} />
          <Field label="GÉNERO" value={genre} onChange={setGenre} disabled={saving} />
          <Field label="CIUDAD (DÓNDE VIVÍS)" value={city} onChange={setCity} disabled={saving} />
          <Field
            label="MAIL DE CONTACTO (PÚBLICO)"
            type="email"
            value={contactEmail}
            onChange={setContactEmail}
            placeholder="booking@ejemplo.com"
            disabled={saving}
          />
          <Field
            label="URL DEL AVATAR"
            value={photo}
            onChange={setPhoto}
            placeholder="https://..."
            disabled={saving}
          />
          <Field
            label="URL DE LA PORTADA"
            value={coverUrl}
            onChange={setCoverUrl}
            placeholder="https://..."
            disabled={saving}
          />
          <div className="pt-2">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              LINKS — dejá vacío el que no uses
            </span>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {SOCIAL_PLATFORMS.map((p) => (
                <Field
                  key={p}
                  label={SOCIAL_LABELS[p]}
                  value={socials[p] ?? ""}
                  onChange={(v) => setSocials((s) => ({ ...s, [p]: v }))}
                  placeholder="https://..."
                  disabled={saving}
                />
              ))}
            </div>
          </div>
        </>
      )}
    >
      <div>
        {artist.coverUrl && (
          <div className="border-chrome mb-6 h-40 w-full overflow-hidden md:h-56">
            <img
              src={artist.coverUrl}
              alt={`Portada de ${artist.name}`}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="flex flex-col items-center gap-6 text-center md:flex-row md:items-start md:text-left">
          <div
            data-district={artist.district}
            className="sheen border-chrome flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-full"
          >
            {artist.photo ? (
              <img src={artist.photo} alt={artist.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-4xl font-bold text-chrome">{initials(artist.name)}</span>
            )}
          </div>

          <div>
            <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
              {artist.genre}
            </span>
            <h1 className="mt-4 text-4xl font-bold leading-[0.95] md:text-6xl">{artist.name}</h1>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-xs tracking-widest text-muted-foreground md:justify-start">
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-3 w-3" /> {artist.city}
              </span>
              {artist.contactEmail && (
                <a
                  href={`mailto:${artist.contactEmail}`}
                  className="inline-flex items-center gap-2 hover:text-primary"
                >
                  <Mail className="h-3 w-3" /> {artist.contactEmail}
                </a>
              )}
            </div>

            {/* Empty sections are not rendered — the profile grows with the
                artist instead of showing a wall of blanks. */}
            {links.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
                {links.map((p) => (
                  <a
                    key={p}
                    href={artist.socials[p]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1 font-mono text-[10px] tracking-widest text-foreground/80 hover:border-primary hover:text-primary"
                  >
                    <Globe className="h-3 w-3" />
                    {SOCIAL_LABELS[p]}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </EpkEditableSection>
  );
}
