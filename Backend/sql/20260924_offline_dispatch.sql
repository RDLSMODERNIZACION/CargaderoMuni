-- Additive only; preserves existing dispatches and their RLS policies.
BEGIN;
ALTER TABLE public.water_dispatch ADD COLUMN IF NOT EXISTS offline_id uuid;
ALTER TABLE public.water_dispatch ADD COLUMN IF NOT EXISTS offline_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.water_dispatch ADD COLUMN IF NOT EXISTS offline_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.water_dispatch ADD COLUMN IF NOT EXISTS ended_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS water_dispatch_offline_id_key ON public.water_dispatch(offline_id);
COMMIT;
