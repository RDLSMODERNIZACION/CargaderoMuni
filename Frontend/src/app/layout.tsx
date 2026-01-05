import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Cargadero · Admin",
  description: "Panel de administración del cargadero",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen grid grid-cols-[220px_1fr]">
          <aside className="border-r border-slate-200 p-4 space-y-4 bg-white">
            {/* Header sin ícono */}
            <div className="font-semibold text-slate-800">
              Panel de Administracion
            </div>

            <nav className="flex flex-col gap-1">
              <Link className="btn" href="/admin/dispatches">
                Despachos
              </Link>

              <Link className="btn" href="/admin/users">
                Empresas
              </Link>

              <Link className="btn" href="/admin/stations">
                Estaciones
              </Link>

              <Link className="btn" href="/admin/reports">
                KPI
              </Link>
            </nav>
          </aside>

          <main className="p-6 bg-slate-50">
            <div className="container">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
