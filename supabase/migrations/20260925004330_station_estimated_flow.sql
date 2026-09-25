ALTER TABLE public.station
  ADD COLUMN IF NOT EXISTS flow_l_min double precision;
ALTER TABLE public.station ADD CONSTRAINT station_flow_l_min_valid
  CHECK (flow_l_min IS NULL OR (flow_l_min > 0 AND flow_l_min <= 1000000));
COMMENT ON COLUMN public.station.flow_l_min IS 'Caudal configurado en L/min para estimaciones por tiempo; cada despacho conserva el valor aplicado.';
