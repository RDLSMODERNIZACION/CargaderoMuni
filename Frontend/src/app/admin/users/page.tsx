"use client";
import React, { useMemo, useState } from "react";
import { users as seedUsers, dispatches as allDispatches } from "../../../data/seed";
import type { PinUser } from "../../../lib/types";
import DataTable, { type Column } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import { fmtDate, fmtLiters } from "../../../lib/utils";
import Drawer from "../../../components/Drawer";
import Tabs from "../../../components/Tabs";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(yyyyMm: string) {
  // yyyy-mm → [start, nextMonthStart)
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, (m ?? 1) - 1, 1, 0, 0, 0));
  const next = new Date(Date.UTC(y, (m ?? 1), 1, 0, 0, 0));
  return { start, end: next };
}

export default function UsersPage() {
  const [users, setUsers] = useState<PinUser[]>(seedUsers);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => users.find((u) => u.id === selectedId) ?? null, [users, selectedId]);

  // Filtros de tabla
  const filtered = useMemo(() => {
    return users.filter((u) => {
      const okText = !q || u.name.toLowerCase().includes(q.toLowerCase());
      const st =
        status === ""
          ? true
          : status === "enabled"
          ? u.enabled
          : status === "disabled"
          ? !u.enabled
          : status === "locked"
          ? !!u.locked_until
          : true;
      return okText && st;
    });
  }, [users, q, status]);

  // Columnas
  const columns: Column<PinUser>[] = [
    { key: "id", header: "ID", width: "60px" },
    { key: "name", header: "Nombre" },
    {
      key: "enabled",
      header: "Estado",
      render: (r) => <Badge color={r.enabled ? "green" : "red"}>{r.enabled ? "Habilitado" : "Inhabilitado"}</Badge>
    },
    { key: "tries", header: "Intentos" },
    { key: "locked_until", header: "Bloqueado hasta", render: (r) => (r.locked_until ? fmtDate(r.locked_until) : "—") },
    { key: "created_at", header: "Creado", render: (r) => fmtDate(r.created_at) }
  ];

  // Acciones (estado en memoria + mantener seleccionado sincronizado)
  const syncSelect = (id: number) => setSelectedId((cur) => (cur === id ? id : cur)); // noop pero deja explícito
  const applyUserPatch = (id: number, patch: Partial<PinUser>) =>
    setUsers((prev) => {
      const next = prev.map((u) => (u.id === id ? { ...u, ...patch } : u));
      return next;
    });

  const toggleEnabled = (id: number) => {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    applyUserPatch(id, { enabled: !u.enabled });
    syncSelect(id);
  };

  const resetTries = (id: number) => {
    applyUserPatch(id, { tries: 0 });
    syncSelect(id);
  };

  const lock24h = (id: number) => {
    const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    applyUserPatch(id, { locked_until: until });
    syncSelect(id);
  };

  const unlock = (id: number) => {
    applyUserPatch(id, { locked_until: null });
    syncSelect(id);
  };

  // Facturación (por mes)
  const [billMonth, setBillMonth] = useState<string>(currentMonth());
  const billRows = useMemo(() => {
    if (!selected) return [];
    const { start, end } = monthRange(billMonth);
    return allDispatches.filter((d) => {
      if (d.pin_user_id !== selected.id) return false;
      const t = new Date(d.started_at);
      return t >= start && t < end;
    });
  }, [selected, billMonth]);

  const billCount = billRows.length;
  const billLiters = billRows.reduce((acc, d) => acc + d.litros_entregados, 0);

  const downloadCSV = () => {
    if (!selected) return;
    const header = ["dispatch_id", "fecha_inicio", "fecha_fin", "estacion", "autorizados_l", "entregados_l", "estado", "notas"];
    const lines = billRows.map((d) =>
      [
        d.id,
        new Date(d.started_at).toISOString(),
        d.ended_at ? new Date(d.ended_at).toISOString() : "",
        d.station_name,
        d.litros_autorizados,
        d.litros_entregados,
        d.status,
        (d.notes ?? "").replaceAll(",", " ")
      ].join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facturacion_${selected.name}_${billMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Usuarios PIN</h1>

      {/* Filtros */}
      <section className="card">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Buscar</label>
            <input className="input" placeholder="Nombre..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Estado</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              <option value="enabled">Habilitados</option>
              <option value="disabled">Inhabilitados</option>
              <option value="locked">Bloqueados</option>
            </select>
          </div>
        </div>
      </section>

      {/* Tabla con click abre drawer */}
      <section className="card">
        <DataTable
          rows={filtered}
          columns={columns}
          initialSortKey="name"
          initialSortDir="asc"
          onRowClick={(row) => setSelectedId(row.id)}
          rowClassName={(row) => (selectedId === row.id ? "bg-sky-50" : "")}
        />
        <div className="mt-2 text-xs text-slate-500">Tip: hacé click en una fila para ver acciones y facturación.</div>
      </section>

      {/* Drawer con pestañas: Acciones / Facturación */}
      <Drawer open={!!selected} onClose={() => setSelectedId(null)} title={selected ? `Usuario · ${selected.name}` : ""}>
        {selected && (
          <Tabs
            defaultTab="acciones"
            tabs={[
              {
                key: "acciones",
                label: "Acciones",
                content: (
                  <div className="space-y-4">
                    <div className="card">
                      <h3 className="font-semibold mb-2">Estado</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <Badge color={selected.enabled ? "green" : "red"}>
                          {selected.enabled ? "Habilitado" : "Inhabilitado"}
                        </Badge>
                        <span className="text-slate-500">·</span>
                        <span>Intentos: <b>{selected.tries}</b></span>
                        <span className="text-slate-500">·</span>
                        <span>Bloqueado hasta: <b>{selected.locked_until ? fmtDate(selected.locked_until) : "—"}</b></span>
                      </div>
                    </div>

                    <div className="card">
                      <h3 className="font-semibold mb-3">Acciones rápidas</h3>
                      <div className="flex flex-wrap gap-2">
                        <button className="btn" onClick={() => toggleEnabled(selected.id)}>
                          {selected.enabled ? "Inhabilitar" : "Habilitar"}
                        </button>
                        <button className="btn" onClick={() => resetTries(selected.id)}>Reset intentos</button>
                        {!selected.locked_until ? (
                          <button className="btn" onClick={() => lock24h(selected.id)}>Bloquear 24 h</button>
                        ) : (
                          <button className="btn" onClick={() => unlock(selected.id)}>Desbloquear</button>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">* Demo: los cambios son locales y se pierden al refrescar.</p>
                    </div>
                  </div>
                )
              },
              {
                key: "facturacion",
                label: "Facturación",
                badge: <span className="badge bg-slate-100 text-slate-700">{billRows.length}</span>,
                content: (
                  <div className="space-y-4">
                    <div className="card">
                      <div className="grid md:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">Mes</label>
                          <input
                            type="month"
                            className="input"
                            value={billMonth}
                            onChange={(e) => setBillMonth(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">Cantidad de cargas</label>
                          <div className="h-9 flex items-center">{billCount}</div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">Litros entregados</label>
                          <div className="h-9 flex items-center">{fmtLiters(billLiters)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold">Cargas del período</h3>
                        <button className="btn" onClick={downloadCSV}>Descargar CSV</button>
                      </div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Inicio</th>
                            <th>Fin</th>
                            <th>Estación</th>
                            <th>Autorizados</th>
                            <th>Entregados</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billRows.map((d) => (
                            <tr key={d.id} className="hover:bg-slate-50">
                              <td>{d.id}</td>
                              <td>{fmtDate(d.started_at)}</td>
                              <td>{fmtDate(d.ended_at)}</td>
                              <td>{d.station_name}</td>
                              <td>{fmtLiters(d.litros_autorizados)}</td>
                              <td>{fmtLiters(d.litros_entregados)}</td>
                            </tr>
                          ))}
                          {!billRows.length && (
                            <tr><td colSpan={6} className="text-slate-500 py-4">Sin cargas en el período.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              }
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
