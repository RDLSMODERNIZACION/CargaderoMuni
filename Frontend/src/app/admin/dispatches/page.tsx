"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { fmtDate, fmtLiters } from "../../../lib/utils";
import { apiJSON } from "../../../lib/api/api";

const DataTable = dynamic(() => import("../../../components/DataTable"), { ssr: false }) as any;
const Drawer = dynamic(() => import("../../../components/Drawer"), { ssr: false }) as any;
const Tabs = dynamic(() => import("../../../components/Tabs"), { ssr: false }) as any;

type Column<T> = any;

type DispatchItem = {
  id: number;
  ts: string;
  station_id: string;
  liters: number | null;
  flow_l_min?: number | null;
  photo_path?: string | null;
  note?: string | null;

  company_id?: number | null;
  company_name?: string | null;
  company_code?: string | null;
};

type Station = { id: string; name?: string | null; active: boolean };

function norm(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}

function safeFileNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "foto.jpg";
    return decodeURIComponent(last);
  } catch {
    return "foto.jpg";
  }
}

export default function DispatchesPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [stations, setStations] = useState<Station[]>([]);
  const [rows, setRows] = useState<DispatchItem[]>([]);

  // ✅ filtros
  const [qStation, setQStation] = useState<string>(""); // "" = Todas
  const [qCompany, setQCompany] = useState<string>(""); // "" = Todas
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);

  useEffect(() => {
    if (selectedId != null && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const stationNameById = useMemo(() => {
    const m = new Map<string, string>();
    stations.forEach((s) => m.set(s.id, s.name || s.id));
    return m;
  }, [stations]);

  // ✅ opciones de empresa detectadas desde los propios despachos
  const companyOptions = useMemo(() => {
    const m = new Map<string, { id: number; label: string }>();
    for (const r of rows) {
      if (r.company_id == null) continue;
      const key = String(r.company_id);
      if (!m.has(key)) {
        m.set(key, {
          id: r.company_id,
          label: r.company_name || r.company_code || `#${r.company_id}`,
        });
      } else {
        const cur = m.get(key)!;
        const better = r.company_name || r.company_code;
        if (better && (cur.label.startsWith("#") || cur.label === String(cur.id))) cur.label = better;
      }
    }
    const arr = Array.from(m.values());
    arr.sort((a, b) => norm(a.label).localeCompare(norm(b.label)));
    return arr;
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
      if (qCompany) qs.set("company_id", qCompany);

      const res = await apiJSON<{ ok: boolean; items: DispatchItem[] }>(`/water/dispatch/recent?${qs.toString()}`);
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
  }, [mounted, qStation, qCompany, stations.length]);

  const filtered = useMemo(() => {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;
    const companyId = qCompany ? Number(qCompany) : null;

    return rows.filter((d) => {
      const dt = d.ts ? new Date(d.ts).getTime() : 0;
      if (!(dt >= start && dt <= end)) return false;
      if (companyId != null && (d.company_id ?? null) !== companyId) return false;
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
      key: "liters",
      header: "Litros",
      render: (r: DispatchItem) => fmtLiters(r.liters ?? 0),
      sort: (a: DispatchItem, b: DispatchItem) => (a.liters ?? 0) - (b.liters ?? 0),
    },
    {
      key: "ts",
      header: "Fecha",
      render: (r: DispatchItem) => (r.ts ? fmtDate(r.ts) : "—"),
      sort: (a: DispatchItem, b: DispatchItem) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    },
    {
      key: "photo",
      header: "Foto",
      render: (r: DispatchItem) => (r.photo_path ? "Sí" : "No"),
    },
  ];

  if (!mounted) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  const loading = loadingMeta || loadingRows;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Despachos</h1>
        <button className="btn" onClick={loadDispatches} disabled={loading}>
          Recargar
        </button>
      </header>

      {error && <div className="p-3 rounded border border-red-300 text-red-700 bg-red-50 text-sm">{error}</div>}

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
            onRowClick={(row: DispatchItem) => setSelectedId(row.id)}
            rowClassName={(row: DispatchItem) => (selectedId === row.id ? "bg-sky-50" : "")}
          />
        )}
      </section>

      <Drawer open={!!selected} onClose={() => setSelectedId(null)} title={selected ? `Despacho #${selected.id}` : ""}>
        {selected && (
          <Tabs
            defaultTab="resumen"
            tabs={[
              {
                key: "resumen",
                label: "Resumen",
                content: (
                  <div className="space-y-2 text-sm">
                    <div>
                      <b>Estación:</b> {stationNameById.get(selected.station_id) || selected.station_id}
                    </div>
                    <div>
                      <b>Fecha:</b> {selected.ts ? fmtDate(selected.ts) : "—"}
                    </div>
                    <div>
                      <b>Empresa:</b> {selected.company_name || selected.company_code || "—"}
                    </div>
                    <div>
                      <b>Litros:</b> {fmtLiters(selected.liters ?? 0)}
                    </div>
                    <div>
                      <b>Nota:</b> {selected.note || "—"}
                    </div>
                    <div>
                      <b>Foto:</b> {selected.photo_path ? "Sí" : "No"}
                    </div>
                  </div>
                ),
              },
              {
                key: "fotos",
                label: "Fotos",
                badge: (
                  <span className="badge bg-slate-100 text-slate-700">
                    {(selected.photo_path ? 1 : 0).toString()}
                  </span>
                ),
                content: (
                  <div className="space-y-3">
                    {selected.photo_path ? (
                      <div className="card">
                        <div className="text-xs text-slate-500 mb-2">Vista previa</div>

                        <a
                          href={selected.photo_path}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block w-full"
                          title="Abrir en nueva pestaña"
                        >
                          <img
                            src={
                              selected.photo_path.includes("?")
                                ? `${selected.photo_path}&v=${selected.id}`
                                : `${selected.photo_path}?v=${selected.id}`
                            }
                            alt={`Foto despacho ${selected.id}`}
                            className="w-full max-h-[60vh] object-contain rounded-lg border bg-white"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </a>

                        <div className="mt-3 flex items-center gap-2">
                          <a href={selected.photo_path} target="_blank" rel="noreferrer" className="btn btn-secondary">
                            Abrir
                          </a>
                          <a
                            href={selected.photo_path}
                            download={safeFileNameFromUrl(selected.photo_path)}
                            className="btn btn-secondary"
                          >
                            Descargar
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="card text-sm text-slate-500">Sin foto</div>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
