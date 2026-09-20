"use client";

import React, { useEffect, useMemo, useState } from "react";
import DataTable, { type Column } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import Drawer from "../../../components/Drawer";
import { apiJSON } from "../../../lib/api/api";

export type Station = {
  id: string;
  name?: string | null;
  active: boolean;
  device_ip?: string | null;
  device_model?: string | null;
  device_serial?: string | null;
};

type StationForm = {
  id: string;
  name: string;
  active: boolean;
};

type HealthItem = {
  device_id: string;
  device_type: string;
  name: string;
  ip?: string | null;
  station_id?: string | null;
  status: string;
  latency_ms?: number | null;
  last_error?: string | null;
  last_seen?: string | null;
  age_seconds?: number | null;
};

type WeeklyDay = {
  date: string;
  label: string;
  availability_pct: number;
  offline_minutes: number;
  incidents: number;
  affected_devices: number;
};

type HealthEvent = {
  id: number;
  name: string;
  status: string;
  previous_status?: string | null;
  error?: string | null;
  created_at?: string | null;
};

const emptyForm: StationForm = {
  id: "",
  name: "",
  active: true,
};

function healthColor(status: string): "green" | "yellow" | "red" | "slate" {
  if (status === "online") return "green";
  if (status === "auth_error" || status === "degraded") return "yellow";
  if (status === "offline") return "red";
  return "slate";
}

function healthLabel(status: string) {
  if (status === "online") return "Online";
  if (status === "auth_error") return "Credenciales";
  if (status === "degraded") return "Degradado";
  if (status === "offline") return "Sin comunicación";
  return status || "Desconocido";
}

