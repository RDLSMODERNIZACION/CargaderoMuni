
"use client";
import React, { useMemo, useState } from "react";
import { photos as seedPhotos, dispatches, stations, users } from "../../../data/seed";
import PhotoGallery from "../../../components/PhotoGallery";

export default function PhotosPage() {
  const [qStation, setQStation] = useState("");
  const [qUser, setQUser] = useState("");

  const rows = useMemo(() => {
    return seedPhotos.filter(p => {
      const d = dispatches.find(x => x.id === p.dispatch_id);
      const okStation = !qStation || d?.station_id === qStation;
      const okUser = !qUser || String(d?.pin_user_id ?? "") === qUser;
      return okStation && okUser;
    });
  }, [qStation, qUser]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Fotos</h1>
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
        <PhotoGallery photos={rows} />
      </section>
    </div>
  );
}
