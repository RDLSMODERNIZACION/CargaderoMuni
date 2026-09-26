"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { fmtDate, fmtLiters } from "../../../lib/utils";
import { apiJSON } from "../../../lib/api/api";
import { useAuth } from "../../../components/AuthContext";

const DataTable = dynamic(() => import("../../../components/DataTable"), { ssr: false }) as any;

type Column<T> = any;

type VehicleAI = {
  plate?: string | null;
  plate_validation?: { validator: string; validated_at: string };
};

type DispatchItem = {
  id: number;
  ts: string;
  station_id: string;
  liters: number | null;
  ended_at?: string | null;
  timing?: {meter_method?: string; pump_started_at?: string | null; volume_calculation?: unknown};
  photo_path?: string | null;
  photo_paths?: string[] | null;
  company_id?: number | null;
  company_name?: string | null;
  driver_name?: string | null;
  access_method?: string | null;
  company_code?: string | null;
  ai_vehicle_analysis?: VehicleAI | null;
};

type Station = { id: string; name?: string | null; active: boolean };
type Company = { id: number; name: string; code?: string | null; active: boolean };
type StationCompany = Company & { allowed: boolean };

type CreateForm = {
  station_id: string;
  company_id: string;
  liters: string;
  flow_l_min: string;
  ts: string;
  note: string;
};

const emptyCreate: CreateForm = {
  station_id: "",
  company_id: "",
  liters: "",
  flow_l_min: "",
  ts: "",
  note: "",
};

function norm(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}

function photoCount(item: DispatchItem) {
  const urls = new Set<string>();
  if (Array.isArray(item.photo_paths)) {
    item.photo_paths.forEach((p) => {
      if (typeof p === "string" && p.trim()) urls.add(p.trim());
    });
  }
  if (item.photo_path?.trim()) urls.add(item.photo_path.trim());
  return urls.size;
}

