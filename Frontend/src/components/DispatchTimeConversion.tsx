"use client";
import {useEffect, useState} from "react";
import {apiJSON} from "../lib/api/api";
import {fmtDate, fmtLiters} from "../lib/utils";

export type DispatchTiming = {
  meter_method?: string;
  pump_started_at?: string | null;
  review_reasons?: string[];
  volume_calculation?: {flow_l_min: number; duration_seconds: number; liters: number; calculated_at: string} | null;
};

export default function DispatchTimeConversion({id, stationId, endedAt, timing, canOperate, onSaved}: {
  id: number; stationId: string; endedAt?: string | null; timing?: DispatchTiming; canOperate: boolean; onSaved: () => void;
}) {
  const [flow, setFlow] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiJSON<{flow_l_min?: number | null}>(`/stations/${encodeURIComponent(stationId)}`)
      .then(s => {if (!cancelled) setFlow(s.flow_l_min ?? null);})
      .catch(() => {if (!cancelled) setError("No se pudo consultar el caudal de la estación.");});
    return () => {cancelled = true;};
  }, [stationId]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (timing?.meter_method !== "timestamps") return null;
  const start = timing.pump_started_at;
  const seconds = start && endedAt ? (Date.parse(endedAt) - Date.parse(start)) / 1000 : NaN;
  const interrupted = (timing.review_reasons || []).some(r => ["reinicio_durante_carga", "intervalo_sin_medicion", "sin_arranque_observado"].includes(r));
  const lpm = Number(flow);
  const liters = seconds / 60 * lpm;
  const valid = Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(lpm) && lpm > 0 && lpm <= 1e6 && liters <= 1e9 && !interrupted;
  async function save() {
    if (!valid || saving) return;
    setSaving(true); setError("");
    try {
      await apiJSON(`/water/dispatch/${id}/convert-time`, {method:"POST", body:JSON.stringify({})});
      onSaved();
    } catch(e: any) {setError(e.message || "No se pudo guardar la conversión");}
    finally {setSaving(false);}
  }
  return <section id="conversion-tiempo" className="card space-y-3">
    <h2 className="text-lg font-semibold">Carga por tiempo</h2>
    <div className="grid sm:grid-cols-3 gap-3 text-sm">
      <div>Inicio de bomba<br/><strong>{start ? fmtDate(start) : "Sin arranque registrado"}</strong></div>
      <div>Fin de carga<br/><strong>{endedAt ? fmtDate(endedAt) : "En curso"}</strong></div>
      <div>Duración<br/><strong>{Number.isFinite(seconds) ? `${(seconds / 60).toFixed(2)} min` : "—"}</strong></div>
    </div>
    {interrupted && <p className="text-amber-700">Hubo interrupciones o no se observó el arranque. Revisá el registro antes de asignar litros.</p>}
    {timing.volume_calculation && <p>Volumen estimado guardado: <strong>{fmtLiters(timing.volume_calculation.liters)}</strong> · Caudal aplicado: {timing.volume_calculation.flow_l_min} L/min.</p>}
    {canOperate && !timing.volume_calculation && <form className="space-y-3" onSubmit={e => {e.preventDefault(); save();}}>
      <p className="text-sm">Caudal de la estación: <strong>{flow ? `${flow} L/min` : "Sin configurar"}</strong></p>
      <a className="text-sm underline" href={`/admin/stations/${encodeURIComponent(stationId)}`}>Ver configuración de la estación</a>
      <p className="text-sm">Litros estimados = minutos de carga × caudal. {valid && <strong>Resultado: {fmtLiters(liters)}</strong>}</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className="btn" disabled={!valid || saving}>{saving ? "Guardando…" : "Guardar litros estimados"}</button>
    </form>}
  </section>;
}
