"use client";

import React, { useEffect, useState } from "react";

import Badge from "../../../components/Badge";
import { useAuth } from "../../../components/AuthContext";
import { apiJSON } from "../../../lib/api/api";

type Organization = {
  id: number;
  name: string;
  active: boolean;
  station_count: number;
};

type OrgStation = {
  id: string;
  name?: string | null;
  active: boolean;
};

type OrgAccessUser = {
  user_id: string;
  email?: string | null;
  app_active: boolean;
  organization_role?: "owner" | "admin" | "operator" | "viewer" | null;
  organization_active?: boolean | null;
};

type StationAccess = {
  station_id: string;
  user_id: string;
  role: "admin" | "operator" | "viewer";
  active: boolean;
};

type AccessUser = {
  user_id: string;
  email?: string | null;
  role: "owner" | "admin" | "operator" | "viewer";
  active: boolean;
  created_at?: string | null;
};

function roleLabel(role: AccessUser["role"]) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Administrador";
  if (role === "operator") return "Operador";
  return "Solo lectura";
}

export default function AccessPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [orgStations, setOrgStations] = useState<OrgStation[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgAccessUser[]>([]);
  const [stationAccess, setStationAccess] = useState<StationAccess[]>([]);
  const [orgName, setOrgName] = useState("");
  const [orgSaving, setOrgSaving] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: "",
    password: "",
    role: "viewer" as AccessUser["role"],
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [data, orgData] = await Promise.all([
        apiJSON<{ ok: boolean; items: AccessUser[] }>("/auth/users"),
        apiJSON<{ ok: boolean; items: Organization[] }>("/organizations"),
      ]);

      setItems(Array.isArray(data?.items) ? data.items : []);
      const orgs = Array.isArray(orgData?.items) ? orgData.items : [];
      setOrganizations(orgs);

      if (!selectedOrgId && orgs.length) {
        setSelectedOrgId(orgs[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar los accesos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === "owner") load();
  }, [user?.role]);

  useEffect(() => {
    if (!selectedOrgId || user?.role !== "owner") return;
    loadOrganizationAccess(selectedOrgId);
  }, [selectedOrgId, user?.role]);

  async function loadOrganizationAccess(orgId: number) {
    try {
      const data = await apiJSON<{
        ok: boolean;
        stations: OrgStation[];
        users: OrgAccessUser[];
        station_access: StationAccess[];
      }>("/organizations/" + orgId + "/access");

      setOrgStations(Array.isArray(data?.stations) ? data.stations : []);
      setOrgUsers(Array.isArray(data?.users) ? data.users : []);
      setStationAccess(Array.isArray(data?.station_access) ? data.station_access : []);

      const org = organizations.find((o) => o.id === orgId);
      setOrgName(org?.name || "");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar la organización");
    }
  }

  async function saveOrganizationName() {
    if (!selectedOrgId || !orgName.trim()) return;
    setOrgSaving(true);
    setError(null);
    try {
      await apiJSON("/organizations/" + selectedOrgId, {
        method: "PATCH",
        body: JSON.stringify({ name: orgName.trim() }),
      });
      await load();
      await loadOrganizationAccess(selectedOrgId);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la organización");
    } finally {
      setOrgSaving(false);
    }
  }

  async function setOrganizationRole(
    targetUserId: string,
    role: "" | "owner" | "admin" | "operator" | "viewer"
  ) {
    if (!selectedOrgId) return;
    setSavingId(targetUserId);
    setError(null);

    try {
      if (!role) {
        await apiJSON(
          "/organizations/" + selectedOrgId + "/users/" + encodeURIComponent(targetUserId),
          { method: "DELETE" }
        );
      } else {
        await apiJSON(
          "/organizations/" + selectedOrgId + "/users/" + encodeURIComponent(targetUserId),
          {
            method: "PUT",
            body: JSON.stringify({ role, active: true }),
          }
        );
      }
      await loadOrganizationAccess(selectedOrgId);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el acceso a la organización");
    } finally {
      setSavingId(null);
    }
  }

  async function setStationRole(
    stationId: string,
    targetUserId: string,
    role: "" | "admin" | "operator" | "viewer"
  ) {
    if (!selectedOrgId) return;
    setSavingId(targetUserId + ":" + stationId);
    setError(null);

    try {
      if (!role) {
        await apiJSON(
          "/organizations/" +
            selectedOrgId +
            "/stations/" +
            encodeURIComponent(stationId) +
            "/users/" +
            encodeURIComponent(targetUserId),
          { method: "DELETE" }
        );
      } else {
        await apiJSON(
          "/organizations/" +
            selectedOrgId +
            "/stations/" +
            encodeURIComponent(stationId) +
            "/users/" +
            encodeURIComponent(targetUserId),
          {
            method: "PUT",
            body: JSON.stringify({ role, active: true }),
          }
        );
      }
      await loadOrganizationAccess(selectedOrgId);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el acceso a la estación");
    } finally {
      setSavingId(null);
    }
  }

  async function createUser() {
    if (!createForm.email.trim() || !createForm.password) {
      setError("Email y contraseña son obligatorios.");
      return;
    }

    setCreateSaving(true);
    setError(null);

    try {
      await apiJSON("/auth/users", {
        method: "POST",
        body: JSON.stringify({
          email: createForm.email.trim(),
          password: createForm.password,
          role: createForm.role,
        }),
      });

      setCreateOpen(false);
      setCreateForm({
        email: "",
        password: "",
        role: "viewer",
      });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear el usuario");
    } finally {
      setCreateSaving(false);
    }
  }

  async function updateAccess(
    item: AccessUser,
    patch: Partial<Pick<AccessUser, "role" | "active">>
  ) {
    setSavingId(item.user_id);
    setError(null);
    try {
      await apiJSON("/auth/users/" + encodeURIComponent(item.user_id), {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el acceso");
    } finally {
      setSavingId(null);
    }
  }

  if (user?.role !== "owner") {
    return (
      <div className="card text-sm text-slate-600">
        Solo el owner puede administrar accesos.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Configuración</h1>
          <p className="text-sm text-slate-500 mt-1">
            Usuarios, organizaciones y permisos por cargadero.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            Recargar
          </button>
          <button className="btn" onClick={() => setCreateOpen(true)}>
            + Nuevo usuario
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="card overflow-x-auto">
        <table className="table min-w-[760px]">
          <thead>
            <tr>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.user_id}>
                <td className="pr-4">
                  <div className="font-medium">{item.email || "—"}</div>
                  {item.user_id === user?.id && (
                    <div className="text-xs text-slate-500">Tu usuario</div>
                  )}
                </td>
                <td className="pr-4">
                  <select
                    className="select max-w-[190px]"
                    value={item.role}
                    disabled={savingId === item.user_id || item.user_id === user?.id}
                    onChange={(e) =>
                      updateAccess(item, {
                        role: e.target.value as AccessUser["role"],
                      })
                    }
                  >
                    <option value="owner">Owner</option>
                    <option value="admin">Administrador</option>
                    <option value="operator">Operador</option>
                    <option value="viewer">Solo lectura</option>
                  </select>
                </td>
                <td className="pr-4">
                  <div className="flex items-center gap-2">
                    <Badge color={item.active ? "green" : "red"}>
                      {item.active ? "Activo" : "Inactivo"}
                    </Badge>
                    {item.user_id !== user?.id && (
                      <button
                        className="btn btn-secondary"
                        disabled={savingId === item.user_id}
                        onClick={() =>
                          updateAccess(item, { active: !item.active })
                        }
                      >
                        {item.active ? "Desactivar" : "Activar"}
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                      })
                    : "—"}
                </td>
              </tr>
            ))}

            {!items.length && !loading && (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500">
                  No hay usuarios registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="text-xs text-slate-500">
        El Owner puede crear usuarios directamente desde acá. Supabase Auth se gestiona por detrás.
      </div>

      <section className="card space-y-5">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-[260px]">
            <label className="text-xs text-slate-500">Organización administradora</label>
            <select
              className="select mt-1"
              value={selectedOrgId ?? ""}
              onChange={(e) => setSelectedOrgId(Number(e.target.value))}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          {selectedOrgId && (
            <div className="flex gap-2 items-end">
              <div>
                <label className="text-xs text-slate-500">Nombre</label>
                <input
                  className="input mt-1"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              </div>
              <button
                className="btn"
                onClick={saveOrganizationName}
                disabled={orgSaving}
              >
                {orgSaving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold">Permisos por organización y cargadero</h2>
          <p className="text-sm text-slate-500 mt-1">
            Un rol en la organización da acceso a todos sus cargaderos. Si no tiene rol de organización,
            podés asignarle acceso solamente a cargaderos específicos.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-3">Usuario</th>
                <th className="text-left font-medium px-4 py-3">Toda la organización</th>
                {orgStations.map((station) => (
                  <th key={station.id} className="text-left font-medium px-4 py-3">
                    {station.name || station.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orgUsers.map((orgUser) => (
                <tr key={orgUser.user_id}>
                  <td className="px-4 py-3 font-medium">{orgUser.email || "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      className="select min-w-[160px]"
                      value={orgUser.organization_role || ""}
                      disabled={savingId === orgUser.user_id}
                      onChange={(e) =>
                        setOrganizationRole(
                          orgUser.user_id,
                          e.target.value as "" | "owner" | "admin" | "operator" | "viewer"
                        )
                      }
                    >
                      <option value="">Sin acceso global</option>
                      <option value="owner">Owner organización</option>
                      <option value="admin">Administrador</option>
                      <option value="operator">Operador</option>
                      <option value="viewer">Solo lectura</option>
                    </select>
                  </td>

                  {orgStations.map((station) => {
                    const current = stationAccess.find(
                      (x) =>
                        x.station_id === station.id &&
                        x.user_id === orgUser.user_id &&
                        x.active
                    );

                    return (
                      <td key={station.id} className="px-4 py-3">
                        <select
                          className="select min-w-[140px]"
                          value={current?.role || ""}
                          disabled={
                            !!orgUser.organization_role ||
                            savingId === orgUser.user_id + ":" + station.id
                          }
                          onChange={(e) =>
                            setStationRole(
                              station.id,
                              orgUser.user_id,
                              e.target.value as "" | "admin" | "operator" | "viewer"
                            )
                          }
                        >
                          <option value="">
                            {orgUser.organization_role ? "Incluido" : "Sin acceso"}
                          </option>
                          <option value="admin">Administrador</option>
                          <option value="operator">Operador</option>
                          <option value="viewer">Solo lectura</option>
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>


      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">Nuevo usuario</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Creá un acceso al panel y asignale un rol.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setCreateOpen(false)}
                disabled={createSaving}
              >
                Cerrar
              </button>
            </div>

            <div className="grid gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Email</label>
                <input
                  type="email"
                  className="input"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, email: e.target.value }))
                  }
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Contraseña inicial</label>
                <input
                  type="password"
                  className="input"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, password: e.target.value }))
                  }
                  autoComplete="new-password"
                />
                <div className="text-xs text-slate-500">
                  Mínimo 8 caracteres.
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Rol</label>
                <select
                  className="select"
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm((p) => ({
                      ...p,
                      role: e.target.value as AccessUser["role"],
                    }))
                  }
                >
                  <option value="viewer">Solo lectura</option>
                  <option value="operator">Operador</option>
                  <option value="admin">Administrador</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => setCreateOpen(false)}
                disabled={createSaving}
              >
                Cancelar
              </button>
              <button className="btn" onClick={createUser} disabled={createSaving}>
                {createSaving ? "Creando…" : "Crear usuario"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
