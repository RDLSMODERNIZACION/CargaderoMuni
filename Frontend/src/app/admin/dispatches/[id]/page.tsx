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

type Station = { id: string; name?: string | null; active: boolean };
type Company = { id: number; name: string; code?: string | null; active: boolean };

type EditForm = {
  station_id: string;
  company_id: string;
  liters: string;
  flow_l_min: string;
  ts: string;
  note: string;
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

function toDateTimeLocal(iso: string) {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
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
  const [stations, setStations] = useState<Station[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    station_id: "",
    company_id: "",
    liters: "",
    flow_l_min: "",
    ts: "",
    note: "",
  });

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


  async function loadMeta() {
    try {
      const [st, co] = await Promise.all([
        apiJSON<Station[]>("/stations"),
        apiJSON<{ ok: boolean; items: Company[] }>("/company?active=false"),
      ]);
      setStations(Array.isArray(st) ? st : []);
      setCompanies(Array.isArray(co?.items) ? co.items : []);
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar estaciones/empresas");
    }
  }

  function openEdit() {
    if (!item) return;
    setEditForm({
      station_id: item.station_id,
      company_id: item.company_id != null ? String(item.company_id) : "",
      liters: item.liters != null ? String(item.liters) : "",
      flow_l_min: item.flow_l_min != null ? String(item.flow_l_min) : "",
      ts: item.ts ? toDateTimeLocal(item.ts) : "",
      note: item.note || "",
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!item || !editForm.station_id || !editForm.company_id) {
      setError("Seleccioná estación y empresa.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiJSON("/water/dispatch/" + item.id, {
        method: "PATCH",
        body: JSON.stringify({
          station_id: editForm.station_id,
          company_id: Number(editForm.company_id),
          liters: editForm.liters === "" ? null : Number(editForm.liters),
          flow_l_min: editForm.flow_l_min === "" ? null : Number(editForm.flow_l_min),
          ts: editForm.ts ? new Date(editForm.ts).toISOString() : item.ts,
          note: editForm.note,
        }),
      });
      setEditOpen(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo editar el despacho");
    } finally {
      setSaving(false);
    }
  }

  async function removeDispatch() {
    if (!item) return;
    const ok = window.confirm(
      "¿Eliminar definitivamente el despacho #" + item.id + "?\n\nEsta acción no se puede deshacer."
    );
    if (!ok) return;

    setError(null);
    try {
      await apiJSON("/water/dispatch/" + item.id, { method: "DELETE" });
      router.push("/admin/dispatches");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar el despacho");
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
    loadMeta();
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

        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-secondary" onClick={load}>
            Actualizar
          </button>
          <button className="btn btn-secondary" onClick={openEdit}>
            Editar
          </button>
          <button
            className="btn"
            onClick={removeDispatch}
            style={{ borderColor: "#fecaca", color: "#b91c1c" }}
          >
            Eliminar
          </button>
        </div>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        <Tabs tabs={tabs} defaultTab="resumen" />
      </section>

      {editOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">Editar despacho #{item.id}</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Modificá los datos administrativos del despacho.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={() => setEditOpen(false)} disabled={saving}>
                Cerrar
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Estación</label>
                <select
                  className="select"
                  value={editForm.station_id}
                  onChange={(e) => setEditForm((p) => ({ ...p, station_id: e.target.value }))}
                >
                  <option value="">Seleccionar</option>
                  {stations.map((st) => (
                    <option key={st.id} value={st.id}>{st.name || st.id}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Empresa</label>
                <select
                  className="select"
                  value={editForm.company_id}
                  onChange={(e) => setEditForm((p) => ({ ...p, company_id: e.target.value }))}
                >
                  <option value="">Seleccionar</option>
                  {companies.map((co) => (
                    <option key={co.id} value={String(co.id)}>{co.name || co.code || co.id}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Litros</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={editForm.liters}
                  onChange={(e) => setEditForm((p) => ({ ...p, liters: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Caudal L/min</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={editForm.flow_l_min}
                  onChange={(e) => setEditForm((p) => ({ ...p, flow_l_min: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs text-slate-500">Fecha y hora</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={editForm.ts}
                  onChange={(e) => setEditForm((p) => ({ ...p, ts: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs text-slate-500">Nota</label>
                <textarea
                  className="input min-h-[90px]"
                  value={editForm.note}
                  onChange={(e) => setEditForm((p) => ({ ...p, note: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn" onClick={saveEdit} disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
