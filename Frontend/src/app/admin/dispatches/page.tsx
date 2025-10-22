"use client";
import React, { useMemo, useState } from "react";
import { dispatches as seedDispatches, stations, users } from "../../../data/seed";
import type { Dispatch } from "../../../lib/types";
import { fmtDate, fmtLiters } from "../../../lib/utils";
import DataTable, { type Column } from "../../../components/DataTable";
import Drawer from "../../../components/Drawer";
import PhotoGallery from "../../../components/PhotoGallery";
import Tabs from "../../../components/Tabs";

// --- Helpers de patente ---
function plateNorm(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
// obtiene patente desde snapshot o la extrae de notes (patente: ABC123 / plate: ABC123)
function plateOf(d: Dispatch): string {
  const snap = (d as any).vehicle_plate_snapshot as string | undefined;
  if (snap && snap.trim()) return plateNorm(snap);
  if (d.notes) {
    const m = d.notes.match(/(?:patente|plate)\s*[: ]*([A-Z0-9 -]{5,10})/i);
    if (m?.[1]) return plateNorm(m[1]);
  }
  return "—";
}

export default function DispatchesPage() {
  const NONE = "__NONE__"; // valor especial para "Sin patente"

  const [qStation, setQStation] = useState<string>("");
  const [qUser, setQUser] = useState<string>("");
  const [qPlate, setQPlate] = useState<string>(""); // ▼ desplegable de patente
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [selected, setSelected] = useState<Dispatch | null>(null);

  // lista de patentes disponibles (únicas) para el desplegable
  const plates = useMemo(() => {
    const set = new Set<string>();
    seedDispatches.forEach((d) => {
      const p = plateOf(d);
      if (p !== "—") set.add(p);
    });
    return Array.from(set).sort();
  }, []);

  const filtered = useMemo(() => {
    return seedDispatches.filter((d) => {
      const okStation = !qStation || d.station_id === qStation;
      const okUser = !qUser || String(d.pin_user_id ?? "") === qUser;
      const start = from ? new Date(from).getTime() : -Infinity;
      const end = to ? new Date(to).getTime() : Infinity;
      const dt = new Date(d.started_at).getTime();
      const okDate = dt >= start && dt <= end;
      const plate = plateOf(d);
      const okPlate =
        !qPlate ||
        (qPlate === NONE ? plate === "—" : plate !== "—" && plate === qPlate);
      return okStation && okUser && okDate && okPlate;
    });
  }, [qStation, qUser, qPlate, from, to]);

  const columns: Column<Dispatch>[] = [
    { key: "id", header: "ID", width: "80px" },
    { key: "station_name", header: "Estación" },
    { key: "user_name", header: "Usuario" },
    { key: "patente", header: "Patente", render: (r) => <code>{plateOf(r)}</code> },
    {
      key: "litros_autorizados",
      header: "Autorizados",
      render: (r) => fmtLiters(r.litros_autorizados),
      sort: (a, b) => a.litros_autorizados - b.litros_autorizados,
    },
    {
      key: "litros_entregados",
      header: "Entregados",
      render: (r) => fmtLiters(r.litros_entregados),
      sort: (a, b) => a.litros_entregados - b.litros_entregados,
    },
    { key: "started_at", header: "Inicio", render: (r) => fmtDate(r.started_at) },
    { key: "ended_at", header: "Fin", render: (r) => fmtDate(r.ended_at) },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Despachos</h1>
        <button className="btn">Exportar CSV</button>
      </header>

      <section className="card">
        {/* Sin 'Estado'. Agregamos Patente como <select> + opción "Sin patente" */}
        <div className="grid md:grid-cols-5 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Estación</label>
            <select className="select" value={qStation} onChange={(e) => setQStation(e.target.value)}>
              <option value="">Todas</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Usuario</label>
            <select className="select" value={qUser} onChange={(e) => setQUser(e.target.value)}>
              <option value="">Todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Patente</label>
            <select className="select" value={qPlate} onChange={(e) => setQPlate(e.target.value)}>
              <option value="">Todas</option>
              <option value={NONE}>Sin patente</option>
              {plates.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Desde</label>
            <input
              type="datetime-local"
              className="input"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Hasta</label>
            <input
              type="datetime-local"
              className="input"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <DataTable
          rows={filtered}
          columns={columns}
          initialSortKey="started_at"
          initialSortDir="desc"
          onRowClick={(row) => setSelected(row)}
          rowClassName={(row) => (selected?.id === row.id ? "bg-sky-50" : "")}
        />
        <div className="mt-2 text-xs text-slate-500">Tip: hacé click en una fila para ver el detalle.</div>
      </section>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Despacho #${selected.id}` : ""}
      >
        {selected && (
          <Tabs
            defaultTab="resumen"
            tabs={[
              {
                key: "resumen",
                label: "Resumen",
                content: (
                  <div className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-3">
                      <div className="card">
                        <h3 className="font-semibold mb-2">Resumen</h3>
                        <ul className="text-sm space-y-1">
                          <li><b>Estación:</b> {selected.station_name}</li>
                          <li><b>Usuario:</b> {selected.user_name || "—"}</li>
                          <li><b>Patente:</b> <code>{plateOf(selected)}</code></li>
                          <li><b>Inicio:</b> {fmtDate(selected.started_at)}</li>
                          <li><b>Fin:</b> {fmtDate(selected.ended_at)}</li>
                          <li><b>Autorizados:</b> {fmtLiters(selected.litros_autorizados)}</li>
                          <li><b>Entregados:</b> {fmtLiters(selected.litros_entregados)}</li>
                          <li><b>Fuente:</b> {selected.source}</li>
                          <li><b>Notas:</b> {selected.notes || "—"}</li>
                        </ul>
                      </div>
                      <div className="card">
                        <h3 className="font-semibold mb-2">Eventos</h3>
                        <ul className="text-sm space-y-1">
                          {selected.events?.length ? (
                            selected.events.map((e) => (
                              <li key={e.id}>
                                {fmtDate(e.ts)} · <b>{e.state.toUpperCase()}</b>{" "}
                                <span className="text-slate-400">{e.source || ""}</span>
                              </li>
                            ))
                          ) : (
                            <li className="text-slate-500">Sin eventos.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                key: "fotos",
                label: "Fotos",
                badge: (
                  <span className="badge bg-slate-100 text-slate-700">
                    {(selected.photos?.length ?? 0).toString()}
                  </span>
                ),
                content: (
                  <div className="card">
                    <PhotoGallery photos={selected.photos || []} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
