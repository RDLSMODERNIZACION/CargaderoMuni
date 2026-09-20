import "./globals.css";
import AdminShell from "../components/AdminShell";

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
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
