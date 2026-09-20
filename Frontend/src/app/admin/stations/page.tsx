"use client";

import React, { useEffect, useState } from "react";
import DataTable, { type Column } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
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
  device_ip: string;
  device_model: string;
  device_serial: string;
};

const emptyForm: StationForm = {
  id: "",
  name: "",
  active: true,
  device_ip: "",
  device_model: "",
  device_serial: "",
};

export default function StationsPage() {
  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [form, setForm] = useState<StationForm>(emptyForm);

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

  useEffect(() => {
    load();
  }, []);

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
      device_ip: station.device_ip || "",
      device_model: station.device_model || "",
      device_serial: station.device_serial || "",
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
      const payload = {
        id: form.id.trim(),
        name: form.name.trim() || null,
        active: form.active,
        device_ip: form.device_ip.trim() || null,
        device_model: form.device_model.trim() || null,
        device_serial: form.device_serial.trim() || null,
      };

      if (editing) {
        await apiJSON<Station>("/stations/" + encodeURIComponent(editing.id), {
          method: "PATCH",
          body: JSON.stringify({
            name: payload.name,
            active: payload.active,
            device_ip: form.device_ip.trim(),
            device_model: form.device_model.trim(),
            device_serial: form.device_serial.trim(),
          }),
        });
      } else {
        await apiJSON<Station>("/stations", {
          method: "POST",
          body: JSON.stringify(payload),
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
      "¿Eliminar la estación \"" + (station.name || station.id) +
      "\"?\n\nSi tiene despachos o historial asociado, el sistema no permitirá eliminarla y deberás desactivarla."
    );
    if (!ok) return;

    setError(null);
    try {
      await apiJSON("/stations/" + encodeURIComponent(station.id), {
        method: "DELETE",
      });
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
    { key: "device_ip", header: "IP", render: (r) => r.device_ip || "—" },
    { key: "device_model", header: "Equipo", render: (r) => r.device_model || "—" },
    { key: "device_serial", header: "Serie", render: (r) => r.device_serial || "—" },
    {
      key: "actions",
      header: "Acciones",
      render: (r) => (
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-secondary" onClick={() => openEdit(r)}>
            Editar
          </button>
          <button className="btn btn-secondary" onClick={() => toggle(r)}>
            {r.active ? "Desactivar" : "Activar"}
          </button>
          <button
            className="btn"
            onClick={() => remove(r)}
            style={{ borderColor: "#fecaca", color: "#b91c1c" }}
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Estaciones</h1>
          <p className="text-sm text-slate-500 mt-1">
            Administrá cargaderos, estado y datos del equipo.
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
          />
        )}
      </section>

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">
                  {editing ? "Editar estación" : "Nueva estación"}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Configuración administrativa y datos del dispositivo.
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

            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">ID</label>
                <input
                  className="input"
                  value={form.id}
                  disabled={!!editing}
                  onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                  placeholder="Ej. PALACIO"
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

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">IP del equipo</label>
                <input
                  className="input"
                  value={form.device_ip}
                  onChange={(e) => setForm((p) => ({ ...p, device_ip: e.target.value }))}
                  placeholder="192.168.1.100"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Modelo</label>
                <input
                  className="input"
                  value={form.device_model}
                  onChange={(e) => setForm((p) => ({ ...p, device_model: e.target.value }))}
                  placeholder="Modelo del dispositivo"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Número de serie</label>
                <input
                  className="input"
                  value={form.device_serial}
                  onChange={(e) => setForm((p) => ({ ...p, device_serial: e.target.value }))}
                  placeholder="Serie"
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 min-h-[42px]">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
                  />
                  <span className="text-sm">Estación activa</span>
                </label>
              </div>
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
