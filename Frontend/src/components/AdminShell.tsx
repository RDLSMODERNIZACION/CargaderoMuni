"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin/dispatches", label: "Despachos" },
  { href: "/admin/users", label: "Empresas" },
  { href: "/admin/stations", label: "Estaciones" },
  { href: "/admin/reports", label: "KPI" },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/cargaderosdeagua/logodirac.jpeg"
        alt="DIRAC"
        className="h-10 w-10 rounded-lg object-contain bg-white"
      />
      <div className="min-w-0">
        <div className="text-lg font-bold tracking-wide text-slate-900">DIRAC</div>
        <div className="text-xs text-slate-500 whitespace-nowrap">Cargaderos de Agua</div>
      </div>
    </div>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const nav = (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            className={
              "btn w-full justify-start " +
              (active ? "border-slate-300 bg-slate-100 text-slate-950" : "")
            }
            href={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden md:block border-r border-slate-200 p-4 space-y-4 bg-white">
        <div className="border-b border-slate-200 pb-4">
          <Brand />
        </div>
        {nav}
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5 md:hidden">
        <Brand />
        <button
          type="button"
          className="btn min-h-11 px-4"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menú"
          aria-expanded={menuOpen}
        >
          ☰ Menú
        </button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            aria-label="Cerrar menú"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[82vw] max-w-[300px] overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <Brand />
              <button
                type="button"
                className="btn min-h-10"
                onClick={() => setMenuOpen(false)}
                aria-label="Cerrar menú"
              >
                ✕
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <main className="min-w-0 bg-slate-50 p-3 sm:p-4 md:p-6">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
