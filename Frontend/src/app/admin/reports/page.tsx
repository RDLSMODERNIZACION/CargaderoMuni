
"use client";
import React, { useMemo } from "react";
import { dispatches, stations, users } from "../../../data/seed";
import { fmtLiters } from "../../../lib/utils";

export default function ReportsPage() {
  const byUser = useMemo(() => {
    const map = new Map<number, number>();
    dispatches.forEach(d => {
      if (!d.pin_user_id) return;
      map.set(d.pin_user_id, (map.get(d.pin_user_id) || 0) + d.litros_entregados);
    });
    return Array.from(map.entries()).map(([uid, liters]) => ({
      uid,
      name: users.find(u => u.id === uid)?.name || String(uid),
      liters
    })).sort((a,b)=>b.liters - a.liters);
  }, []);

  const byStation = useMemo(() => {
    const map = new Map<string, number>();
    dispatches.forEach(d => {
      map.set(d.station_id, (map.get(d.station_id) || 0) + d.litros_entregados);
    });
    return Array.from(map.entries()).map(([sid, liters]) => ({
      sid,
      name: stations.find(s => s.id === sid)?.name || sid,
      liters
    })).sort((a,b)=>b.liters - a.liters);
  }, []);

  const total = useMemo(() => dispatches.reduce((acc, d) => acc + d.litros_entregados, 0), []);

  const downloadCSV = (rows: { name: string; liters: number }[], filename: string) => {
    const header = "name,liters\n";
    const body = rows.map(r => `${r.name},${r.liters}`).join("\n");
    const csv = header + body;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reportes</h1>

      <section className="grid md:grid-cols-3 gap-3">
        <div className="card">
          <div className="text-sm text-slate-500">Total entregado</div>
          <div className="text-2xl font-semibold">{fmtLiters(total)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500"># Despachos</div>
          <div className="text-2xl font-semibold">{dispatches.length}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Usuarios activos</div>
          <div className="text-2xl font-semibold">{new Set(dispatches.map(d => d.pin_user_id).filter(Boolean)).size}</div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Consumo por usuario</h2>
          <button className="btn" onClick={() => downloadCSV(byUser.map(({name, liters})=>({name, liters})), "consumo_por_usuario.csv")}>Descargar CSV</button>
        </div>
        <table className="table">
          <thead><tr><th>Usuario</th><th>Litros</th></tr></thead>
          <tbody>
            {byUser.map(r => (
              <tr key={r.uid}><td>{r.name}</td><td>{fmtLiters(r.liters)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Consumo por estación</h2>
          <button className="btn" onClick={() => downloadCSV(byStation.map(({name, liters})=>({name, liters})), "consumo_por_estacion.csv")}>Descargar CSV</button>
        </div>
        <table className="table">
          <thead><tr><th>Estación</th><th>Litros</th></tr></thead>
          <tbody>
            {byStation.map(r => (
              <tr key={r.sid}><td>{r.name}</td><td>{fmtLiters(r.liters)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
