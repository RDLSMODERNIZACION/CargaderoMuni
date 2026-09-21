"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Route } from "next";
import Tabs from "../../../../components/Tabs";
import Badge from "../../../../components/Badge";
import { apiJSON } from "../../../../lib/api/api";

type Company = {
  id: number;
  name: string;
  code: string;
  pin?: string | null;
  active: boolean;
};

type Driver = {
  id: number;
  name: string;
  document_number?: string | null;
  phone?: string | null;
  enabled: boolean;
  rfid_credential_id?: number | null;
  rfid_uid?: string | null;
  rfid_active?: boolean | null;
};

type DriverForm = {
  name: string;
  document_number: string;
  phone: string;
  rfid_uid: string;
  enabled: boolean;
};

const emptyDriverForm: DriverForm = {
  name: "",
  document_number: "",
  phone: "",
  rfid_uid: "",
  enabled: true,
};

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const companyId = Number(params.id || 0);

  const [company, setCompany] = useState<Company | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [driversLoading, setDriversLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [driverFormOpen, setDriverFormOpen] = useState(false);
  const [driverForm, setDriverForm] = useState<DriverForm>(emptyDriverForm);
  const [driverSaving, setDriverSaving] = useState(false);

  async function loadCompany() {
    const data = await apiJSON<Company>("/company/id/" + companyId);
    setCompany(data);
  }

  async function loadDrivers() {
    if (!companyId) return;
    setDriversLoading(true);
    try {
      const data = await apiJSON<{ ok: boolean; items: Driver[] }>(
        "/company/id/" + companyId + "/drivers"
      );
      setDrivers(Array.isArray(data?.items) ? data.items : []);
    } finally {
      setDriversLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadCompany(), loadDrivers()]);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar la empresa");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!companyId) return;
    loadAll();
  }, [companyId]);

  async function saveDriver() {
    if (!company || !driverForm.name.trim()) {
      setError("El nombre del camionero es obligatorio.");
      return;
    }

    setDriverSaving(true);
    setError(null);

    try {
      await apiJSON("/company/id/" + company.id + "/drivers", {
        method: "POST",
        body: JSON.stringify({
          name: driverForm.name.trim(),
          document_number: driverForm.document_number.trim() || null,
          phone: driverForm.phone.trim() || null,
          rfid_uid: driverForm.rfid_uid.trim() || null,
          enabled: driverForm.enabled,
        }),
      });

      setDriverFormOpen(false);
      setDriverForm(emptyDriverForm);
      await loadDrivers();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar el camionero");
    } finally {
      setDriverSaving(false);
    }
  }

  async function toggleDriver(driver: Driver) {
    if (!company) return;
    setError(null);
    try {
      await apiJSON("/company/id/" + company.id + "/drivers/" + driver.id, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !driver.enabled }),
      });
      await loadDrivers();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el camionero");
    }
  }

  async function deleteDriver(driver: Driver) {
    if (!company) return;
    const ok = window.confirm(
      '¿Eliminar al camionero "' + driver.name + '"? Su RFID dejará de estar asociada.'
    );
    if (!ok) return;

    setError(null);
    try {
      await apiJSON("/company/id/" + company.id + "/drivers/" + driver.id, {
        method: "DELETE",
      });
      await loadDrivers();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar el camionero");
    }
  }

  const tabs = useMemo(
    () => [
      {
        key: "resumen",
        label: "Resumen",
        content: (
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="card">
              <div className="text-xs text-slate-500">Empresa</div>
              <div className="font-semibold mt-1">{company?.name || "—"}</div>
            </div>
            <div className="card">
              <div className="text-xs text-slate-500">Código</div>
              <div className="font-semibold mt-1">{company?.code || "—"}</div>
            </div>
            <div className="card">
              <div className="text-xs text-slate-500">PIN de respaldo</div>
              <div className="font-semibold mt-1">{company?.pin || "—"}</div>
            </div>
            <div className="card">
              <div className="text-xs text-slate-500">Estado</div>
              <div className="mt-1">
                {company && (
                  <Badge color={company.active ? "green" : "red"}>
                    {company.active ? "Activa" : "Inactiva"}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: "camioneros",
        label: "Camioneros y RFID",
        badge: (
          <span className="badge bg-slate-100 text-slate-700">
            {drivers.length}
          </span>
        ),
        content: (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold">Camioneros habilitados</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Cada camionero queda asociado a esta empresa y a su RFID.
                </p>
              </div>
              <button className="btn" onClick={() => setDriverFormOpen(true)}>
                + Agregar camionero
              </button>
            </div>

            {driversLoading ? (
              <div className="text-sm text-slate-500">Cargando camioneros…</div>
            ) : drivers.length === 0 ? (
              <div className="card text-sm text-slate-500">
                Todavía no hay camioneros registrados para esta empresa.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Camionero</th>
                      <th className="text-left font-medium px-4 py-3">DNI</th>
                      <th className="text-left font-medium px-4 py-3">Teléfono</th>
                      <th className="text-left font-medium px-4 py-3">RFID / UID</th>
                      <th className="text-left font-medium px-4 py-3">Estado</th>
                      <th className="text-right font-medium px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {drivers.map((driver) => (
                      <tr key={driver.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium">{driver.name}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {driver.document_number || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {driver.phone || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {driver.rfid_uid ? (
                            <code className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">
                              {driver.rfid_uid}
                            </code>
                          ) : (
                            <span className="text-amber-700">Sin asignar</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={driver.enabled ? "green" : "red"}>
                            {driver.enabled ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button className="btn btn-secondary" onClick={() => toggleDriver(driver)}>
                              {driver.enabled ? "Desactivar" : "Activar"}
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={() => deleteDriver(driver)}
                              style={{ color: "#b91c1c" }}
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ),
      },
    ],
    [company, drivers, driversLoading]
  );

  if (loading) {
    return <div className="text-sm text-slate-500">Cargando empresa…</div>;
  }

  if (!company) {
    return <div className="text-sm text-slate-500">Empresa no encontrada.</div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            className="text-sm text-slate-500 hover:text-slate-800 mb-2"
            onClick={() => router.push("/admin/users" as Route)}
          >
            ← Volver a empresas
          </button>
          <h1 className="text-2xl font-bold">{company.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Empresa {company.code} · camioneros y credenciales RFID
          </p>
        </div>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        <Tabs tabs={tabs} defaultTab="camioneros" />
      </section>

      {driverFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">Agregar camionero</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Empresa: <b>{company.name}</b>
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setDriverFormOpen(false)}
                disabled={driverSaving}
              >
                Cerrar
              </button>
            </div>

            <div className="grid gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Nombre y apellido *</label>
                <input
                  className="input"
                  value={driverForm.name}
                  onChange={(e) => setDriverForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ej. Juan Pérez"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">DNI</label>
                  <input
                    className="input"
                    value={driverForm.document_number}
                    onChange={(e) =>
                      setDriverForm((p) => ({ ...p, document_number: e.target.value }))
                    }
                    placeholder="Opcional"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Teléfono</label>
                  <input
                    className="input"
                    value={driverForm.phone}
                    onChange={(e) => setDriverForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Código RFID / UID</label>
                <input
                  className="input font-mono"
                  value={driverForm.rfid_uid}
                  onChange={(e) =>
                    setDriverForm((p) => ({ ...p, rfid_uid: e.target.value.toUpperCase() }))
                  }
                  placeholder="Pasar tarjeta o escribir UID"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-500">
                  Puede quedar vacío hasta que confirmemos qué valor entrega el lector.
                </p>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={driverForm.enabled}
                  onChange={(e) =>
                    setDriverForm((p) => ({ ...p, enabled: e.target.checked }))
                  }
                />
                <span className="text-sm">Camionero habilitado</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => setDriverFormOpen(false)}
                disabled={driverSaving}
              >
                Cancelar
              </button>
              <button className="btn" onClick={saveDriver} disabled={driverSaving}>
                {driverSaving ? "Guardando…" : "Guardar camionero"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
