"use client";
import {useState} from "react";
import {apiJSON} from "../lib/api/api";
import {fmtDate, fmtLiters} from "../lib/utils";

export type DispatchTiming = {
  meter_method?: string;
  pump_started_at?: string | null;
  review_reasons?: string[];
  volume_calculation?: {flow_l_min: number; duration_seconds: number; liters: number; calculated_at: string} | null;
};

export default function DispatchTimeConversion({id, endedAt, timing, canOperate, onSaved}: {
  id: number; endedAt?: string | null; timing?: DispatchTiming; canOperate: boolean; onSaved: () => void;
}) {
  const [flow, setFlow] = useState(String(timing?.volume_calculation?.flow_l_min || ""));
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
      await apiJSON(`/water/dispatch/${id}/convert-time`, {method:"POST", body:JSON.stringify({flow_l_min:lpm})});
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
    {canOperate && <form className="space-y-3" onSubmit={e => {e.preventDefault(); save();}}>
      <label htmlFor="conversion-flow" className="block text-sm">Caudal para esta carga (L/min)</label>
      <input id="conversion-flow" className="input max-w-xs" type="number" step="any" min="0.001" max="1000000" value={flow} onChange={e => setFlow(e.target.value)} placeholder="Ingresá el caudal verificado" disabled={saving}/>
      <p className="text-sm">Litros estimados = minutos de carga × caudal. {valid && <strong>Resultado: {fmtLiters(liters)}</strong>}</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className="btn" disabled={!valid || saving}>{saving ? "Guardando…" : "Guardar litros estimados"}</button>
    </form>}
  </section>;
}
