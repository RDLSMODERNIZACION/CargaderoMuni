"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";

import { apiJSON } from "../../lib/api/api";
import { getValidAccessToken, signIn } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = searchParams.get("next") || "/admin/dispatches";

  useEffect(() => {
    let cancelled = false;

    async function checkExistingSession() {
      const token = await getValidAccessToken();
      if (!token || cancelled) return;

      try {
        await apiJSON("/auth/me");
        if (!cancelled) router.replace(next as Route);
      } catch {
        // Sesión inválida: se queda en login.
      }
    }

    checkExistingSession();

    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();

    if (!email.trim() || !password) {
      setError("Ingresá email y contraseña.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signIn(email.trim(), password);
      await apiJSON("/auth/me");
      router.replace(next as Route);
    } catch (e: any) {
      setError(e?.message || "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <div className="flex items-center gap-3">
            <img
              src="/cargaderosdeagua/logodirac.jpeg"
              alt="DIRAC"
              className="h-12 w-12 rounded-xl object-contain bg-white"
            />
            <div>
              <div className="text-2xl font-bold tracking-wide">DIRAC</div>
              <div className="text-sm text-slate-500">Cargaderos de Agua</div>
            </div>
          </div>
        </div>

        <form className="card p-6 space-y-5" onSubmit={submit}>
          <div>
            <h1 className="text-xl font-semibold">Iniciar sesión</h1>
            <p className="text-sm text-slate-500 mt-1">
              Acceso al panel de administración.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Contraseña</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full justify-center"
            disabled={loading}
          >
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
