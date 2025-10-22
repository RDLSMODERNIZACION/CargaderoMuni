
import React from "react";
import type { Photo } from "../lib/types";
import { fmtDate } from "../lib/utils";

export default function PhotoGallery({ photos }: { photos: Photo[] }) {
  if (!photos?.length) return <p className="text-sm text-slate-500">Sin fotos.</p>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {photos.map(p => (
        <figure key={p.id} className="rounded-xl overflow-hidden border border-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.storage_path} alt={`photo-${p.id}`} className="w-full h-40 object-cover" />
          <figcaption className="p-2 text-xs text-slate-600 flex items-center justify-between">
            <span>{fmtDate(p.ts)}</span>
            <span className="text-slate-400">{p.camera_id || ""}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
