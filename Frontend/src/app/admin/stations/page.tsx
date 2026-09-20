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

const emptyForm: StationForm = {
  id: "",
  name: "",
  active: true,
};

export default function StationsPage() {
  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [form, setForm] = useState<StationForm>(emptyForm);

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
      "¿Eliminar la estación \"" + (station.name || station.id) +
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

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Estaciones</h1>
          <p className="text-sm text-slate-500 mt-1">
            Administrá cargaderos y su estado.
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
          Click en una fila para editar, activar/desactivar o eliminar.
        </div>
      </section>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? "Estación · " + (selected.name || selected.id) : ""}
      >
        {selected && (
          <div className="space-y-4">
            <div className="card">
              <h3 className="font-semibold mb-2">Datos</h3>
              <div className="text-sm space-y-1">
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
