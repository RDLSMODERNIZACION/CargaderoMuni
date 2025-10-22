
export const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
};

export const fmtLiters = (n: number) => {
  if (n >= 1000) return (n/1000).toFixed(2) + " m³";
  return n.toFixed(0) + " L";
};

export const capitalize = (s?: string | null) => s ? s[0].toUpperCase() + s.slice(1) : "";
