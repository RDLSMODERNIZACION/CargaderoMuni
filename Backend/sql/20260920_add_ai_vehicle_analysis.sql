-- Analisis IA de fotos del vehiculo asociado a cada despacho.
-- No reemplaza company_id: conserva la empresa oficial identificada por PIN/Hikvision.
ALTER TABLE public.water_dispatch
ADD COLUMN IF NOT EXISTS ai_vehicle_analysis jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.water_dispatch.ai_vehicle_analysis IS
'Resultado de IA sobre fotos: patente, empresa visible, confianza y comparacion con empresa autenticada.';
