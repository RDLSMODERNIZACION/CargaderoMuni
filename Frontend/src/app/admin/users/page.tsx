"use client";

import React, { useEffect, useMemo, useState } from "react";
import DataTable, { type Column } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import { apiJSON } from "../../../lib/api/api";

function norm(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}

type Company = {
  id: number;
  name: string;
  code: string;
  pin?: string | null;
  active: boolean;
};

type CompanyForm = {
  name: string;
  code: string;
  pin: string;
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

const emptyCompanyForm: CompanyForm = {
  name: "",
  code: "",
  pin: "",
  active: true,
};

const emptyDriverForm: DriverForm = {
  name: "",
  document_number: "",
  phone: "",
  rfid_uid: "",
  enabled: true,
};

export default function UsersPage() {
  const [mounted, setMounted] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CompanyForm>(emptyCompanyForm);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driverFormOpen, setDriverFormOpen] = useState(false);
  const [driverForm, setDriverForm] = useState<DriverForm>(emptyDriverForm);
  const [driverSaving, setDriverSaving] = useState(false);
  const [detailTab, setDetailTab] = useState<"company" | "drivers">("drivers");

  useEffect(() => setMounted(true), []);

  const selected = useMemo(
    () => companies.find((c) => c.id === selectedId) ?? null,
    [companies, selectedId]
  );

  async function loadCompanies() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJSON<{ ok: boolean; items: Company[] }>("/company?active=false");
      setCompanies(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      setCompanies([]);
      setError(e?.message ?? "Error cargando empresas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!mounted) return;
    loadCompanies();
  }, [mounted]);

  async function loadDrivers(companyId: number) {
    setDriversLoading(true);
    try {
      const res = await apiJSON<{ ok: boolean; items: Driver[] }>(
        "/company/id/" + companyId + "/drivers"
      );
      setDrivers(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      setDrivers([]);
      setError(e?.message ?? "Error cargando camioneros");
    } finally {
      setDriversLoading(false);
    }
  }

  useEffect(() => {
    if (selectedId == null) {
      setDrivers([]);
      return;
    }
    loadDrivers(selectedId);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const qq = norm(q);
    return companies.filter((c) => {
      const okText =
        !qq ||
        norm(c.name).includes(qq) ||
        norm(c.code).includes(qq) ||
        norm(String(c.id)).includes(qq);

      const okStatus =
        status === ""
          ? true
          : status === "active"
          ? c.active
          : status === "inactive"
          ? !c.active
          : true;

      return okText && okStatus;
    });
  }, [companies, q, status]);

  const columns: Column<Company>[] = [
    { key: "id", header: "ID", width: "70px" },
    { key: "name", header: "Empresa" },
    {
      key: "pin",
      header: "PIN",
      render: (r) => (r.pin ? String(r.pin) : "—"),
    },
    {
      key: "active",
      header: "Estado",
      render: (r) => (
        <Badge color={r.active ? "green" : "red"}>
          {r.active ? "Activa" : "Inactiva"}
        </Badge>
      ),
    },
  ];

  function openCreate() {
    setEditing(null);
    setForm(emptyCompanyForm);
    setFormOpen(true);
  }

  function openEdit(company: Company) {
    setEditing(company);
    setForm({
      name: company.name || "",
      code: company.code || "",
      pin: company.pin || "",
      active: company.active,
    });
    setFormOpen(true);
  }

  async function saveCompany() {
    if (!form.name.trim() || !form.code.trim()) {
      setError("Nombre y código son obligatorios.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editing) {
        await apiJSON("/company/id/" + editing.id, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim(),
            code: form.code.trim(),
            pin: form.pin.trim() || null,
            active: form.active,
          }),
        });
      } else {
        const created = await apiJSON<{ ok: boolean; id: number }>("/company", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            code: form.code.trim(),
            pin: form.pin.trim() || null,
          }),
        });

        if (!form.active) {
          await apiJSON("/company/id/" + created.id, {
            method: "PATCH",
            body: JSON.stringify({ active: false }),
          });
        }
      }

      setFormOpen(false);
      setEditing(null);
      setForm(emptyCompanyForm);
      await loadCompanies();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar la empresa");
    } finally {
      setSaving(false);
    }
  }

  async function setCompanyActive(company: Company, active: boolean) {
    setError(null);
    try {
      await apiJSON("/company/id/" + company.id, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      await loadCompanies();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el estado de la empresa");
    }
  }

  function openCreateDriver() {
    setDriverForm(emptyDriverForm);
    setDriverFormOpen(true);
  }

  async function saveDriver() {
    if (!selected || !driverForm.name.trim()) {
      setError("El nombre del camionero es obligatorio.");
      return;
    }

    setDriverSaving(true);
    setError(null);
    try {
      await apiJSON("/company/id/" + selected.id + "/drivers", {
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
      await loadDrivers(selected.id);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar el camionero");
    } finally {
      setDriverSaving(false);
    }
  }

  async function setDriverEnabled(driver: Driver, enabled: boolean) {
    if (!selected) return;
    setError(null);
    try {
      await apiJSON("/company/id/" + selected.id + "/drivers/" + driver.id, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await loadDrivers(selected.id);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el camionero");
    }
  }

  async function deleteDriver(driver: Driver) {
    if (!selected) return;
    const ok = window.confirm(
      "¿Eliminar al camionero \"" + driver.name + "\"? Su RFID dejará de estar asociada."
    );
    if (!ok) return;

    setError(null);
    try {
      await apiJSON("/company/id/" + selected.id + "/drivers/" + driver.id, {
        method: "DELETE",
      });
      await loadDrivers(selected.id);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar el camionero");
    }
  }

  async function deleteCompany(company: Company) {
    const ok = window.confirm(
      "¿Eliminar definitivamente la empresa \"" + company.name + "\"?\n\nLos despachos históricos se conservarán, pero quedarán sin empresa asociada."
    );
    if (!ok) return;

    setError(null);
    try {
      await apiJSON("/company/id/" + company.id, { method: "DELETE" });
      if (selectedId === company.id) setSelectedId(null);
      await loadCompanies();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar la empresa");
    }
  }

  if (!mounted) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Empresas (PIN)</h1>
          <p className="text-sm text-slate-500 mt-1">
            Administrá empresas, códigos de acceso y PIN.
          </p>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={loadCompanies} disabled={loading}>
            Recargar
          </button>
          <button className="btn" onClick={openCreate}>
            + Nueva empresa
          </button>
        </div>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-300 text-red-700 bg-red-50 text-sm">
          {error}
        </div>
      )}

      <section className="card">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Buscar</label>
            <input
              className="input"
              placeholder="Empresa / ID..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Estado</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
          </div>

          <div className="flex items-end justify-end">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setQ("");
                setStatus("");
              }}
              disabled={loading}
            >
              Limpiar
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        {loading ? (
          <div className="text-sm text-slate-500">Cargando…</div>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            initialSortKey="name"
            initialSortDir="asc"
            onRowClick={(row) => {
              setSelectedId(row.id);
              setDetailTab("drivers");
            }}
            rowClassName={(row) => (selectedId === row.id ? "bg-sky-50" : "")}
          />
        )}
        <div className="mt-2 text-xs text-slate-500">
          Click en una empresa para ver sus datos, camioneros y tarjetas RFID.
        </div>
      </section>

      {selected && (
        <section className="card p-0 overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 pt-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Empresa seleccionada</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <h2 className="text-xl font-semibold">{selected.name}</h2>
                  <Badge color={selected.active ? "green" : "red"}>
                    {selected.active ? "Activa" : "Inactiva"}
                  </Badge>
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedId(null)}
              >
                Cerrar detalle
              </button>
            </div>

            <div className="flex gap-1 overflow-x-auto">
              <button
                className={
                  "px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap " +
                  (detailTab === "company"
                    ? "border-sky-600 text-sky-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800")
                }
                onClick={() => setDetailTab("company")}
              >
                Datos de empresa
              </button>
              <button
                className={
                  "px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap " +
                  (detailTab === "drivers"
                    ? "border-sky-600 text-sky-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800")
                }
                onClick={() => setDetailTab("drivers")}
              >
                Camioneros y RFID ({drivers.length})
              </button>
            </div>
          </div>

          <div className="p-5">
            {detailTab === "company" ? (
              <div className="grid xl:grid-cols-[1fr_auto] gap-5">
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500">Empresa</div>
                    <div className="font-semibold mt-1">{selected.name}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500">Código</div>
                    <div className="font-semibold mt-1">{selected.code}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500">PIN de respaldo</div>
                    <div className="font-semibold mt-1">
                      {selected.pin ? String(selected.pin) : "—"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500">Estado</div>
                    <div className="mt-1">
                      <Badge color={selected.active ? "green" : "red"}>
                        {selected.active ? "Activa" : "Inactiva"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 self-start">
                  <button className="btn btn-secondary" onClick={() => openEdit(selected)}>
                    Editar
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setCompanyActive(selected, !selected.active)}
                  >
                    {selected.active ? "Desactivar" : "Activar"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => deleteCompany(selected)}
                    style={{ borderColor: "#fecaca", color: "#b91c1c" }}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-lg font-semibold">Camioneros de {selected.name}</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Asociá cada camionero con su RFID. El PIN de la empresa queda únicamente como respaldo.
                    </p>
                  </div>
                  <button className="btn" onClick={openCreateDriver}>
                    + Agregar camionero
                  </button>
                </div>

                {driversLoading ? (
                  <div className="text-sm text-slate-500 py-6">Cargando camioneros…</div>
                ) : drivers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
                    <div className="font-medium">No hay camioneros registrados</div>
                    <div className="text-sm text-slate-500 mt-1">
                      Agregá el primer camionero y luego asociá su tarjeta RFID.
                    </div>
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
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => setDriverEnabled(driver, !driver.enabled)}
                                >
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
            )}
          </div>
        </section>
      )}

      {driverFormOpen && selected && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">Agregar camionero</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Empresa: <b>{selected.name}</b>. La RFID se puede cargar ahora o dejar pendiente para leerla mañana.
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
                  Podés dejarlo vacío y asignarlo cuando confirmemos qué código entrega el lector.
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

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-semibold">
                  {editing ? "Editar empresa" : "Nueva empresa"}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  El código es el identificador que se sincroniza con Hikvision.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cerrar
              </button>
            </div>

            <div className="grid gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Nombre de empresa</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ej. TECHIN"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Código</label>
                  <input
                    className="input"
                    value={form.code}
                    onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                    placeholder="EmployeeNo"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">PIN</label>
                  <input
                    className="input"
                    value={form.pin}
                    onChange={(e) => setForm((p) => ({ ...p, pin: e.target.value }))}
                    placeholder="PIN de acceso"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
                />
                <span className="text-sm">Empresa activa</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button className="btn" onClick={saveCompany} disabled={saving}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear empresa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
