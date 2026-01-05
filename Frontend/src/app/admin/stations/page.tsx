"use client";

import React, { useEffect, useState } from "react";
import DataTable, { type Column } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import { fmtDate } from "../../../lib/utils";
import { apiJSON } from "../../../lib/api/api";

// Tipo alineado al backend
export type Station = {
  id: string;
  name?: string | null;
  active: boolean;
  created_at?: string | null;
};

export default function StationsPage() {
  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJSON<Station[]>("/stations");
      setRows(data);
    } catch (e: any) {
      setError(e?.message ?? "Error al cargar estaciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const toggle = async (id: string) => {
    const s = rows.find(r => r.id === id);
    if (!s) return;

    // Optimistic UI
    setRows(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r));
    try {
      await apiJSON(`/stations/${encodeURIComponent(id)}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active: !s.active }),
      });
    } catch (e: any) {
      // rollback si falla
      setRows(prev => prev.map(r => r.id === id ? { ...r, active: s.active } : r));
      setError(e?.message ?? "No se pudo actualizar la estación");
    }
  };

  const columns: Column<Station>[] = [
    { key: "id", header: "ID" },
    { key: "name", header: "Nombre" },
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
      key: "created_at",
      header: "Creada",
      render: (r) => (r.created_at ? fmtDate(r.created_at) : "-"),
    },
    {
      key: "actions",
      header: "Acciones",
      render: (r) => (
        <button className="btn" onClick={() => toggle(r.id)}>
          {r.active ? "Desactivar" : "Activar"}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Estaciones</h1>
        <button className="btn" onClick={load} disabled={loading}>
          Recargar
        </button>
      </div>

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
    </div>
  );
}
