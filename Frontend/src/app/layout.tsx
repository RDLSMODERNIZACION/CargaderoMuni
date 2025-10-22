import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Cargadero · Admin",
  description: "Panel de administración del cargadero (hardcoded)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen grid grid-cols-[220px_1fr]">
          <aside className="border-r border-slate-200 p-4 space-y-4">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon.svg" alt="logo" className="w-6 h-6" />
              <div className="font-semibold">Cargadero Admin</div>
            </div>
            <nav className="flex flex-col gap-1">
              <Link className="btn" href="/admin/dispatches">Despachos</Link>
              <Link className="btn" href="/admin/users">Usuarios</Link>
              <Link className="btn" href="/admin/stations">Estaciones</Link>
              <Link className="btn" href="/admin/reports">KPI</Link>
            </nav>
            <div className="text-xs text-slate-500">Demo sin endpoints</div>
          </aside>
          <main className="p-6 bg-slate-50">
            <div className="container">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
