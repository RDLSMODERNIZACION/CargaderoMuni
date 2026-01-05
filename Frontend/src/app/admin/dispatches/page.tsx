"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Dispatch } from "../../../lib/types";
import { fmtDate, fmtLiters } from "../../../lib/utils";
// ✅ IMPORT CORRECTO (named export)
import { apiJSON } from "../../../lib/api/api";

// ✅ Cargar componentes “problemáticos” solo en cliente (evita hydration mismatch)
const DataTable = dynamic(() => import("../../../components/DataTable"), { ssr: false }) as any;
const Drawer = dynamic(() => import("../../../components/Drawer"), { ssr: false }) as any;
const Tabs = dynamic(() => import("../../../components/Tabs"), { ssr: false }) as any;
const PhotoGallery = dynamic(() => import("../../../components/PhotoGallery"), { ssr: false }) as any;

type Column<T> = any; // para no pelear con types del dynamic

function plateNorm(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function plateOf(d: Dispatch): string {
  const snap = (d as any).vehicle_plate_snapshot as string | undefined;
  if (snap && snap.trim()) return plateNorm(snap);
  const notes = (d as any).notes as string | undefined;
  if (notes) {
    const m = notes.match(/(?:patente|plate)\s*[: ]*([A-Z0-9 -]{5,10})/i);
    if (m?.[1]) return plateNorm(m[1]);
  }
  return "—";
}

type Station = { id: string; name?: string | null; active: boolean };
type CompanyItem = { code: string; name?: string | null; active?: boolean };

export default function DispatchesPage() {
  const NONE = "__NONE__";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [stations, setStations] = useState<Station[]>([]);
  const [users, setUsers] = useState<CompanyItem[]>([]);
  const [rows, setRows] = useState<Dispatch[]>([]);

  const [qStation, setQStation] = useState("");
  const [qUser, setQUser] = useState("");
  const [qPlate, setQPlate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const stationNameById = useMemo(() => {
    const m = new Map<string, string>();
    stations.forEach((s) => m.set(s.id, s.name || s.id));
    return m;
  }, [stations]);

  const userNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.code, u.name || u.code));
    return m;
  }, [users]);

  const plates = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((d) => {
      const p = plateOf(d);
      if (p !== "—") set.add(p);
    });
    return Array.from(set).sort();
  }, [rows]);

  async function loadMeta() {
    setLoadingMeta(true);
    setError(null);
    try {
      // ✅ Debug rápido (sacalo después si querés)
      // console.log("API_BASE", process.env.NEXT_PUBLIC_API_BASE);

      const st = await apiJSON<Station[]>("/stations");
      setStations(Array.isArray(st) ? st : []);

      const comp = await apiJSON<{ ok: boolean; items: CompanyItem[] }>("/company");
      setUsers(Array.isArray(comp?.items) ? comp.items : []);

      // default station (si no hay)
      setQStation((prev) => {
        if (prev) return prev;
        const firstActive = (Array.isArray(st) ? st : []).find((x) => x.active) ?? (Array.isArray(st) ? st : [])[0];
        return firstActive?.id ?? "";
      });
    } catch (e: any) {
      setError(e?.message ?? "Error cargando estaciones/usuarios");
    } finally {
      setLoadingMeta(false);
    }
  }

  async function loadDispatches() {
    setLoadingRows(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (qStation) qs.set("station_id", qStation);
      qs.set("limit", "200");

      const data = await apiJSON<Dispatch[]>(`/water/dispatch/recent?${qs.toString()}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando despachos");
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }

  useEffect(() => {
    if (!mounted) return;
    loadMeta();
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    loadDispatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, qStation]);

  const filtered = useMemo(() => {
    return rows.filter((d) => {
      const stationId = (d as any).station_id as string | undefined;
      const companyCode =
        ((d as any).company_code as string | undefined) ??
        ((d as any).pin_user_id as string | number | undefined)?.toString();

      const okStation = !qStation || stationId === qStation;
      const okUser = !qUser || String(companyCode ?? "") === qUser;

      const start = from ? new Date(from).getTime() : -Infinity;
      const end = to ? new Date(to).getTime() : Infinity;
      const dt = (d as any).started_at ? new Date((d as any).started_at).getTime() : 0;
      const okDate = dt >= start && dt <= end;

      const plate = plateOf(d);
      const okPlate = !qPlate || (qPlate === NONE ? plate === "—" : plate === qPlate);

      return okStation && okUser && okDate && okPlate;
    });
  }, [rows, qStation, qUser, qPlate, from, to]);

  const columns: Column<Dispatch>[] = [
    { key: "id", header: "ID", width: "80px" },
    {
      key: "station_name",
      header: "Estación",
      render: (r: any) => {
        const stationId = r.station_id;
        return r.station_name || stationNameById.get(stationId) || stationId || "—";
      },
    },
    {
      key: "user_name",
      header: "Usuario",
      render: (r: any) => {
        const code = r.company_code ?? String(r.pin_user_id ?? "");
        return r.user_name || userNameByCode.get(code) || code || "—";
      },
    },
    { key: "patente", header: "Patente", render: (r: any) => <code>{plateOf(r)}</code> },
    { key: "litros_autorizados", header: "Autorizados", render: (r: any) => fmtLiters(r.litros_autorizados ?? 0) },
    { key: "litros_entregados", header: "Entregados", render: (r: any) => fmtLiters(r.litros_entregados ?? 0) },
    { key: "started_at", header: "Inicio", render: (r: any) => (r.started_at ? fmtDate(r.started_at) : "—") },
    { key: "ended_at", header: "Fin", render: (r: any) => (r.ended_at ? fmtDate(r.ended_at) : "—") },
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
            <label className="text-xs text-slate-500">Usuario</label>
            <select className="select" value={qUser} onChange={(e) => setQUser(e.target.value)}>
              <option value="">Todos</option>
              {users.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name || u.code}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Patente</label>
            <select className="select" value={qPlate} onChange={(e) => setQPlate(e.target.value)}>
              <option value="">Todas</option>
              <option value={NONE}>Sin patente</option>
              {plates.map((p) => (
                <option key={p} value={p}>
                  {p}
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
        </div>
      </section>

      <section className="card">
        {loading ? (
          <div className="text-sm text-slate-500">Cargando…</div>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            initialSortKey="started_at"
            initialSortDir="desc"
            onRowClick={(row: any) => setSelectedId(row.id)}
            rowClassName={(row: any) => (selectedId === row.id ? "bg-sky-50" : "")}
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
                      <b>Estación:</b>{" "}
                      {(selected as any).station_name ||
                        stationNameById.get((selected as any).station_id) ||
                        (selected as any).station_id ||
                        "—"}
                    </div>
                    <div>
                      <b>Usuario:</b>{" "}
                      {(selected as any).user_name ||
                        userNameByCode.get((selected as any).company_code) ||
                        (selected as any).company_code ||
                        "—"}
                    </div>
                    <div>
                      <b>Patente:</b> <code>{plateOf(selected)}</code>
                    </div>
                    <div>
                      <b>Inicio:</b>{" "}
                      {(selected as any).started_at ? fmtDate((selected as any).started_at) : "—"}
                    </div>
                    <div>
                      <b>Fin:</b> {(selected as any).ended_at ? fmtDate((selected as any).ended_at) : "—"}
                    </div>
                    <div>
                      <b>Autorizados:</b> {fmtLiters((selected as any).litros_autorizados ?? 0)}
                    </div>
                    <div>
                      <b>Entregados:</b> {fmtLiters((selected as any).litros_entregados ?? 0)}
                    </div>
                    <div>
                      <b>Notas:</b> {(selected as any).notes || "—"}
                    </div>
                  </div>
                ),
              },
              {
                key: "fotos",
                label: "Fotos",
                content: <PhotoGallery photos={(selected as any).photos || []} />,
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