export default function DispatchesPage() {
  const { canOperate, canAdmin } = useAuth();
  const router = useRouter();
  const [review, setReview] = useState<DispatchItem | null>(null);
  const [plate, setPlate] = useState("");
  const [savingPlate, setSavingPlate] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actionMenu, setActionMenu] = useState<{
    row: DispatchItem;
    top: number;
    left: number;
  } | null>(null);

  function toggleActionMenu(event: React.MouseEvent<HTMLButtonElement>, row: DispatchItem) {
    event.stopPropagation();

    if (actionMenu?.row.id === row.id) {
      setActionMenu(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 230;
    const menuHeight = canAdmin ? 200 : 150;
    const gap = 8;
    const viewportPadding = 12;

    const left = Math.max(
      viewportPadding,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding)
    );

    const fitsBelow = rect.bottom + gap + menuHeight <= window.innerHeight - viewportPadding;
    const top = fitsBelow
      ? rect.bottom + gap
      : Math.max(viewportPadding, rect.top - menuHeight - gap);

    setActionMenu({ row, top, left });
  }
  const normalizedPlate = plate.toUpperCase().replace(/[\s-]/g, "");
  const validPlate = /^(?:[A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/.test(normalizedPlate);
  async function savePlate() {
    if (!review || !validPlate || savingPlate) return;
    setSavingPlate(true); setReviewError("");
    try {
      const result = await apiJSON<{ok: boolean; analysis: VehicleAI}>(`/ai/vehicle/dispatch/${review.id}/plate`, {
        method: "PATCH", body: JSON.stringify({plate: normalizedPlate}),
      });
      setRows(previous => previous.map(row => row.id === review.id ? {...row, ai_vehicle_analysis: result.analysis} : row));
      setReview(null);
    } catch (e: any) { setReviewError(e.message || "No se pudo guardar la patente"); }
    finally { setSavingPlate(false); }
  }

  async function deleteDispatch(row: DispatchItem) {
    if (deletingId !== null) return;
    const confirmed = window.confirm(
      `¿Eliminar el despacho #${row.id}? Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;

    setActionMenu(null);
    setDeletingId(row.id);
    setError(null);

    try {
      await apiJSON<{ ok: boolean; id: number }>(`/water/dispatch/${row.id}`, {
        method: "DELETE",
      });
      setRows((previous) => previous.filter((item) => item.id !== row.id));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar el despacho");
    } finally {
      setDeletingId(null);
    }
  }
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [stations, setStations] = useState<Station[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [createCompanies, setCreateCompanies] = useState<StationCompany[]>([]);
  const [rows, setRows] = useState<DispatchItem[]>([]);
  const [qStation, setQStation] = useState("");
  const [qCompany, setQCompany] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyCreate);

  const stationNameById = useMemo(() => {
    const m = new Map<string, string>();
    stations.forEach((s) => m.set(s.id, s.name || s.id));
    return m;
  }, [stations]);

  const companyOptions = useMemo(() => {
    if (companies.length) {
      return companies
        .filter((c) => c.active)
        .map((c) => ({ id: c.id, label: c.name || c.code || String(c.id) }))
        .sort((a, b) => norm(a.label).localeCompare(norm(b.label)));
    }

    const m = new Map<string, { id: number; label: string }>();
    for (const r of rows) {
      if (r.company_id == null) continue;
      const key = String(r.company_id);
      const label = r.company_name || r.company_code || "#" + r.company_id;
      if (!m.has(key)) m.set(key, { id: r.company_id, label });
    }
    return Array.from(m.values()).sort((a, b) => norm(a.label).localeCompare(norm(b.label)));
  }, [rows, companies]);

  async function loadMeta() {
    setLoadingMeta(true);
    setError(null);
    try {
      const [st, co] = await Promise.all([
        apiJSON<Station[]>("/stations"),
        apiJSON<{ ok: boolean; items: Company[] }>("/company?active=false"),
      ]);
      setStations(Array.isArray(st) ? st : []);
      setCompanies(Array.isArray(co?.items) ? co.items : []);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando datos");
    } finally {
      setLoadingMeta(false);
    }
  }

  async function loadCreateCompanies(stationId: string) {
    if (!stationId) {
      setCreateCompanies([]);
      return;
    }

    try {
      const data = await apiJSON<{ ok: boolean; items: StationCompany[] }>(
        "/stations/" + encodeURIComponent(stationId) + "/companies"
      );
      setCreateCompanies(
        (Array.isArray(data?.items) ? data.items : []).filter(
          (company) => company.active && company.allowed
        )
      );
    } catch (e: any) {
      setCreateCompanies([]);
      setError(e?.message ?? "No se pudieron cargar las empresas habilitadas");
    }
  }

  async function loadDispatches() {
    setLoadingRows(true);
    setError(null);

    try {
      const qs = new URLSearchParams();
      qs.set("limit", "200");
      if (qStation) qs.set("station_id", qStation);

      const res = await apiJSON<{ ok: boolean; items: DispatchItem[] }>(
        "/water/dispatch/recent?" + qs.toString()
      );
      setRows(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando despachos");
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }

  async function createDispatch() {
    if (!form.station_id || !form.company_id) {
      setError("Seleccioná una estación y una empresa.");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const payload: any = {
        station_id: form.station_id,
        company_id: Number(form.company_id),
        note: form.note.trim() || "despacho creado manualmente",
      };

      if (form.liters !== "") payload.liters = Number(form.liters);
      if (form.flow_l_min !== "") payload.flow_l_min = Number(form.flow_l_min);
      if (form.ts) payload.ts = new Date(form.ts).toISOString();

      const created = await apiJSON<{ ok: boolean; id: number }>("/water/dispatch/admin", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setCreateOpen(false);
      setForm(emptyCreate);
      await loadDispatches();
      router.push(("/admin/dispatches/" + created.id) as Route);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear el despacho");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    if (!mounted) return;
    loadMeta();
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    loadDispatches();
  }, [mounted, qStation]);

  useEffect(() => {
    if (!form.station_id) {
      setCreateCompanies([]);
      if (form.company_id) {
        setForm((p) => ({ ...p, company_id: "" }));
      }
      return;
    }

    loadCreateCompanies(form.station_id);
    setForm((p) => ({ ...p, company_id: "" }));
  }, [form.station_id]);

  const filtered = useMemo(() => {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;
    const companyId = qCompany ? Number(qCompany) : null;

    return rows.filter((d) => {
      const dt = d.ts ? new Date(d.ts).getTime() : 0;
      if (!(dt >= start && dt <= end)) return false;
      if (companyId != null && d.company_id !== companyId) return false;
      return true;
    });
  }, [rows, from, to, qCompany]);

  const columns: Column<DispatchItem>[] = [
    { key: "id", header: "ID", width: "80px" },
    {
      key: "station",
      header: "Estación",
      render: (r: DispatchItem) => stationNameById.get(r.station_id) || r.station_id,
    },
    {
      key: "company",
      header: "Empresa",
      render: (r: DispatchItem) => r.company_name || r.company_code || "—",
    },
    {
      key: "access_method", header: "Inicio",
      render: (r: DispatchItem) => ({rfid: r.driver_name ? "RFID" : "RFID · sin identificar", manual: "Manual", company_pin: "PIN empresa"}[r.access_method || ""] || "Sin identificar"),
    },
    {
      key: "driver_name", header: "Camionero",
      render: (r: DispatchItem) => r.driver_name || "Sin identificar",
    },
    {
      key: "plate",
      header: "Patente",
      render: (r: DispatchItem) => <div>{r.ai_vehicle_analysis?.plate || "—"}<div className={r.ai_vehicle_analysis?.plate_validation ? "text-xs text-green-700" : "text-xs text-amber-700"}>{r.ai_vehicle_analysis?.plate_validation ? "Validada" : "Pendiente"}</div></div>,
    },
    {
      key: "liters",
      header: "Volumen",
      render: (r: DispatchItem) => <div>{r.liters == null ? "Pendiente" : fmtLiters(r.liters)}{r.timing?.volume_calculation ? <span className="block text-xs text-slate-500">Estimado por tiempo</span> : null}</div>,
      sort: (a: DispatchItem, b: DispatchItem) => (a.liters ?? 0) - (b.liters ?? 0),
    },
    {
      key: "ts",
      header: "Fecha",
      render: (r: DispatchItem) => (r.ts ? fmtDate(r.ts) : "—"),
      sort: (a: DispatchItem, b: DispatchItem) =>
        new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    },
    {
      key: "duration", header: "Duración",
      render: (r: DispatchItem) => r.timing?.pump_started_at && r.ended_at ? `${((Date.parse(r.ended_at) - Date.parse(r.timing.pump_started_at)) / 60000).toFixed(2)} min` : "—",
    },
    {
      key: "photo",
      header: "Fotos",
      render: (r: DispatchItem) => {
        const count = photoCount(r);
        return count > 0 ? String(count) : "No";
      },
    },
    {
      key: "actions", header: "Acciones",
      render: (r: DispatchItem) => (
        <div onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="btn btn-secondary h-10 w-10 p-0 justify-center rounded-xl text-xl leading-none"
            aria-label={`Acciones del despacho ${r.id}`}
            aria-haspopup="menu"
            aria-expanded={actionMenu?.row.id === r.id}
            onClick={(event) => toggleActionMenu(event, r)}
          >
            ⋮
          </button>
        </div>
      ),
    },
  ];

  if (!mounted) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;

  const loading = loadingMeta || loadingRows;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Despachos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Consultá o administrá despachos manualmente.
          </p>
        </div>

        <div className="flex w-full gap-2 sm:w-auto">
          <button className="btn btn-secondary flex-1 justify-center sm:flex-none" onClick={loadDispatches} disabled={loading}>
            Recargar
          </button>
          {canOperate && (
            <button className="btn flex-1 justify-center sm:flex-none" onClick={() => setCreateOpen(true)}>
              + Nuevo despacho
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-300 text-red-700 bg-red-50 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        <div className="grid md:grid-cols-5 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Estación</label>
            <select className="select" value={qStation} onChange={(e) => setQStation(e.target.value)}>
              <option value="">Todas</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Empresa</label>
            <select className="select" value={qCompany} onChange={(e) => setQCompany(e.target.value)}>
              <option value="">Todas</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Desde</label>
            <input type="datetime-local" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Hasta</label>
            <input type="datetime-local" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="flex items-end justify-end">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setQStation("");
                setQCompany("");
                setFrom("");
                setTo("");
              }}
              disabled={loading}
            >
              Limpiar
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        {loading ? (
          <div className="text-sm text-slate-500">Cargando…</div>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            initialSortKey="ts"
            initialSortDir="desc"
            onRowClick={(row: DispatchItem) => router.push(("/admin/dispatches/" + row.id) as Route)}
          />
        )}
      </section>

      {actionMenu && (
        <>
          <button
            type="button"
            aria-label="Cerrar menú de acciones"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setActionMenu(null)}
          />
          <div
            role="menu"
            aria-label={`Acciones del despacho ${actionMenu.row.id}`}
            className="fixed z-50 w-[230px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
            style={{ top: actionMenu.top, left: actionMenu.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => {
                const id = actionMenu.row.id;
                setActionMenu(null);
                router.push(("/admin/dispatches/" + id) as Route);
              }}
            >
              Ver despacho
            </button>

            {canOperate && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  const row = actionMenu.row;
                  setReview(row);
                  setPlate(row.ai_vehicle_analysis?.plate || "");
                  setReviewError("");
                  setActionMenu(null);
                }}
              >
                Validar patente
              </button>
            )}

            {canAdmin && (
              <>
                <div className="my-1 border-t border-slate-200" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={deletingId === actionMenu.row.id}
                  className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => deleteDispatch(actionMenu.row)}
                >
                  {deletingId === actionMenu.row.id ? "Eliminando…" : "Eliminar despacho"}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {review && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onKeyDown={e => {if (e.key === "Escape" && !savingPlate) setReview(null);}}>
          <section role="dialog" aria-modal="true" aria-labelledby="plate-title" className="bg-white rounded-2xl w-full max-w-4xl p-5 max-h-[90vh] overflow-auto">
            <div className="flex justify-between gap-3"><h2 id="plate-title" className="text-xl font-semibold">Validar datos · Despacho #{review.id}</h2><button className="btn btn-secondary" disabled={savingPlate} onClick={() => setReview(null)}>Cerrar</button></div>
            <p className="text-sm text-slate-500 my-3">Compará la patente con las fotos. Podés abrir cada foto para ampliarla y corregir la lectura antes de confirmar.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {Array.from(new Set([...(review.photo_paths || []), review.photo_path].filter(Boolean))).map(url => <a key={url} href={url!} target="_blank" rel="noopener noreferrer"><img src={url!} alt="Foto del despacho para revisar la patente" className="w-full rounded-lg" /></a>)}
            </div>
            {!photoCount(review) && <p className="my-3 text-amber-700">Este despacho no tiene fotos. Confirmá únicamente si contás con otra evidencia.</p>}
            {review.ai_vehicle_analysis?.plate_validation && <p className="text-sm my-3">Última validación: {review.ai_vehicle_analysis.plate_validation.validator} · {fmtDate(review.ai_vehicle_analysis.plate_validation.validated_at)}</p>}
            <form onSubmit={e => {e.preventDefault(); savePlate();}} className="mt-4 space-y-3">
              <label className="block" htmlFor="review-plate">Patente / dato confirmado</label>
              <input autoFocus id="review-plate" className="input uppercase" value={plate} maxLength={20} onChange={e => setPlate(e.target.value)} placeholder="ABC123 o AB123CD" disabled={savingPlate} />
              <p className={validPlate ? "text-sm text-green-700" : "text-sm text-amber-700"}>{validPlate ? `Formato válido: ${normalizedPlate}. Confirmá que coincida con el camión.` : "Ingresá una patente de auto o camión: ABC123 o AB123CD."}</p>
              {reviewError && <p role="alert" className="text-red-700">{reviewError}</p>}
              <button className="btn" disabled={!validPlate || savingPlate}>{savingPlate ? "Guardando…" : "Confirmar patente"}</button>
            </form>
          </section>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">Nuevo despacho manual</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Para correcciones, pruebas o cargas administrativas.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cerrar
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Estación</label>
                <select
                  className="select"
                  value={form.station_id}
                  onChange={(e) => setForm((p) => ({ ...p, station_id: e.target.value }))}
                >
                  <option value="">Seleccionar</option>
                  {stations.filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name || s.id}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Empresa</label>
                <select
                  className="select"
                  value={form.company_id}
                  onChange={(e) => setForm((p) => ({ ...p, company_id: e.target.value }))}
                >
                  <option value="">Seleccionar</option>
                  {createCompanies.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name || c.code || String(c.id)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Litros</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.liters}
                  onChange={(e) => setForm((p) => ({ ...p, liters: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Caudal L/min</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.flow_l_min}
                  onChange={(e) => setForm((p) => ({ ...p, flow_l_min: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>

              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs text-slate-500">Fecha y hora</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={form.ts}
                  onChange={(e) => setForm((p) => ({ ...p, ts: e.target.value }))}
                />
                <span className="text-xs text-slate-400">Si queda vacío se usa la fecha y hora actual.</span>
              </div>

              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs text-slate-500">Nota</label>
                <textarea
                  className="input min-h-[90px]"
                  value={form.note}
                  onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                  placeholder="Observación administrativa"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancelar
              </button>
              <button className="btn" onClick={createDispatch} disabled={creating}>
                {creating ? "Creando…" : "Crear despacho"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
