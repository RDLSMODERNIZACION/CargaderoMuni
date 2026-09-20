"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Tabs from "../../../../components/Tabs";
import { apiJSON } from "../../../../lib/api/api";
import { fmtDate, fmtLiters } from "../../../../lib/utils";

type VehicleAI = {
  status?: string;
  plate?: string | null;
  plate_confidence?: number;
  company_visible?: string | null;
  company_confidence?: number;
  matches_expected_company?: boolean | null;
  match_confidence?: number;
  vehicle_type?: string | null;
  visible_text?: string[];
  notes?: string | null;
  model?: string;
  photo_count?: number;
};

type DispatchDetail = {
  id: number;
  ts: string;
  station_id: string;
  station_name?: string | null;
  liters: number | null;
  flow_l_min?: number | null;
  photo_path?: string | null;
  photo_paths?: string[] | null;
  note?: string | null;
  ai_vehicle_analysis?: VehicleAI | null;
  billing_status?: string | null;
  price_per_m3?: number | null;
  amount?: number | null;
  max_affordable_liters?: number | null;
  debited_at?: string | null;
  company_id?: number | null;
  company_name?: string | null;
  company_code?: string | null;
};

function getPhotoUrls(item: DispatchDetail | null): string[] {
  if (!item) return [];
  const urls = new Set<string>();

  if (Array.isArray(item.photo_paths)) {
    item.photo_paths.forEach((p) => {
      if (typeof p === "string" && p.trim()) urls.add(p.trim());
    });
  }

  if (item.photo_path?.trim()) urls.add(item.photo_path.trim());
  return Array.from(urls);
}

