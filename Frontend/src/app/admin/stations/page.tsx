"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import DataTable, { type Column } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import { apiJSON } from "../../../lib/api/api";
import { useAuth } from "../../../components/AuthContext";

export type Station = {
  id: string;
  name?: string | null;
  active: boolean;
  device_ip?: string | null;
  device_model?: string | null;
  device_serial?: string | null;
  connections_status?: "ok" | "alert" | "no_data";
  connections_total?: number;
  connections_online?: number;
  connections_problems?: number;
};

type StationForm = {
  id: string;
  name: string;
  active: boolean;
};

const emptyForm: StationForm = {
  id: "",
  name: "",
  active: true,
};

export default function StationsPage() {
  const { canAdmin } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<StationForm>(emptyForm);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [data, summary] = await Promise.all([
        apiJSON<Station[]>("/stations"),
        apiJSON<{
          ok: boolean;
          items: Array<{
            station_id: string;
            status: "ok" | "alert" | "no_data";
            total: number;
            online: number;
            problems: number;
          }>;
        }>("/system-health/stations-summary"),
      ]);

      const stations = Array.isArray(data) ? data : [];
      const summaries = Array.isArray(summary?.items) ? summary.items : [];
      const byStation = new Map(summaries.map((s) => [String(s.station_id), s]));

      setRows(
        stations.map((station) => {
          const health = byStation.get(String(station.id));
          return {
            ...station,
            connections_status: health?.status ?? "no_data",
            connections_total: health?.total ?? 0,
            connections_online: health?.online ?? 0,
            connections_problems: health?.problems ?? 0,
          };
        })
      );
    } catch (e: any) {
      setError(e?.message ?? "Error al cargar estaciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(emptyForm);
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

      setFormOpen(false);
      setForm(emptyForm);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar la estación");
    } finally {
      setSaving(false);
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
    {
      key: "connections",
      header: "Conexiones",
      render: (r) => {
        if (r.connections_status === "ok") {
          return (
            <div className="flex items-center gap-2">
              <Badge color="green">Todo OK</Badge>
              <span className="text-xs text-slate-500">
                {r.connections_online}/{r.connections_total} OK
              </span>
            </div>
          );
        }

        if (r.connections_status === "alert") {
          return (
            <div className="flex items-center gap-2">
              <Badge color="yellow">Alerta</Badge>
              <span className="text-xs text-slate-500">
                {r.connections_online}/{r.connections_total} OK
              </span>
            </div>
          );
        }

        return <Badge color="slate">Sin datos</Badge>;
      },
    },
  ];

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
          {canAdmin && (
            <button className="btn" onClick={openCreate}>
              + Nueva estación
            </button>
          )}
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
            onRowClick={(row) =>
              router.push(("/admin/stations/" + encodeURIComponent(row.id)) as Route)
            }
          />
        )}
        <div className="mt-2 text-xs text-slate-500">
          Click en una estación para abrir su detalle, salud e historial.
        </div>
      </section>

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">Nueva estación</h2>
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
                {saving ? "Guardando…" : "Crear estación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
