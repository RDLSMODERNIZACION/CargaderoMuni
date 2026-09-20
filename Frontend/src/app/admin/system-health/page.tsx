"use client";

import React, { useEffect, useMemo, useState } from "react";
import Badge from "../../../components/Badge";
import { apiJSON } from "../../../lib/api/api";

type HealthItem = {
  device_id: string;
  device_type: string;
  name: string;
  ip?: string | null;
  status: string;
  reported_status?: string | null;
  latency_ms?: number | null;
  last_error?: string | null;
  last_seen?: string | null;
  age_seconds?: number | null;
};

type HealthEvent = {
  id: number;
  device_id: string;
  name: string;
  previous_status?: string | null;
  status: string;
  error?: string | null;
  created_at?: string | null;
};

function statusLabel(status: string) {
  if (status === "online") return "Online";
  if (status === "auth_error") return "Credenciales";
  if (status === "degraded") return "Degradado";
  if (status === "offline") return "Sin comunicación";
  return status || "Desconocido";
}

function statusColor(status: string): "green" | "yellow" | "red" | "gray" {
  if (status === "online") return "green";
  if (status === "auth_error" || status === "degraded") return "yellow";
  if (status === "offline") return "red";
  return "gray";
}

function ago(seconds?: number | null) {
  if (seconds == null) return "—";
  if (seconds < 10) return "ahora";
  if (seconds < 60) return "hace " + seconds + " s";
  const min = Math.floor(seconds / 60);
  if (min < 60) return "hace " + min + " min";
  return "hace " + Math.floor(min / 60) + " h";
}

export default function SystemHealthPage() {
  const [items, setItems] = useState<HealthItem[]>([]);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [health, history] = await Promise.all([
        apiJSON<{ ok: boolean; items: HealthItem[] }>("/system-health"),
        apiJSON<{ ok: boolean; items: HealthEvent[] }>("/system-health/events?limit=30"),
      ]);
      setItems(Array.isArray(health?.items) ? health.items : []);
      setEvents(Array.isArray(history?.items) ? history.items : []);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar el estado del sistema");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, []);

  const problems = useMemo(
    () => items.filter((x) => x.status !== "online"),
    [items]
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Estado del sistema</h1>
          <p className="text-sm text-slate-500 mt-1">
            Comunicación de cámaras, teclado, PLC, Node-RED y backend.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load}>
          Actualizar
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && problems.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Hay {problems.length} equipo{problems.length === 1 ? "" : "s"} con problemas de comunicación.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <article key={item.device_id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{item.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {item.ip || item.device_type}
                </div>
              </div>
              <Badge color={statusColor(item.status)}>
                {statusLabel(item.status)}
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Última comunicación</div>
                <div className="font-medium">{ago(item.age_seconds)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Latencia</div>
                <div className="font-medium">
                  {item.latency_ms != null ? item.latency_ms + " ms" : "—"}
                </div>
              </div>
            </div>

            {item.last_error && (
              <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600 break-words">
                {item.last_error}
              </div>
            )}
          </article>
        ))}

        {!loading && items.length === 0 && (
          <div className="card text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
            Todavía no llegaron heartbeats desde Node-RED.
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Historial de cambios</h2>
        <div className="overflow-x-auto">
          <table className="table min-w-[680px]">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Equipo</th>
                <th>Anterior</th>
                <th>Estado</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td>{ev.created_at ? new Date(ev.created_at).toLocaleString("es-AR") : "—"}</td>
                  <td>{ev.name}</td>
                  <td>{ev.previous_status ? statusLabel(ev.previous_status) : "—"}</td>
                  <td>{statusLabel(ev.status)}</td>
                  <td>{ev.error || "—"}</td>
                </tr>
              ))}
              {!events.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-500">
                    Sin cambios registrados todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
