import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "DIRAC",
  description: "Panel de administración del cargadero",
  icons: {
    icon: "/cargaderosdeagua/logodirac.jpeg",
    shortcut: "/cargaderosdeagua/logodirac.jpeg",
    apple: "/cargaderosdeagua/logodirac.jpeg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen grid grid-cols-[220px_1fr]">
          <aside className="border-r border-slate-200 p-4 space-y-4 bg-white">
            <div className="border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <img
                  src="/cargaderosdeagua/logodirac.jpeg"
                  alt="DIRAC"
                  className="h-10 w-10 rounded-lg object-contain bg-white"
                />
                <div>
                  <div className="text-lg font-bold tracking-wide text-slate-900">DIRAC</div>
                  <div className="text-xs text-slate-500">Cargaderos de Agua</div>
                </div>
              </div>
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
