"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { fmtDate, fmtLiters } from "../../../lib/utils";
import { apiJSON } from "../../../lib/api/api";

const DataTable = dynamic(() => import("../../../components/DataTable"), { ssr: false }) as any;

type Column<T> = any;

type VehicleAI = {
  plate?: string | null;
};

type DispatchItem = {
  id: number;
  ts: string;
  station_id: string;
  liters: number | null;
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
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [stations, setStations] = useState<Station[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
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
      render: (r: DispatchItem) => (<div>{r.company_name || r.company_code || "—"}{r.driver_name && <div className="text-xs text-slate-500">{r.driver_name} · RFID</div>}</div>),
    },
    {
      key: "plate",
      header: "Patente IA",
      render: (r: DispatchItem) => r.ai_vehicle_analysis?.plate || "—",
    },
    {
      key: "liters",
      header: "Litros",
      render: (r: DispatchItem) => fmtLiters(r.liters ?? 0),
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
      key: "photo",
      header: "Fotos",
      render: (r: DispatchItem) => {
        const count = photoCount(r);
        return count > 0 ? String(count) : "No";
      },
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
          <button className="btn flex-1 justify-center sm:flex-none" onClick={() => setCreateOpen(true)}>
            + Nuevo despacho
          </button>
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
                  {companyOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.label}</option>
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
