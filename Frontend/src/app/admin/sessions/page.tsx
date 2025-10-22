
"use client";
import React, { useMemo, useState } from "react";
import { sessions as seed, users, stations } from "../../../data/seed";
import DataTable, { type Column } from "../../../components/DataTable";
import type { PinSession } from "../../../lib/types";
import { fmtDate } from "../../../lib/utils";
import Badge from "../../../components/Badge";

export default function SessionsPage() {
  const [qStation, setQStation] = useState("");
  const [qUser, setQUser] = useState("");

  const rows = useMemo(() => seed, []);
  const filtered = useMemo(() => rows.filter(s => (!qStation || s.station_id === qStation) && (!qUser || String(s.pin_user_id) === qUser)), [rows, qStation, qUser]);

  const columns: Column<PinSession & { user_name?: string; station_name?: string }>[] = [
    { key: "id", header: "ID", width: "70px" },
    { key: "station_id", header: "Estación", render: (r) => stations.find(s => s.id === r.station_id)?.name || r.station_id },
    { key: "pin_user_id", header: "Usuario", render: (r) => users.find(u => u.id === r.pin_user_id)?.name || r.pin_user_id },
    { key: "started_at", header: "Inicio", render: (r) => fmtDate(r.started_at) },
    { key: "expires_at", header: "Expira", render: (r) => fmtDate(r.expires_at || null) },
    { key: "max_liters", header: "Máximo (L)" },
    { key: "status", header: "Estado", render: (r) => <Badge color={r.status === "active" ? "yellow" : "slate"}>{r.status}</Badge> }
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sesiones PIN</h1>
      <section className="card grid md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Estación</label>
          <select className="select" value={qStation} onChange={e => setQStation(e.target.value)}>
            <option value="">Todas</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Usuario</label>
          <select className="select" value={qUser} onChange={e => setQUser(e.target.value)}>
            <option value="">Todos</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </section>
      <section className="card">
        <DataTable rows={filtered} columns={columns} initialSortKey="started_at" initialSortDir="desc" />
      </section>
    </div>
  );
}
