"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { apiJSON } from "../../../lib/api/api";
import { fmtLiters } from "../../../lib/utils";

type Summary = {
  ok: boolean;
  total_liters: number;
  dispatch_count: number;
  companies_count: number;
  avg_liters_per_dispatch: number;
};

type ByCompanyItem = {
  company_id: number | null;
  company_name?: string | null;
  company_code?: string | null;
  liters: number;
  dispatch_count: number;
};

type DailyItem = {
  day: string;
  liters: number;
  dispatch_count: number;
};

type DayDispatch = {
  id: number;
  ts: string;
  local_time: string;
  station_id: string;
  station_name?: string | null;
  company_id?: number | null;
  company_name?: string | null;
  company_code?: string | null;
  liters: number;
  plate?: string | null;
  note?: string | null;
};

type ChartMode = "dispatches" | "volume";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthToRange(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, (m ?? 1) - 1, 1, 3, 0, 0));
  const next = new Date(Date.UTC(y, m ?? 1, 1, 3, 0, 0));
  return { from: start.toISOString(), to: next.toISOString() };
}

function monthLabel(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(
    new Date(y, (m ?? 1) - 1, 1)
  );
}

function addMonths(yyyyMm: string, delta: number) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function dayLabel(day: string) {
  const [, , d] = day.split("-");
  return Number(d);
}

function formatDayLong(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, d));
}

function KpiCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function MonthlyBars({
  rows,
  mode,
  selectedDay,
  onSelect,
}: {
  rows: DailyItem[];
  mode: ChartMode;
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  const max = Math.max(
    ...rows.map((r) => (mode === "dispatches" ? r.dispatch_count : r.liters)),
    1
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-[900px] h-[320px] flex items-end gap-1.5 px-2 pt-8">
        {rows.map((row) => {
          const value = mode === "dispatches" ? row.dispatch_count : row.liters;
          const pct = value > 0 ? Math.max((value / max) * 100, 3) : 1;
          const isSelected = selectedDay === row.day;

          return (
            <button
              key={row.day}
              type="button"
              onClick={() => onSelect(row.day)}
              className="group flex-1 min-w-[22px] h-full flex flex-col items-center justify-end focus:outline-none"
              title={
                mode === "dispatches"
                  ? `${formatDayLong(row.day)} · ${row.dispatch_count} despachos`
                  : `${formatDayLong(row.day)} · ${fmtLiters(row.liters)}`
              }
            >
              <div className="h-8 flex items-end justify-center">
                {value > 0 && (
                  <span className={`text-[10px] font-medium ${isSelected ? "text-sky-700" : "text-slate-500"}`}>
                    {mode === "dispatches"
                      ? row.dispatch_count
                      : Math.round(row.liters).toLocaleString("es-AR")}
                  </span>
                )}
              </div>

              <div className="w-full h-[235px] flex items-end justify-center border-b border-slate-200">
                <div
                  className={`w-[70%] max-w-[26px] rounded-t-md transition-all ${
                    isSelected
                      ? "bg-sky-700 ring-2 ring-sky-200"
                      : "bg-sky-400 group-hover:bg-sky-500"
                  }`}
                  style={{ height: `${pct}%` }}
                />
              </div>

              <div className={`mt-2 text-[11px] ${isSelected ? "font-bold text-sky-700" : "text-slate-500"}`}>
                {dayLabel(row.day)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth());
  const [mode, setMode] = useState<ChartMode>("dispatches");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byCompany, setByCompany] = useState<ByCompanyItem[]>([]);
  const [dailyRaw, setDailyRaw] = useState<DailyItem[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayDispatches, setDayDispatches] = useState<DayDispatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const range = useMemo(() => monthToRange(month), [month]);

  const daily = useMemo(() => {
    const count = daysInMonth(month);
    const map = new Map(dailyRaw.map((r) => [r.day, r]));
    const [y, m] = month.split("-").map(Number);

    return Array.from({ length: count }, (_, i) => {
      const day = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return map.get(day) || { day, liters: 0, dispatch_count: 0 };
    });
  }, [dailyRaw, month]);

  async function loadMonth() {
    setLoading(true);
    setErr(null);
    setSelectedDay(null);
    setDayDispatches([]);

    try {
      const qs = new URLSearchParams();
      qs.set("from", range.from);
      qs.set("to", range.to);
      const q = qs.toString();

      const [s, c, d] = await Promise.all([
        apiJSON<Summary>(`/kpi/summary?${q}`),
        apiJSON<{ ok: boolean; items: ByCompanyItem[] }>(`/kpi/by_company?${q}&top=200`),
        apiJSON<{ ok: boolean; items: DailyItem[] }>(`/kpi/daily?${q}`),
      ]);

      setSummary(s);
      setByCompany(c.items || []);
      setDailyRaw(d.items || []);
    } catch (e: any) {
      setErr(e?.message ?? "Error cargando KPI");
      setSummary(null);
      setByCompany([]);
      setDailyRaw([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectDay(day: string) {
    setSelectedDay(day);
    setLoadingDay(true);
    setErr(null);

    try {
      const res = await apiJSON<{ ok: boolean; date: string; items: DayDispatch[] }>(
        `/kpi/day_dispatches?date=${encodeURIComponent(day)}`
      );
      setDayDispatches(res.items || []);
    } catch (e: any) {
      setErr(e?.message ?? "Error cargando los despachos del día");
      setDayDispatches([]);
    } finally {
      setLoadingDay(false);
    }
  }

  useEffect(() => {
    loadMonth();
  }, [month]);

  const total = summary?.total_liters ?? 0;
  const dispatches = summary?.dispatch_count ?? 0;
  const avg = summary?.avg_liters_per_dispatch ?? 0;
  const companies = summary?.companies_count ?? 0;
  const selectedDayTotal = dayDispatches.reduce((acc, r) => acc + (r.liters || 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">KPI del cargadero</h1>
          <p className="text-sm text-slate-500 mt-1 capitalize">
            Actividad mensual · {monthLabel(month)}
          </p>
        </div>

        <div className="flex w-full items-end gap-2 sm:w-auto">
          <button type="button" className="btn btn-secondary" onClick={() => setMonth(addMonths(month, -1))}>
            ←
          </button>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Mes</label>
            <input type="month" className="input min-w-0" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setMonth(addMonths(month, 1))}>
            →
          </button>
        </div>
      </header>

      {err && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">{err}</div>
      )}

      <section className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label="Despachos del mes" value={loading ? "…" : dispatches} />
        <KpiCard label="Volumen del mes" value={loading ? "…" : fmtLiters(total)} />
        <KpiCard label="Promedio por despacho" value={loading ? "…" : fmtLiters(avg)} />
        <KpiCard label="Empresas con cargas" value={loading ? "…" : companies} />
      </section>

      <section className="card">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
          <div>
            <h2 className="text-lg font-semibold">
              {mode === "dispatches" ? "Despachos por día" : "Volumen por día"}
            </h2>
            <p className="text-sm text-slate-500">Tocá una barra para ver el detalle de ese día.</p>
          </div>

          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("dispatches")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                mode === "dispatches" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Despachos
            </button>
            <button
              type="button"
              onClick={() => setMode("volume")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                mode === "volume" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Volumen
            </button>
          </div>
        </div>

        <MonthlyBars rows={daily} mode={mode} selectedDay={selectedDay} onSelect={selectDay} />

        <div className="text-xs text-slate-400 mt-2">
          Eje horizontal: días del mes. {mode === "dispatches" ? "Altura: cantidad de despachos." : "Altura: litros entregados."}
        </div>
      </section>

      {!selectedDay ? (
        <section className="card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Resumen mensual por empresa</h2>
            <p className="text-sm text-slate-500">
              Totales del mes mientras no haya un día seleccionado.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="table min-w-[700px]">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Despachos</th>
                  <th>Volumen</th>
                  <th>Promedio por carga</th>
                  <th>% del volumen mensual</th>
                </tr>
              </thead>
              <tbody>
                {byCompany.map((r) => {
                  const name = r.company_name || r.company_code || "Sin empresa";
                  const avgCompany = r.dispatch_count > 0 ? r.liters / r.dispatch_count : 0;
                  const share = total > 0 ? (r.liters / total) * 100 : 0;

                  return (
                    <tr key={String(r.company_id ?? name)}>
                      <td className="font-medium">{name}</td>
                      <td>{r.dispatch_count}</td>
                      <td>{fmtLiters(r.liters)}</td>
                      <td>{fmtLiters(avgCompany)}</td>
                      <td>{share.toFixed(1)}%</td>
                    </tr>
                  );
                })}

                {!loading && byCompany.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-slate-500 py-5 text-center">Sin datos para este mes.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <h2 className="text-lg font-semibold capitalize">
                Despachos del {formatDayLong(selectedDay)}
              </h2>
              <p className="text-sm text-slate-500">
                {dayDispatches.length} despachos · {fmtLiters(selectedDayTotal)}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSelectedDay(null);
                setDayDispatches([]);
              }}
            >
              Ver resumen mensual
            </button>
          </div>

          {loadingDay ? (
            <div className="text-sm text-slate-500 py-6">Cargando despachos…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table min-w-[850px]">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Empresa</th>
                    <th>Estación</th>
                    <th>Litros</th>
                    <th>Patente</th>
                    <th>Despacho</th>
                  </tr>
                </thead>
                <tbody>
                  {dayDispatches.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => router.push((`/admin/dispatches/${r.id}`) as Route)}
                    >
                      <td className="font-medium">{r.local_time || "—"}</td>
                      <td>{r.company_name || r.company_code || "—"}</td>
                      <td>{r.station_name || r.station_id}</td>
                      <td>{fmtLiters(r.liters)}</td>
                      <td>{r.plate || "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="text-sky-700 font-medium hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push((`/admin/dispatches/${r.id}`) as Route);
                          }}
                        >
                          #{r.id}
                        </button>
                      </td>
                    </tr>
                  ))}

                  {dayDispatches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-slate-500 py-5 text-center">
                        No hay despachos registrados ese día.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
