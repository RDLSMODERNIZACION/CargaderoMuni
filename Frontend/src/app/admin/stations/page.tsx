
"use client";
import React, { useState } from "react";
import { stations as seed } from "../../../data/seed";
import type { Station } from "../../../lib/types";
import DataTable, { type Column } from "../../../components/DataTable";
import { fmtDate } from "../../../lib/utils";
import Badge from "../../../components/Badge";

export default function StationsPage() {
  const [rows, setRows] = useState<Station[]>(seed);

  const toggle = (id: string) => {
    setRows(prev => prev.map(s => s.id === id ? { ...s, active: !s.active } : s));
  };

  const columns: Column<Station>[] = [
    { key: "id", header: "ID" },
    { key: "name", header: "Nombre" },
    { key: "active", header: "Estado", render: (r) => <Badge color={r.active ? "green" : "red"}>{r.active ? "Activa" : "Inactiva"}</Badge> },
    { key: "created_at", header: "Creada", render: (r) => fmtDate(r.created_at) },
    { key: "actions", header: "Acciones", render: (r) => <button className="btn" onClick={() => toggle(r.id)}>{r.active ? "Desactivar" : "Activar"}</button> }
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Estaciones</h1>
      <section className="card">
        <DataTable rows={rows} columns={columns} initialSortKey="name" initialSortDir="asc" />
      </section>
    </div>
  );
}
