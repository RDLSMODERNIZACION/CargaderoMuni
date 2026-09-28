-- Associations are managed only through the authenticated FastAPI endpoints.
-- A plate may have a different association in a different organization.
CREATE TABLE public.vehicle_company (
    organization_id bigint NOT NULL REFERENCES public.organization(id),
    plate text NOT NULL CHECK (plate ~ '^([A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$'),
    company_id bigint NOT NULL REFERENCES public.company(id),
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
    PRIMARY KEY (organization_id, plate)
);
CREATE INDEX vehicle_company_company_idx ON public.vehicle_company(company_id);
ALTER TABLE public.vehicle_company ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_company FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_company TO service_role;
COMMENT ON TABLE public.vehicle_company IS
'Human-confirmed plate/company associations by organization. Backend-only; station permissions and company access are checked in FastAPI. History preserves reassignments.';
