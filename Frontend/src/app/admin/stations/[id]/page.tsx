"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Route } from "next";
import Tabs from "../../../../components/Tabs";
import Badge from "../../../../components/Badge";
import { apiJSON } from "../../../../lib/api/api";
import { useAuth } from "../../../../components/AuthContext";

type Station = {
  id: string;
  name?: string | null;
  active: boolean;
  organization_id?: number | null;
};

type Organization = {
  id: number;
  name: string;
  active: boolean;
  station_count: number;
};

type HealthItem = {
  device_id: string;
  device_type: string;
  name: string;
  ip?: string | null;
  status: string;
  latency_ms?: number | null;
  last_error?: string | null;
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

export default function StationDetailPage() {
  const { user, canAdmin } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const stationId = decodeURIComponent(params.id || "");

  const [station, setStation] = useState<Station | null>(null);
  const [healthItems, setHealthItems] = useState<HealthItem[]>([]);
  const [weekly, setWeekly] = useState<WeeklyDay[]>([]);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editOrganizationId, setEditOrganizationId] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  async function loadStation() {
    const data = await apiJSON<Station>("/stations/" + encodeURIComponent(stationId));
    setStation(data);
    setEditName(data.name || "");
    setEditActive(data.active);
    setEditOrganizationId(data.organization_id ? String(data.organization_id) : "");
  }

  async function loadHealth() {
    setHealthLoading(true);
    try {
      const [health, history, changes] = await Promise.all([
        apiJSON<{ ok: boolean; items: HealthItem[] }>(
          "/system-health?station_id=" + encodeURIComponent(stationId)
        ),
        apiJSON<{ ok: boolean; days: WeeklyDay[] }>(
          "/system-health/weekly?station_id=" + encodeURIComponent(stationId)
        ),
        apiJSON<{ ok: boolean; items: HealthEvent[] }>(
          "/system-health/events?station_id=" +
            encodeURIComponent(stationId) +
            "&days=7&limit=100"
        ),
      ]);

      setHealthItems(Array.isArray(health?.items) ? health.items : []);
      setWeekly(Array.isArray(history?.days) ? history.days : []);
      setEvents(Array.isArray(changes?.items) ? changes.items : []);
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadOrganizations() {
    if (user?.role !== "owner") return;
    const data = await apiJSON<{ ok: boolean; items: Organization[] }>("/organizations");
    setOrganizations(Array.isArray(data?.items) ? data.items : []);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadStation(), loadHealth(), loadOrganizations()]);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar la estación");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!stationId) return;
    loadAll();
    const timer = window.setInterval(loadHealth, 30000);
    return () => window.clearInterval(timer);
  }, [stationId]);

  async function saveEdit() {
    if (!station) return;
    setSaving(true);
    setError(null);
    try {
      await apiJSON("/stations/" + encodeURIComponent(station.id), {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim() || null,
          active: editActive,
          ...(user?.role === "owner" && editOrganizationId
            ? { organization_id: Number(editOrganizationId) }
            : {}),
        }),
      });
      setEditOpen(false);
      await loadStation();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo editar la estación");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!station) return;
    setError(null);
    try {
      await apiJSON("/stations/" + encodeURIComponent(station.id) + "/active", {
        method: "PATCH",
        body: JSON.stringify({ active: !station.active }),
      });
      await loadStation();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la estación");
    }
  }

  async function removeStation() {
    if (!station) return;
    const ok = window.confirm(
      `¿Eliminar la estación "${station.name || station.id}"?\n\nSi tiene historial asociado, el sistema bloqueará el borrado.`
    );
    if (!ok) return;

    setError(null);
    try {
      await apiJSON("/stations/" + encodeURIComponent(station.id), {
        method: "DELETE",
      });
      router.push("/admin/stations" as Route);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar la estación");
    }
  }

  const scopedStationRole = user?.station_roles?.[stationId];
  const scopedOrgRole = station?.organization_id
    ? user?.organization_roles?.[String(station.organization_id)]
    : undefined;

  const canAdminThisStation =
    canAdmin ||
    scopedStationRole === "admin" ||
    scopedOrgRole === "admin" ||
    scopedOrgRole === "owner";

  const maxOffline = Math.max(1, ...weekly.map((d) => d.offline_minutes));
  const totalIncidents = weekly.reduce((acc, d) => acc + d.incidents, 0);
  const totalOffline = Math.round(
    weekly.reduce((acc, d) => acc + d.offline_minutes, 0)
  );

  const tabs = useMemo(
    () => [
      {
        key: "resumen",
        label: "Resumen",
        content: (
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card lg:col-span-2">
              <h2 className="text-lg font-semibold mb-4">Datos de la estación</h2>
              <div className="grid gap-4 sm:grid-cols-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">ID</div>
                  <div className="font-medium">{station?.id || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Nombre</div>
                  <div className="font-medium">{station?.name || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Estado</div>
                  {station && (
                    <Badge color={station.active ? "green" : "red"}>
                      {station.active ? "Activa" : "Inactiva"}
                    </Badge>
                  )}
                </div>
              </div>
            </section>

            <section className="card">
              <h2 className="text-lg font-semibold mb-4">Salud actual</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Equipos monitoreados</span>
                  <b>{healthItems.length}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Con problemas</span>
                  <b>{healthItems.filter((x) => x.status !== "online").length}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Incidentes 7 días</span>
                  <b>{totalIncidents}</b>
                </div>
              </div>
            </section>
          </div>
        ),
      },
      {
        key: "estado",
        label: "Estado del sistema",
        badge: (
          <span className="badge bg-slate-100 text-slate-700">
            {healthItems.length}
          </span>
        ),
        content: (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button className="btn btn-secondary" onClick={loadHealth} disabled={healthLoading}>
                {healthLoading ? "Actualizando…" : "Actualizar"}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {healthItems.map((item) => (
                <article key={item.device_id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {item.ip || item.device_type}
                      </div>
                    </div>
                    <Badge color={healthColor(item.status)}>
                      {healthLabel(item.status)}
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
                    <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                      {item.last_error}
                    </div>
                  )}
                </article>
              ))}

              {!healthItems.length && !healthLoading && (
                <div className="card text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                  No hay equipos de monitoreo asociados a esta estación.
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "historial",
        label: "Historial 7 días",
        content: (
          <div className="space-y-4">
            <section className="card">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Comunicación · últimos 7 días</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Minutos acumulados sin comunicación entre los equipos de la estación.
                </p>
              </div>

              {weekly.length ? (
                <>
                  <div className="flex h-56 items-end gap-3 border-b border-slate-200 px-2">
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
                          <div className="text-xs font-medium text-slate-600">
                            {day.offline_minutes > 0
                              ? Math.round(day.offline_minutes) + " min"
                              : "OK"}
                          </div>
                          <div
                            className={
                              "w-full max-w-14 rounded-t-lg " +
                              (day.offline_minutes > 0
                                ? "bg-rose-400"
                                : "bg-emerald-300")
                            }
                            style={{ height: height + "%" }}
                          />
                          <div className="pb-2 text-xs text-slate-500">
                            {day.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Incidentes</div>
                      <div className="text-xl font-semibold">{totalIncidents}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Sin comunicación</div>
                      <div className="text-xl font-semibold">{totalOffline} min</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Disponibilidad hoy</div>
                      <div className="text-xl font-semibold">
                        {weekly[weekly.length - 1]?.availability_pct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-500">
                  Todavía no hay historial suficiente para graficar.
                </div>
              )}
            </section>

            <section className="card">
              <h2 className="text-lg font-semibold mb-3">Cambios de comunicación</h2>
              <div className="space-y-2">
                {events.slice(0, 20).map((ev) => (
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

                {!events.length && (
                  <div className="text-sm text-slate-500">
                    Sin cambios registrados en los últimos 7 días.
                  </div>
                )}
              </div>
            </section>
          </div>
        ),
      },
      {
        key: "acciones",
        label: "Acciones",
        content: (
          <section className="card">
            {canAdminThisStation ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary" onClick={() => setEditOpen(true)}>
                Editar
              </button>
              <button className="btn btn-secondary" onClick={toggleActive}>
                {station?.active ? "Desactivar" : "Activar"}
              </button>
              <button
                className="btn"
                onClick={removeStation}
                style={{ borderColor: "#fecaca", color: "#b91c1c" }}
              >
                Eliminar
              </button>
            </div>
            ) : (
              <div className="text-sm text-slate-500">Tu usuario tiene acceso de solo lectura para esta configuración.</div>
            )}
          </section>
        ),
      },
    ],
    [station, healthItems, weekly, events, healthLoading, maxOffline, totalIncidents, totalOffline, canAdminThisStation]
  );

  if (loading) {
    return <div className="text-sm text-slate-500">Cargando estación…</div>;
  }

  if (!station) {
    return <div className="text-sm text-slate-500">Estación no encontrada.</div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            className="text-sm text-slate-500 hover:text-slate-800 mb-2"
            onClick={() => router.push("/admin/stations" as Route)}
          >
            ← Volver a estaciones
          </button>
          <h1 className="text-2xl font-bold">{station.name || station.id}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Estación {station.id} · monitoreo y configuración
          </p>
        </div>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        <Tabs tabs={tabs} defaultTab="resumen" />
      </section>

      {editOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">Editar estación</h2>
                <p className="text-sm text-slate-500 mt-1">Datos básicos del cargadero.</p>
              </div>
              <button className="btn btn-secondary" onClick={() => setEditOpen(false)} disabled={saving}>
                Cerrar
              </button>
            </div>

            <div className="grid gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Nombre</label>
                <input
                  className="input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              {user?.role === "owner" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Organización administradora</label>
                  <select
                    className="select"
                    value={editOrganizationId}
                    onChange={(e) => setEditOrganizationId(e.target.value)}
                  >
                    <option value="">Sin organización</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                />
                <span className="text-sm">Estación activa</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn" onClick={saveEdit} disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
