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
  avg_liters_per_dispatch: number;
  max_dispatch_liters: number;
  ai_plate_count: number;
  ai_company_match_count: number;
  ai_company_mismatch_count: number;
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

type DailyItem = {
  day: string;
  liters: number;
  dispatch_count: number;
};

type HourItem = {
  hour: number;
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
  const next = new Date(Date.UTC(y, m ?? 1, 1, 0, 0, 0));
  return { from: start.toISOString(), to: next.toISOString() };
}

function monthLabel(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(
    new Date(y, (m ?? 1) - 1, 1)
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="card">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint ? <div className="text-xs text-slate-400 mt-1">{hint}</div> : null}
    </div>
  );
}

function BarChart({
  rows,
  valueKey,
  labelKey,
  formatValue,
}: {
  rows: any[];
  valueKey: string;
  labelKey: string;
  formatValue: (value: number) => string;
}) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey] || 0)), 1);

  if (!rows.length) {
    return <div className="text-sm text-slate-500 py-8 text-center">Sin datos para el período.</div>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const value = Number(row[valueKey] || 0);
        const width = Math.max((value / max) * 100, value > 0 ? 2 : 0);

        return (
          <div key={`${row[labelKey]}_${index}`}>
            <div className="flex items-center justify-between gap-4 text-sm mb-1">
              <span className="font-medium truncate">{row[labelKey]}</span>
              <span className="text-slate-500 shrink-0">{formatValue(value)}</span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-sky-500"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyChart({ rows }: { rows: DailyItem[] }) {
  const data = rows.filter((r) => r.liters > 0 || r.dispatch_count > 0);
  const maxLiters = Math.max(...data.map((r) => r.liters), 1);
  const width = 900;
  const height = 260;
  const padX = 42;
  const padTop = 20;
  const padBottom = 38;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  if (!data.length) {
    return <div className="text-sm text-slate-500 py-12 text-center">Sin movimientos para graficar.</div>;
  }

  const points = data.map((r, i) => {
    const x = padX + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = padTop + innerH - (r.liters / maxLiters) * innerH;
    return { ...r, x, y };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[700px] h-[260px]">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padTop + innerH - ratio * innerH;
          return (
            <g key={ratio}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={6} y={y + 4} fontSize="11" fill="#64748b">
                {Math.round(maxLiters * ratio).toLocaleString("es-AR")}
              </text>
            </g>
          );
        })}

        <polyline
          points={polyline}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => (
          <g key={p.day}>
            <circle cx={p.x} cy={p.y} r="4" fill="#0284c7">
              <title>{`${p.day}: ${fmtLiters(p.liters)} · ${p.dispatch_count} despachos`}</title>
            </circle>
            {(i === 0 || i === points.length - 1 || data.length <= 10 || i % Math.ceil(data.length / 8) === 0) && (
              <text x={p.x} y={height - 12} textAnchor="middle" fontSize="11" fill="#64748b">
                {new Date(`${p.day}T00:00:00`).toLocaleDateString("es-AR", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function HourChart({ rows }: { rows: HourItem[] }) {
  const max = Math.max(...rows.map((r) => r.dispatch_count), 1);

  return (
    <div className="flex items-end gap-1 h-44 pt-4">
      {rows.map((row) => {
        const h = (row.dispatch_count / max) * 100;
        return (
          <div key={row.hour} className="flex-1 min-w-[12px] flex flex-col items-center justify-end h-full group">
            <div className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 mb-1 whitespace-nowrap">
              {row.dispatch_count}
            </div>
            <div
              className="w-full bg-sky-500 rounded-t-sm min-h-[2px]"
              style={{ height: `${Math.max(h, row.dispatch_count > 0 ? 4 : 1)}%` }}
              title={`${String(row.hour).padStart(2, "0")}:00 · ${row.dispatch_count} despachos · ${fmtLiters(row.liters)}`}
            />
            {row.hour % 3 === 0 && (
              <div className="text-[10px] text-slate-500 mt-1">{String(row.hour).padStart(2, "0")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ReportsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byCompany, setByCompany] = useState<ByCompanyItem[]>([]);
  const [byStation, setByStation] = useState<ByStationItem[]>([]);
  const [daily, setDaily] = useState<DailyItem[]>([]);
  const [byHour, setByHour] = useState<HourItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const range = useMemo(() => monthToRange(month), [month]);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const qs = new URLSearchParams();
      qs.set("from", range.from);
      qs.set("to", range.to);
      const q = qs.toString();

      const [s, c, st, d, h] = await Promise.all([
        apiJSON<Summary>(`/kpi/summary?${q}`),
        apiJSON<{ ok: boolean; items: ByCompanyItem[] }>(`/kpi/by_company?${q}&top=20`),
        apiJSON<{ ok: boolean; items: ByStationItem[] }>(`/kpi/by_station?${q}&top=20`),
        apiJSON<{ ok: boolean; items: DailyItem[] }>(`/kpi/daily?${q}`),
        apiJSON<{ ok: boolean; items: HourItem[] }>(`/kpi/by_hour?${q}`),
      ]);

      setSummary(s);
      setByCompany(c.items || []);
      setByStation(st.items || []);
      setDaily(d.items || []);
      setByHour(h.items || []);
    } catch (e: any) {
      setErr(e?.message ?? "Error cargando KPIs");
      setSummary(null);
      setByCompany([]);
      setByStation([]);
      setDaily([]);
      setByHour([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [month]);

  const total = summary?.total_liters ?? 0;
  const dispatches = summary?.dispatch_count ?? 0;
  const avg = summary?.avg_liters_per_dispatch ?? 0;
  const activeCompanies = summary?.companies_count ?? 0;
  const plateRate = dispatches > 0 ? ((summary?.ai_plate_count ?? 0) / dispatches) * 100 : 0;
  const aiChecked = (summary?.ai_company_match_count ?? 0) + (summary?.ai_company_mismatch_count ?? 0);

  const topCompany = byCompany[0];
  const busiestHour = byHour.reduce<HourItem | null>(
    (best, row) => (!best || row.dispatch_count > best.dispatch_count ? row : best),
    null
  );

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">KPI del cargadero</h1>
          <p className="text-sm text-slate-500 mt-1 capitalize">
            Uso operativo · {monthLabel(month)}
          </p>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Mes</label>
            <input
              type="month"
              className="input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? "Cargando…" : "Actualizar"}
          </button>
        </div>
      </header>

      {err && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">
          {err}
        </div>
      )}

      <section className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label="Agua entregada" value={loading ? "…" : fmtLiters(total)} hint="Total del período" />
        <KpiCard label="Despachos" value={loading ? "…" : dispatches.toLocaleString("es-AR")} hint="Cantidad de cargas" />
        <KpiCard label="Promedio por despacho" value={loading ? "…" : fmtLiters(avg)} hint="Litros por carga" />
        <KpiCard label="Empresas activas" value={loading ? "…" : activeCompanies} hint="Con al menos un despacho" />
      </section>

      <section className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Evolución diaria</h2>
            <p className="text-sm text-slate-500">Litros entregados por día durante el mes seleccionado.</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Máxima carga individual</div>
            <div className="font-semibold">{fmtLiters(summary?.max_dispatch_liters ?? 0)}</div>
          </div>
        </div>
        <DailyChart rows={daily} />
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <div className="card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Consumo por empresa</h2>
            <p className="text-sm text-slate-500">Quiénes retiraron más agua en el período.</p>
          </div>
          <BarChart
            rows={byCompany.slice(0, 8).map((r) => ({
              ...r,
              label: r.company_name || r.company_code || "Sin empresa",
            }))}
            valueKey="liters"
            labelKey="label"
            formatValue={fmtLiters}
          />
        </div>

        <div className="card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Uso por estación</h2>
            <p className="text-sm text-slate-500">Volumen entregado por punto de carga.</p>
          </div>
          <BarChart
            rows={byStation.map((r) => ({
              ...r,
              label: r.station_name || r.station_id,
            }))}
            valueKey="liters"
            labelKey="label"
            formatValue={fmtLiters}
          />
        </div>
      </section>

      <section className="grid xl:grid-cols-3 gap-4">
        <div className="card xl:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Actividad por hora</h2>
              <p className="text-sm text-slate-500">Cantidad de despachos según horario del día.</p>
            </div>
            {busiestHour && busiestHour.dispatch_count > 0 && (
              <div className="text-right">
                <div className="text-xs text-slate-500">Hora de mayor uso</div>
                <div className="font-semibold">
                  {String(busiestHour.hour).padStart(2, "0")}:00 · {busiestHour.dispatch_count} cargas
                </div>
              </div>
            )}
          </div>
          <HourChart rows={byHour} />
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold">Control con IA</h2>
          <p className="text-sm text-slate-500 mt-1 mb-5">Cobertura del reconocimiento visual.</p>

          <div className="space-y-5">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Patentes detectadas</span>
                <span className="font-medium">{summary?.ai_plate_count ?? 0} / {dispatches}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-sky-500" style={{ width: `${Math.min(plateRate, 100)}%` }} />
              </div>
              <div className="text-xs text-slate-400 mt-1">{plateRate.toFixed(0)}% de los despachos</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs text-emerald-700">Empresa coincide</div>
                <div className="text-2xl font-semibold text-emerald-800">
                  {summary?.ai_company_match_count ?? 0}
                </div>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <div className="text-xs text-red-700">No coincide</div>
                <div className="text-2xl font-semibold text-red-800">
                  {summary?.ai_company_mismatch_count ?? 0}
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-500">
              Comparaciones IA realizadas: {aiChecked}
            </div>
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500">Empresa con mayor retiro</div>
          <div className="text-xl font-semibold mt-1">
            {topCompany?.company_name || topCompany?.company_code || "—"}
          </div>
          <div className="text-sm text-slate-500 mt-1">
            {topCompany ? `${fmtLiters(topCompany.liters)} en ${topCompany.dispatch_count} despachos` : "Sin datos"}
          </div>
        </div>

        <div className="card">
          <div className="text-sm text-slate-500">Estaciones utilizadas</div>
          <div className="text-xl font-semibold mt-1">{summary?.stations_count ?? 0}</div>
          <div className="text-sm text-slate-500 mt-1">Puntos con actividad en el período</div>
        </div>
      </section>
    </div>
  );
}
