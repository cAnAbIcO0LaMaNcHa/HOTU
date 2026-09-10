"use client";

import { useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { IMAGE_TARGETS, resizeImageFile, type ImageTarget } from "@/lib/image-resize";

/**
 * Picks an image for one profile field: upload a file, or paste a URL.
 *
 * The file is downscaled and re-encoded to webp in the browser BEFORE it
 * leaves the device, so what reaches the store is a couple of hundred KB
 * instead of a multi-megabyte phone photo.
 *
 * The URL box stays as an alternative on purpose. Uploads need a
 * configured blob store, and when that is missing the endpoint answers 503
 * — in that case pasting a link is the only way to set a picture, so the
 * component surfaces the message and leaves the field usable.
 *
 * It only sets the value; nothing is written to the profile until the
 * section is saved.
 */
export function EpkImageField({
  label,
  slug,
  kind,
  target,
  value,
  onChange,
  disabled,
  previewClassName = "h-20 w-20 rounded-full",
}: {
  label: string;
  slug: string;
  /** Where the upload route files it. */
  kind: "avatar" | "cover";
  /** Which longest-edge budget to resize to. */
  target: ImageTarget;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  previewClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const resized = await resizeImageFile(file, IMAGE_TARGETS[target]);

      const body = new FormData();
      body.append("file", resized);
      body.append("slug", slug);
      body.append("kind", kind);

      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo subir (HTTP ${res.status})`);
        return;
      }

      onChange(data.url);
      const kb = Math.max(1, Math.round(resized.size / 1024));
      setNote(
        `Subida: ${kb}KB, máx ${IMAGE_TARGETS[target]}px. Guardá para aplicarla.`
      );
    } catch {
      setError("No se pudo procesar la imagen.");
    } finally {
      setBusy(false);
      // Lets the same file be picked again after an error.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="border border-border p-3">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        {label}
      </span>

      <div className="mt-2 flex items-center gap-3">
        <span
          className={`border-chrome flex shrink-0 items-center justify-center overflow-hidden bg-transparent ${previewClassName}`}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageUp className="h-5 w-5 text-muted-foreground" />
          )}
        </span>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {busy ? "SUBIENDO..." : "SUBIR IMAGEN"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setNote(null);
                setError(null);
              }}
              disabled={disabled || busy}
              className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/60 hover:border-primary hover:text-primary disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> QUITAR
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <label className="mt-3 block">
        <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">
          O PEGÁ UNA URL
        </span>
        <input
          type="url"
          value={value}
          placeholder="https://..."
          disabled={disabled || busy}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
        />
      </label>

      {note && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">{note}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 font-mono text-[10px] text-primary">
          {error}
        </p>
      )}
    </div>
  );
}
