"use client";

import React, { useEffect, useState } from "react";

import Badge from "../../../components/Badge";
import { useAuth } from "../../../components/AuthContext";
import { apiJSON } from "../../../lib/api/api";

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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJSON<{ ok: boolean; items: AccessUser[] }>("/auth/users");
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar los accesos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === "owner") load();
  }, [user?.role]);

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
          <h1 className="text-2xl font-bold">Accesos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Roles y permisos de los usuarios del panel.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          Recargar
        </button>
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
                    disabled={savingId === item.user_id}
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
        Los usuarios nuevos se crean en Supabase Auth y quedan como Solo lectura hasta que el owner les asigne otro rol.
      </div>
    </div>
  );
}
