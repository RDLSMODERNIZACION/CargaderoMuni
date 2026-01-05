const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://cargaderomuni.onrender.com"
).replace(/\/$/, "");

export async function apiJSON<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `API ${res.status} ${res.statusText}${text ? ` :: ${text}` : ""}`
    );
  }

  return res.json() as Promise<T>;
}

// ✅ también export default por compatibilidad
export default apiJSON;
