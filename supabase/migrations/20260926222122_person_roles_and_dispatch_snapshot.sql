ALTER TABLE public.pin_user
  ADD COLUMN person_role text NOT NULL DEFAULT 'driver'
    CHECK (person_role IN ('driver', 'loading_staff')),
  ADD COLUMN person_role_since timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.water_dispatch
  ADD COLUMN person_role text
    CHECK (person_role IN ('driver', 'loading_staff'));

COMMENT ON COLUMN public.pin_user.person_role IS 'Clasificación interna; no modifica employeeNo ni credenciales Hikvision.';
COMMENT ON COLUMN public.water_dispatch.person_role IS 'Rol al registrar la carga. NULL indica clasificación desconocida; no se infiere del método de acceso.';

CREATE FUNCTION public.track_person_role_since()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.person_role IS DISTINCT FROM OLD.person_role THEN
    NEW.person_role_since := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pin_user_role_since
BEFORE UPDATE OF person_role ON public.pin_user
FOR EACH ROW EXECUTE FUNCTION public.track_person_role_since();

CREATE FUNCTION public.snapshot_dispatch_person_role()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Deleting a person uses ON DELETE SET NULL: retain the historical role.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pin_user_id IS NULL OR NEW.pin_user_id IS NOT DISTINCT FROM OLD.pin_user_id THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.person_role := NULL;
  IF NEW.pin_user_id IS NOT NULL THEN
    -- Delayed offline receipts older than the known role are not guessed.
    SELECT u.person_role INTO NEW.person_role
      FROM public.pin_user u
      WHERE u.id = NEW.pin_user_id AND NEW.ts >= u.person_role_since;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER water_dispatch_person_role
BEFORE INSERT OR UPDATE OF pin_user_id ON public.water_dispatch
FOR EACH ROW EXECUTE FUNCTION public.snapshot_dispatch_person_role();
