"use client";

import React, { useEffect, useMemo, useState } from "react";
import { apiJSON } from "../../../lib/api/api";
import { fmtLiters } from "../../../lib/utils";

type Summary = {
  ok: boolean;
  total_liters: number;
  dispatch_count: number;
  companies_count: number;
  stations_count: number;
};

type ByCompanyItem = {
  company_id: number | null;
  company_name?: string | null;
  company_code?: string | null;
  liters: number;
  dispatch_count: number;
};

type ByStationItem = {
  station_id: string;
  station_name?: string | null;
  liters: number;
  dispatch_count: number;
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthToRange(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, (m ?? 1) - 1, 1, 0, 0, 0));
  const next = new Date(Date.UTC(y, (m ?? 1), 1, 0, 0, 0));
  return {
    from: start.toISOString(),
    to: next.toISOString(),
  };
}

export default function ReportsPage() {
  // ✅ filtros de período (mes)
  const [month, setMonth] = useState<string>(currentMonth());

  // ✅ data
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byCompany, setByCompany] = useState<ByCompanyItem[]>([]);
  const [byStation, setByStation] = useState<ByStationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const range = useMemo(() => monthToRange(month), [month]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      qs.set("from", range.from);
      qs.set("to", range.to);

      const [s, c, st] = await Promise.all([
        apiJSON<Summary>(`/kpi/summary?${qs.toString()}`),
        apiJSON<{ ok: boolean; items: ByCompanyItem[] }>(`/kpi/by_company?${qs.toString()}&top=200`),
        apiJSON<{ ok: boolean; items: ByStationItem[] }>(`/kpi/by_station?${qs.toString()}&top=200`),
      ]);

      setSummary(s && (s as any).ok !== false ? s : null);
      setByCompany(Array.isArray(c?.items) ? c.items : []);
      setByStation(Array.isArray(st?.items) ? st.items : []);
    } catch (e: any) {
      setErr(e?.message ?? "Error cargando KPIs");
      setSummary(null);
      setByCompany([]);
      setByStation([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const total = summary?.total_liters ?? 0;
  const totalDispatches = summary?.dispatch_count ?? 0;
  const activeCompanies = summary?.companies_count ?? 0;

  const downloadCSV = (rows: { name: string; liters: number }[], filename: string) => {
    const header = "name,liters\n";
    const body = rows.map((r) => `${(r.name ?? "").replaceAll(",", " ")},${r.liters}`).join("\n");
    const csv = header + body;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const companyRows = useMemo(
    () =>
      byCompany.map((r) => ({
        name: r.company_name || r.company_code || (r.company_id != null ? `#${r.company_id}` : "—"),
        liters: r.liters ?? 0,
      })),
    [byCompany]
  );

  const stationRows = useMemo(
    () =>
      byStation.map((r) => ({
        name: r.station_name || r.station_id,
        liters: r.liters ?? 0,
      })),
    [byStation]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Reportes</h1>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Mes</label>
            <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <button className="btn" onClick={load} disabled={loading}>
            Recargar
          </button>
        </div>
      </div>

      {err && (
        <div className="p-3 rounded border border-red-300 text-red-700 bg-red-50 text-sm">
          {err}
        </div>
      )}

      <section className="grid md:grid-cols-3 gap-3">
        <div className="card">
          <div className="text-sm text-slate-500">Total entregado</div>
          <div className="text-2xl font-semibold">{loading ? "…" : fmtLiters(total)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500"># Despachos</div>
          <div className="text-2xl font-semibold">{loading ? "…" : totalDispatches}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Empresas con cargas</div>
          <div className="text-2xl font-semibold">{loading ? "…" : activeCompanies}</div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">Consumo por empresa</h2>
          <button
            className="btn"
            onClick={() => downloadCSV(companyRows, `consumo_por_empresa_${month}.csv`)}
            disabled={loading || !companyRows.length}
          >
            Descargar CSV
          </button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Litros</th>
            </tr>
          </thead>
          <tbody>
            {companyRows.map((r, idx) => (
              <tr key={`${r.name}-${idx}`}>
                <td>{r.name}</td>
                <td>{fmtLiters(r.liters)}</td>
              </tr>
            ))}
            {!loading && !companyRows.length && (
              <tr>
                <td colSpan={2} className="text-slate-500 py-4">
                  Sin datos para el período.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={2} className="text-slate-500 py-4">
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">Consumo por estación</h2>
          <button
            className="btn"
            onClick={() => downloadCSV(stationRows, `consumo_por_estacion_${month}.csv`)}
            disabled={loading || !stationRows.length}
          >
            Descargar CSV
          </button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Estación</th>
              <th>Litros</th>
            </tr>
          </thead>
          <tbody>
            {stationRows.map((r, idx) => (
              <tr key={`${r.name}-${idx}`}>
                <td>{r.name}</td>
                <td>{fmtLiters(r.liters)}</td>
              </tr>
            ))}
            {!loading && !stationRows.length && (
              <tr>
                <td colSpan={2} className="text-slate-500 py-4">
                  Sin datos para el período.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={2} className="text-slate-500 py-4">
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
