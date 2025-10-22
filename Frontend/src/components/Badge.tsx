
import React from "react";

export default function Badge({ color = "slate", children }: { color?: "slate" | "green" | "red" | "yellow" | "blue"; children: React.ReactNode }) {
  const map: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-rose-100 text-rose-700",
    yellow: "bg-amber-100 text-amber-700",
    blue: "bg-sky-100 text-sky-700"
  };
  return <span className={`badge ${map[color]}`}>{children}</span>;
}
