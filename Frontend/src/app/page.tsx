
import Link from "next/link";

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Cargadero · Panel Admin (demo)</h1>
      <p>Elegí una sección:</p>
      <div className="flex gap-2">
        <Link className="btn btn-primary" href="/admin/dispatches">Ir a Despachos</Link>
        <Link className="btn" href="/admin/users">Usuarios PIN</Link>
      </div>
    </div>
  );
}
