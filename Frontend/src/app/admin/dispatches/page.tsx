"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { fmtDate, fmtLiters } from "../../../lib/utils";
import { apiJSON } from "../../../lib/api/api";

const DataTable = dynamic(() => import("../../../components/DataTable"), { ssr: false }) as any;
const Drawer = dynamic(() => import("../../../components/Drawer"), { ssr: false }) as any;
const Tabs = dynamic(() => import("../../../components/Tabs"), { ssr: false }) as any;
const PhotoGallery = dynamic(() => import("../../../components/PhotoGallery"), { ssr: false }) as any;

type Column<T> = any;

type DispatchItem = {
  id: number;
  ts: string;
  station_id: string;
  liters: number;
  photo_path?: string | null;
  note?: string | null;
  company_id?: number | null;
  company?: string | null;
  company_code?: string | null;
};

type Station = { id: string; name?: string | null; active: boolean };
type Photo = { id: string; url: string; ts?: string };

export default function DispatchesPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [stations, setStations] = useState<Station[]>([]);
  const [rows, setRows] = useState<DispatchItem[]>([]);

  // ✅ filtros
  const [qStation, setQStation] = useState<string>(""); // "" = Todas
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  useEffect(() => {
    if (selectedId != null && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const stationNameById = useMemo(() => {
    const m = new Map<string, string>();
    stations.forEach((s) => m.set(s.id, s.name || s.id));
    return m;
  }, [stations]);

  const selectedPhotos: Photo[] = useMemo(() => {
    if (!selected?.photo_path) return [];
    return [{ id: String(selected.id), url: selected.photo_path, ts: selected.ts }];
  }, [selected]);

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

      // ✅ si hay estación seleccionada, el backend la requiere → enviamos station_id
      // ✅ si es "Todas", probamos sin station_id; si el backend exige station_id y devuelve 422, hacemos fallback
      if (qStation) qs.set("station_id", qStation);

      try {
        const res = await apiJSON<{ ok: boolean; items: DispatchItem[] }>(
          `/water/dispatch/recent?${qs.toString()}`
        );
        setRows(Array.isArray(res?.items) ? res.items : []);
      } catch (e: any) {
        // ✅ fallback: si el backend exige station_id (422) y estamos en "Todas",
        // traemos y unimos por estación
        const msg = String(e?.message ?? "");
        if (!qStation && msg.includes("422")) {
          const all = await Promise.all(
            stations.map(async (s) => {
              const qs2 = new URLSearchParams();
              qs2.set("station_id", s.id);
              qs2.set("limit", "200");
              const r2 = await apiJSON<{ ok: boolean; items: DispatchItem[] }>(
                `/water/dispatch/recent?${qs2.toString()}`
              );
              return Array.isArray(r2?.items) ? r2.items : [];
            })
          );
          const merged = all.flat();
          // ordenar por fecha desc
          merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
          setRows(merged);
        } else {
          throw e;
        }
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    // cuando cambian estaciones (meta) o filtro de estación, recargar
    // (stations se usa para el fallback “todas”)
    loadDispatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, qStation, stations.length]);

  const filtered = useMemo(() => {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;

    return rows.filter((d) => {
      const dt = d.ts ? new Date(d.ts).getTime() : 0;
      return dt >= start && dt <= end;
    });
  }, [rows, from, to]);

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
      render: (r: DispatchItem) => r.company || r.company_code || "—",
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

      {error && (
        <div className="p-3 rounded border border-red-300 text-red-700 bg-red-50 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        <div className="grid md:grid-cols-4 gap-3">
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
            <label className="text-xs text-slate-500">Desde</label>
            <input type="datetime-local" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Hasta</label>
            <input type="datetime-local" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="flex items-end">
            <div className="text-xs text-slate-500">
              {qStation ? `Filtrando por: ${qStation}` : "Mostrando: Todas"}
            </div>
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
                      <b>Empresa:</b> {selected.company || "—"}
                    </div>
                    <div>
                      <b>Código:</b> {selected.company_code || "—"}
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
                  <div className="card">
                    <PhotoGallery photos={selectedPhotos as any} />
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
