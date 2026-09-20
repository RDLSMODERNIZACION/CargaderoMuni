"use client";

import React, { useEffect, useMemo, useState } from "react";
import DataTable, { type Column } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import Drawer from "../../../components/Drawer";
import Tabs from "../../../components/Tabs";
import { apiJSON } from "../../../lib/api/api";
import { fmtDate, fmtLiters } from "../../../lib/utils";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, (m ?? 1) - 1, 1, 0, 0, 0));
  const next = new Date(Date.UTC(y, (m ?? 1), 1, 0, 0, 0));
  return { start, end: next };
}

function norm(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}

// ✅ Empresa (antes “usuario”)
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

const emptyCompanyForm: CompanyForm = {
  name: "",
  code: "",
  pin: "",
  active: true,
};

// ✅ Despachos para facturación por empresa
type DispatchRow = {
  id: number;
  ts: string;
  station_id: string;
  liters: number | null;
  note?: string | null;
  company_id?: number | null;
  company_name?: string | null;
  company_code?: string | null;
};

export default function UsersPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(""); // "" | "active" | "inactive"
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = useMemo(
    () => companies.find((c) => c.id === selectedId) ?? null,
    [companies, selectedId]
  );

  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CompanyForm>(emptyCompanyForm);

  // ====== Cargar empresas ======
  async function loadCompanies() {
    setLoadingMeta(true);
    setError(null);
    try {
      // ✅ Traemos TODAS (activas + inactivas)
      const res = await apiJSON<{ ok: boolean; items: Company[] }>(`/company?active=false`);
      setCompanies(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      setCompanies([]);
      setError(e?.message ?? "Error cargando empresas");
    } finally {
      setLoadingMeta(false);
    }
  }

  useEffect(() => {
    if (!mounted) return;
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // ====== Filtros ======
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

  // ====== Columnas ======
  const columns: Column<Company>[] = [
    { key: "id", header: "ID", width: "70px" },
    { key: "name", header: "Empresa" },
    { key: "code", header: "Código" },
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

  // ====== Acciones (backend real) ======
  async function deactivateCompany(code: string) {
    setError(null);
    try {
      await apiJSON<{ ok: boolean }>(`/company/${encodeURIComponent(code)}/deactivate`, {
        method: "POST",
      });
      await loadCompanies();
    } catch (e: any) {
      setError(e?.message ?? "Error desactivando empresa");
    }
  }

  async function reactivateCompany(c: Company) {
    // ✅ El POST /company crea/actualiza y la deja active=TRUE
    setError(null);
    try {
      await apiJSON<{ ok: boolean; id: number }>(`/company`, {
        method: "POST",
        body: JSON.stringify({
          name: c.name,
          code: c.code,
          pin: c.pin ?? null,
        }),
      });
      await loadCompanies();
    } catch (e: any) {
      setError(e?.message ?? "Error reactivando empresa");
    }
  }


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

  async function deleteCompany(company: Company) {
    const ok = window.confirm(
      "¿Eliminar la empresa \"" + company.name + "\"?\n\nSi tiene despachos, saldo, pagos o movimientos asociados, el sistema bloqueará el borrado."
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

  // ====== Facturación por mes (por empresa) ======
  const [billMonth, setBillMonth] = useState<string>(currentMonth());
  const [billRows, setBillRows] = useState<DispatchRow[]>([]);

  async function loadBillingRows() {
    if (!selected) {
      setBillRows([]);
      return;
    }

    setLoadingBill(true);
    setError(null);

    try {
      const { start, end } = monthRange(billMonth);

      // ✅ Traemos recientes y filtramos por company_id + mes en front
      const res = await apiJSON<{ ok: boolean; items: DispatchRow[] }>(
        `/water/dispatch/recent?limit=500`
      );
      const items = Array.isArray(res?.items) ? res.items : [];

      const inMonth = items.filter((d) => {
        if ((d.company_id ?? null) !== selected.id) return false;
        const t = d.ts ? new Date(d.ts) : null;
        return !!t && t >= start && t < end;
      });

      inMonth.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setBillRows(inMonth);
    } catch (e: any) {
      setBillRows([]);
      setError(e?.message ?? "Error cargando facturación");
    } finally {
      setLoadingBill(false);
    }
  }

  useEffect(() => {
    if (!mounted) return;
    loadBillingRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, selectedId, billMonth]);

  const billCount = billRows.length;
  const billLiters = billRows.reduce((acc, d) => acc + (d.liters ?? 0), 0);

  const downloadCSV = () => {
    if (!selected) return;

    const header = ["dispatch_id", "fecha", "estacion", "litros", "empresa", "nota"];
    const lines = billRows.map((d) =>
      [
        d.id,
        d.ts ? new Date(d.ts).toISOString() : "",
        d.station_id,
        d.liters ?? 0,
        d.company_name || d.company_code || "",
        (d.note ?? "").replaceAll(",", " "),
      ].join(",")
    );

    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facturacion_${selected.code}_${billMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          <button className="btn btn-secondary" onClick={loadCompanies} disabled={loadingMeta || loadingBill}>
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

      {/* Filtros */}
      <section className="card">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Buscar</label>
            <input
              className="input"
              placeholder="Empresa / código / ID..."
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
              disabled={loadingMeta || loadingBill}
            >
              Limpiar
            </button>
          </div>
        </div>
      </section>

      {/* Tabla */}
      <section className="card">
        {loadingMeta ? (
          <div className="text-sm text-slate-500">Cargando…</div>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            initialSortKey="name"
            initialSortDir="asc"
            onRowClick={(row) => setSelectedId(row.id)}
            rowClassName={(row) => (selectedId === row.id ? "bg-sky-50" : "")}
          />
        )}
        <div className="mt-2 text-xs text-slate-500">
          Tip: click en una fila para acciones y facturación mensual.
        </div>
      </section>

      {/* Drawer */}
      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? `Empresa · ${selected.name}` : ""}
      >
        {selected && (
          <Tabs
            defaultTab="acciones"
            tabs={[
              {
                key: "acciones",
                label: "Acciones",
                content: (
                  <div className="space-y-4">
                    <div className="card">
                      <h3 className="font-semibold mb-2">Datos</h3>
                      <div className="text-sm space-y-1">
                        <div><b>Empresa:</b> {selected.name}</div>
                        <div><b>Código:</b> {selected.code}</div>
                        <div><b>PIN:</b> {selected.pin ? String(selected.pin) : "—"}</div>
                        <div>
                          <b>Estado:</b>{" "}
                          <Badge color={selected.active ? "green" : "red"}>
                            {selected.active ? "Activa" : "Inactiva"}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <h3 className="font-semibold mb-3">Acciones rápidas</h3>
                      <div className="flex flex-wrap gap-2">
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
                  </div>
                ),
              },
              {
                key: "facturacion",
                label: "Facturación",
                badge: (
                  <span className="badge bg-slate-100 text-slate-700">
                    {billRows.length}
                  </span>
                ),
                content: (
                  <div className="space-y-4">
                    <div className="card">
                      <div className="grid md:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">Mes</label>
                          <input
                            type="month"
                            className="input"
                            value={billMonth}
                            onChange={(e) => setBillMonth(e.target.value)}
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">Cantidad de cargas</label>
                          <div className="h-9 flex items-center">
                            {loadingBill ? "…" : billCount}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">Litros entregados</label>
                          <div className="h-9 flex items-center">
                            {loadingBill ? "…" : fmtLiters(billLiters)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold">Cargas del período</h3>
                        <div className="flex items-center gap-2">
                          <button className="btn btn-secondary" onClick={loadBillingRows} disabled={loadingBill}>
                            Recargar
                          </button>
                          <button className="btn" onClick={downloadCSV} disabled={!billRows.length}>
                            Descargar CSV
                          </button>
                        </div>
                      </div>

                      <table className="table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Fecha</th>
                            <th>Estación</th>
                            <th>Litros</th>
                            <th>Nota</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billRows.map((d) => (
                            <tr key={d.id} className="hover:bg-slate-50">
                              <td>{d.id}</td>
                              <td>{d.ts ? fmtDate(d.ts) : "—"}</td>
                              <td>{d.station_id}</td>
                              <td>{fmtLiters(d.liters ?? 0)}</td>
                              <td>{d.note ?? "—"}</td>
                            </tr>
                          ))}
                          {!billRows.length && (
                            <tr>
                              <td colSpan={5} className="text-slate-500 py-4">
                                Sin cargas en el período.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>

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