function ago(seconds?: number | null) {
  if (seconds == null) return "—";
  if (seconds < 10) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

export default function StationsPage() {
  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [form, setForm] = useState<StationForm>(emptyForm);

  const [healthItems, setHealthItems] = useState<HealthItem[]>([]);
  const [weekly, setWeekly] = useState<WeeklyDay[]>([]);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId]
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJSON<Station[]>("/stations");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Error al cargar estaciones");
    } finally {
      setLoading(false);
    }
  }

  async function loadStationHealth(stationId: string) {
    setHealthLoading(true);
    try {
      const [health, history, events] = await Promise.all([
        apiJSON<{ ok: boolean; items: HealthItem[] }>(
          "/system-health?station_id=" + encodeURIComponent(stationId)
        ),
        apiJSON<{ ok: boolean; days: WeeklyDay[] }>(
          "/system-health/weekly?station_id=" + encodeURIComponent(stationId)
        ),
        apiJSON<{ ok: boolean; items: HealthEvent[] }>(
          "/system-health/events?station_id=" +
            encodeURIComponent(stationId) +
            "&days=7&limit=50"
        ),
      ]);

      setHealthItems(Array.isArray(health?.items) ? health.items : []);
      setWeekly(Array.isArray(history?.days) ? history.days : []);
      setHealthEvents(Array.isArray(events?.items) ? events.items : []);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar el estado de la estación");
    } finally {
      setHealthLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setHealthItems([]);
      setWeekly([]);
      setHealthEvents([]);
      return;
    }

    loadStationHealth(selectedId);
    const timer = window.setInterval(() => loadStationHealth(selectedId), 30000);
    return () => window.clearInterval(timer);
  }, [selectedId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(station: Station) {
    setEditing(station);
    setForm({
      id: station.id,
      name: station.name || "",
      active: station.active,
    });
    setFormOpen(true);
  }

  async function save() {
    if (!form.id.trim()) {
      setError("El ID de la estación es obligatorio.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editing) {
        await apiJSON<Station>("/stations/" + encodeURIComponent(editing.id), {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim() || null,
            active: form.active,
          }),
        });
      } else {
        await apiJSON<Station>("/stations", {
          method: "POST",
          body: JSON.stringify({
            id: form.id.trim(),
            name: form.name.trim() || null,
            active: form.active,
            device_ip: null,
            device_model: null,
            device_serial: null,
          }),
        });
      }

      setFormOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar la estación");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(station: Station) {
    setError(null);
    try {
      await apiJSON("/stations/" + encodeURIComponent(station.id) + "/active", {
        method: "PATCH",
        body: JSON.stringify({ active: !station.active }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la estación");
    }
  }

  async function remove(station: Station) {
    const ok = window.confirm(
      "¿Eliminar la estación \"" +
        (station.name || station.id) +
        "\"?\n\nSi tiene despachos o historial asociado, el sistema no permitirá eliminarla y deberás desactivarla."
    );
    if (!ok) return;

    setError(null);
    try {
      await apiJSON("/stations/" + encodeURIComponent(station.id), {
        method: "DELETE",
      });
      setSelectedId(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar la estación");
    }
  }

  const columns: Column<Station>[] = [
    { key: "id", header: "ID" },
    { key: "name", header: "Nombre", render: (r) => r.name || "—" },
    {
      key: "active",
      header: "Estado",
      render: (r) => (
        <Badge color={r.active ? "green" : "red"}>
          {r.active ? "Activa" : "Inactiva"}
        </Badge>
      ),
    },
  ];

  const maxOffline = Math.max(1, ...weekly.map((d) => d.offline_minutes));

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Estaciones</h1>
          <p className="text-sm text-slate-500 mt-1">
            Administrá cargaderos, equipos y estado de comunicación.
          </p>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            Recargar
          </button>
          <button className="btn" onClick={openCreate}>
            + Nueva estación
          </button>
        </div>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-300 text-red-700 bg-red-50 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        {loading ? (
          <div className="text-sm text-slate-500">Cargando…</div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            initialSortKey="name"
            initialSortDir="asc"
            onRowClick={(row) => setSelectedId(row.id)}
            rowClassName={(row) => (selectedId === row.id ? "bg-sky-50" : "")}
          />
        )}
        <div className="mt-2 text-xs text-slate-500">
          Click en una estación para ver equipos, salud e historial.
        </div>
      </section>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? "Estación · " + (selected.name || selected.id) : ""}
        width={760}
      >
        {selected && (
          <div className="space-y-4">
            <div className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Datos de la estación</h3>
                  <div className="mt-2 text-sm space-y-1">
                    <div><b>ID:</b> {selected.id}</div>
                    <div><b>Nombre:</b> {selected.name || "—"}</div>
                    <div>
                      <b>Estado:</b>{" "}
                      <Badge color={selected.active ? "green" : "red"}>
                        {selected.active ? "Activa" : "Inactiva"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <button
                  className="btn btn-secondary"
                  onClick={() => loadStationHealth(selected.id)}
                  disabled={healthLoading}
                >
                  {healthLoading ? "Actualizando…" : "Actualizar"}
                </button>
              </div>
            </div>

            <div className="card">
              <h3 className="font-semibold mb-3">Estado de los equipos</h3>

              {healthItems.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {healthItems.map((item) => (
                    <div
                      key={item.device_id}
                      className="rounded-xl border border-slate-200 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {item.ip || item.device_type}
                          </div>
                        </div>
                        <Badge color={healthColor(item.status)}>
                          {healthLabel(item.status)}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-slate-500">Última comunicación</div>
                          <div className="font-medium">{ago(item.age_seconds)}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Latencia</div>
                          <div className="font-medium">
                            {item.latency_ms != null ? item.latency_ms + " ms" : "—"}
                          </div>
                        </div>
                      </div>

                      {item.last_error && (
                        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                          {item.last_error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  {healthLoading
                    ? "Cargando equipos…"
                    : "No hay equipos de monitoreo asociados a esta estación."}
                </div>
              )}
            </div>

            <div className="card">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold">Comunicación · últimos 7 días</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Minutos acumulados sin comunicación entre los equipos de esta estación.
                  </p>
                </div>
              </div>

              {weekly.length > 0 ? (
                <>
                  <div className="flex h-44 items-end gap-2 border-b border-slate-200 px-1">
                    {weekly.map((day) => {
                      const height =
                        day.offline_minutes <= 0
                          ? 3
                          : Math.max(10, (day.offline_minutes / maxOffline) * 100);

                      return (
                        <div
                          key={day.date}
                          className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                          title={
                            day.offline_minutes +
                            " min sin comunicación · " +
                            day.incidents +
                            " incidente(s)"
                          }
                        >
                          <div className="text-[10px] font-medium text-slate-600">
                            {day.offline_minutes > 0
                              ? Math.round(day.offline_minutes) + "m"
                              : "OK"}
                          </div>
                          <div
                            className={
                              "w-full max-w-10 rounded-t-md " +
                              (day.offline_minutes > 0
                                ? "bg-rose-400"
                                : "bg-emerald-300")
                            }
                            style={{ height: height + "%" }}
                          />
                          <div className="pb-1 text-[10px] text-slate-500">
                            {day.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-2 text-xs">
                      <div className="text-slate-500">Incidentes 7 días</div>
                      <div className="font-semibold">
                        {weekly.reduce((acc, d) => acc + d.incidents, 0)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2 text-xs">
                      <div className="text-slate-500">Tiempo sin comunicación</div>
                      <div className="font-semibold">
                        {Math.round(
                          weekly.reduce((acc, d) => acc + d.offline_minutes, 0)
                        )}{" "}
                        min
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2 text-xs">
                      <div className="text-slate-500">Disponibilidad hoy</div>
                      <div className="font-semibold">
                        {weekly.length
                          ? weekly[weekly.length - 1].availability_pct.toFixed(2) + "%"
                          : "—"}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-500">
                  Todavía no hay historial suficiente para graficar.
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold mb-3">Últimos cambios de comunicación</h3>

              {healthEvents.length ? (
                <div className="space-y-2">
                  {healthEvents.slice(0, 12).map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 text-sm last:border-0"
                    >
                      <div>
                        <div className="font-medium">{ev.name}</div>
                        <div className="text-xs text-slate-500">
                          {ev.created_at
                            ? new Date(ev.created_at).toLocaleString("es-AR")
                            : "—"}
                        </div>
                        {ev.error && (
                          <div className="mt-1 text-xs text-slate-500">{ev.error}</div>
                        )}
                      </div>
                      <Badge color={healthColor(ev.status)}>
                        {healthLabel(ev.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  Sin cambios registrados en los últimos 7 días.
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold mb-3">Acciones</h3>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary" onClick={() => openEdit(selected)}>
                  Editar
                </button>
                <button className="btn btn-secondary" onClick={() => toggle(selected)}>
                  {selected.active ? "Desactivar" : "Activar"}
                </button>
                <button
                  className="btn"
                  onClick={() => remove(selected)}
                  style={{ borderColor: "#fecaca", color: "#b91c1c" }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">
                  {editing ? "Editar estación" : "Nueva estación"}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Datos básicos del cargadero.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cerrar
              </button>
            </div>

            <div className="grid gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">ID</label>
                <input
                  className="input"
                  value={form.id}
                  disabled={!!editing}
                  onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                  placeholder="Ej. 3"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Nombre</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Nombre visible"
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
                />
                <span className="text-sm">Estación activa</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button className="btn" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear estación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
