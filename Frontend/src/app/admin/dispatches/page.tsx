"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
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
  company_code?: string | null;
  ai_vehicle_analysis?: VehicleAI | null;
};

type Station = { id: string; name?: string | null; active: boolean };

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
  const [rows, setRows] = useState<DispatchItem[]>([]);
  const [qStation, setQStation] = useState("");
  const [qCompany, setQCompany] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stationNameById = useMemo(() => {
    const m = new Map<string, string>();
    stations.forEach((s) => m.set(s.id, s.name || s.id));
    return m;
  }, [stations]);

  const companyOptions = useMemo(() => {
    const m = new Map<string, { id: number; label: string }>();

    for (const r of rows) {
      if (r.company_id == null) continue;
      const key = String(r.company_id);
      const label = r.company_name || r.company_code || `#${r.company_id}`;
      if (!m.has(key)) m.set(key, { id: r.company_id, label });
    }

    return Array.from(m.values()).sort((a, b) => norm(a.label).localeCompare(norm(b.label)));
  }, [rows]);

  async function loadStations() {
    setLoadingMeta(true);
    setError(null);
    try {
      const st = await apiJSON<Station[]>("/stations");
      setStations(Array.isArray(st) ? st : []);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando estaciones");
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
        `/water/dispatch/recent?${qs.toString()}`
      );
      setRows(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando despachos");
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }

  useEffect(() => {
    if (!mounted) return;
    loadStations();
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
      render: (r: DispatchItem) => r.company_name || r.company_code || "—",
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Despachos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Seleccioná un despacho para abrir su detalle completo.
          </p>
        </div>

        <button className="btn" onClick={loadDispatches} disabled={loading}>
          Recargar
        </button>
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
            <input
              type="datetime-local"
              className="input"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Hasta</label>
            <input
              type="datetime-local"
              className="input"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
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
            onRowClick={(row: DispatchItem) => router.push(`/admin/dispatches/${row.id}`)}
          />
        )}
      </section>
    </div>
  );
}