function pct(value?: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function StatusPill({ ok, children }: { ok?: boolean | null; children: React.ReactNode }) {
  const cls =
    ok === true
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : ok === false
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-slate-50 text-slate-600 border-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export default function DispatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dispatchId = Number(params.id);

  const [item, setItem] = useState<DispatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photos = useMemo(() => getPhotoUrls(item), [item]);
  const ai = item?.ai_vehicle_analysis || {};

  async function load() {
    if (!Number.isFinite(dispatchId)) return;

    setLoading(true);
    setError(null);

    try {
      const res = await apiJSON<{ ok: boolean; item: DispatchDetail }>(
        `/water/dispatch/${dispatchId}`
      );
      setItem(res.item);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar el despacho");
    } finally {
      setLoading(false);
    }
  }

  async function reanalyze() {
    if (!item) return;

    setAiLoading(true);
    setError(null);

    try {
      const res = await apiJSON<{ ok: boolean; dispatch_id: number; analysis: VehicleAI }>(
        `/ai/vehicle/dispatch/${item.id}`,
        { method: "POST" }
      );
      setItem((prev) =>
        prev ? { ...prev, ai_vehicle_analysis: res.analysis } : prev
      );
    } catch (e: any) {
      setError(e?.message ?? "Error analizando fotos con IA");
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [dispatchId]);

  if (loading) {
    return <div className="text-sm text-slate-500">Cargando despacho…</div>;
  }

  if (error && !item) {
    return (
      <div className="space-y-4">
        <button className="btn btn-secondary" onClick={() => router.push("/admin/dispatches")}>
          ← Volver a despachos
        </button>
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!item) return null;

  const companyCheck =
    ai.matches_expected_company === true
      ? "Coincide con la empresa del PIN"
      : ai.matches_expected_company === false
      ? "No coincide con la empresa del PIN"
      : "Sin evidencia suficiente";

  const tabs = [
    {
      key: "resumen",
      label: "Resumen",
      content: (
        <div className="grid lg:grid-cols-3 gap-4">
          <section className="card lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4">Datos principales</h2>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <div>
                <div className="text-xs text-slate-500">Estación</div>
                <div className="font-medium">{item.station_name || item.station_id}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Fecha</div>
                <div className="font-medium">{item.ts ? fmtDate(item.ts) : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Empresa</div>
                <div className="font-medium">{item.company_name || item.company_code || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Litros</div>
                <div className="font-medium">{fmtLiters(item.liters ?? 0)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Caudal</div>
                <div className="font-medium">
                  {item.flow_l_min != null ? `${item.flow_l_min} L/min` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Fotos</div>
                <div className="font-medium">{photos.length}</div>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="text-lg font-semibold mb-4">Identificación IA</h2>
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs text-slate-500">Patente</div>
                <div className="text-xl font-bold tracking-wide">{ai.plate || "—"}</div>
                {ai.plate && (
                  <div className="text-xs text-slate-500 mt-1">
                    Confianza: {pct(ai.plate_confidence)}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-slate-500">Empresa visible</div>
                <div className="font-semibold">{ai.company_visible || "—"}</div>
                {ai.company_visible && (
                  <div className="text-xs text-slate-500 mt-1">
                    Confianza: {pct(ai.company_confidence)}
                  </div>
                )}
              </div>

              <StatusPill ok={ai.matches_expected_company}>
                {companyCheck}
              </StatusPill>
            </div>
          </section>

          <section className="card lg:col-span-3">
            <h2 className="text-lg font-semibold mb-2">Nota</h2>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{item.note || "Sin nota"}</p>
          </section>
        </div>
      ),
    },
    {
      key: "fotos",
      label: "Fotos",
      badge: <span className="badge bg-slate-100 text-slate-700">{photos.length}</span>,
      content: (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {photos.length > 0 ? (
            photos.map((url, index) => (
              <article key={url} className="card">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold">Foto {index + 1}</div>
                  <span className="text-xs text-slate-500">
                    {index === 0 ? "Principal" : `Cámara ${index + 1}`}
                  </span>
                </div>
                <a href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    alt={`Foto ${index + 1} despacho ${item.id}`}
                    className="w-full h-72 object-contain rounded-lg border bg-white"
                    loading="lazy"
                  />
                </a>
                <div className="mt-3">
                  <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary">
                    Abrir imagen
                  </a>
                </div>
              </article>
            ))
          ) : (
            <div className="card text-sm text-slate-500">Este despacho no tiene fotos.</div>
          )}
        </div>
      ),
    },
    {
      key: "ia",
      label: "IA",
      content: (
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="card">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">Análisis del vehículo</h2>
                <p className="text-sm text-slate-500">
                  Resultado obtenido desde las fotos del despacho.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={reanalyze}
                disabled={aiLoading || photos.length === 0}
              >
                {aiLoading ? "Analizando…" : "Reanalizar"}
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-slate-500">Estado</div>
                <div className="font-medium">{ai.status || "Sin analizar"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Modelo</div>
                <div className="font-medium">{ai.model || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Patente</div>
                <div className="font-medium">{ai.plate || "—"} · {pct(ai.plate_confidence)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Empresa visible</div>
                <div className="font-medium">
                  {ai.company_visible || "—"} · {pct(ai.company_confidence)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Tipo de vehículo</div>
                <div className="font-medium">{ai.vehicle_type || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Comparación</div>
                <StatusPill ok={ai.matches_expected_company}>{companyCheck}</StatusPill>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="text-lg font-semibold mb-4">Texto detectado</h2>
            {ai.visible_text?.length ? (
              <div className="flex flex-wrap gap-2">
                {ai.visible_text.map((text, index) => (
                  <span
                    key={`${text}_${index}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm"
                  >
                    {text}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">Sin texto detectado.</div>
            )}

            {ai.notes && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500 mb-1">Observación de IA</div>
                <p className="text-sm text-slate-700">{ai.notes}</p>
              </div>
            )}
          </section>
        </div>
      ),
    },
    {
      key: "despacho",
      label: "Datos del despacho",
      content: (
        <section className="card">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 text-sm">
            <div>
              <div className="text-xs text-slate-500">ID</div>
              <div className="font-medium">#{item.id}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Estado de facturación</div>
              <div className="font-medium">{item.billing_status || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Precio por m³</div>
              <div className="font-medium">{item.price_per_m3 ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Importe</div>
              <div className="font-medium">{item.amount ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Máximo autorizado</div>
              <div className="font-medium">
                {item.max_affordable_liters != null
                  ? fmtLiters(item.max_affordable_liters)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Debitado</div>
              <div className="font-medium">
                {item.debited_at ? fmtDate(item.debited_at) : "—"}
              </div>
            </div>
          </div>
        </section>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            className="text-sm text-slate-500 hover:text-slate-800 mb-2"
            onClick={() => router.push("/admin/dispatches")}
          >
            ← Volver a despachos
          </button>
          <h1 className="text-2xl font-bold">Despacho #{item.id}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {item.company_name || item.company_code || "Sin empresa"} ·{" "}
            {item.station_name || item.station_id}
          </p>
        </div>

        <button className="btn btn-secondary" onClick={load}>
          Actualizar
        </button>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        <Tabs tabs={tabs} defaultTab="resumen" />
      </section>
    </div>
  );
}
