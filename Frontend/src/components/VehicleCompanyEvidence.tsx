export type CompanyEvidence = {
  company_assignment?: {source: string; plate: string; company_id: number; company_name: string};
  company_visible?: string | null;
  company_exclusion_reason?: string;
  company_suggested?: string | null;
  company_confidence?: number;
  company_check_status?: string;
  company_expected?: string | null;
  company_alert?: boolean;
  plate_company?: {company_id: number; company_name: string; plate: string} | null;
  visible_text?: string[];
  last_analysis_error?: string;
};

export function companyKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/\s+(?:S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?)\s*$/, "")
    .replace(/[^A-Z0-9]/g, "");
}

export default function VehicleCompanyEvidence({analysis, expected}: {
  analysis: CompanyEvidence; expected?: string | null;
}) {
  const visible = analysis.company_visible?.trim();
  const suggested = visible && (analysis.company_confidence || 0) >= 0.6 ? visible : null;
  const reference = expected === undefined ? analysis.company_expected || analysis.plate_company?.company_name : expected;
  const mismatch = !!(suggested && reference && companyKey(suggested) !== companyKey(reference));
  const label = !suggested ? "Sin evidencia suficiente" : !reference ? "Pendiente de asociar" : mismatch ? "Alerta: la empresa sugerida no coincide" : "Coincide con la empresa asociada";
  return <div className={`rounded-xl border p-4 ${mismatch ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
    <div className="text-xs text-slate-500">Empresa sugerida por IA</div>
    <div className="mt-1 font-semibold">{suggested || "Sin identificar"}</div>
    <p className={`mt-2 text-sm ${mismatch ? "text-red-700 font-medium" : "text-slate-600"}`} role={mismatch ? "alert" : undefined}>{label}</p>
    {analysis.company_exclusion_reason && <p className="mt-1 text-sm text-slate-600">El texto detectado está excluido como empresa sugerida.</p>}
    {analysis.company_assignment && <p className="mt-2 text-sm text-green-700">Empresa autocompletada por patente confirmada: {analysis.company_assignment.company_name}</p>}
    {reference && <p className="mt-1 text-sm">Empresa de referencia: {reference}</p>}
    {!!analysis.visible_text?.length && <p className="mt-2 text-xs text-slate-500">Texto observado: {analysis.visible_text.join(" · ")}</p>}
    <p className="mt-2 text-xs text-slate-500">Sugerencia basada en logos o textos de las fotos. Requiere revisión; no modifica la asociación guardada.</p>
    {analysis.last_analysis_error && <p className="mt-2 text-sm text-amber-700">No se pudo completar el último análisis. Se conserva la evidencia anterior.</p>}
  </div>;
}
