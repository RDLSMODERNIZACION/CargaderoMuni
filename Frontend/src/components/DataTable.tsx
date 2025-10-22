"use client";
import React, { useMemo, useState } from "react";

export type Column<T> = {
  key: keyof T | string;
  header: string;
  width?: string;
  render?: (row: T) => React.ReactNode;
  sort?: (a: T, b: T) => number;
};

export default function DataTable<T extends { [k: string]: any }>({
  rows,
  columns,
  initialSortKey,
  initialSortDir = "desc",
  onRowClick,
  rowClassName
}: {
  rows: T[];
  columns: Column<T>[];
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    const arr = [...rows];
    arr.sort((a, b) => {
      if (col?.sort) return col.sort!(a, b) * (sortDir === "asc" ? 1 : -1);
      const va = (a as any)[sortKey];
      const vb = (b as any)[sortKey];
      if (typeof va === "number" && typeof vb === "number")
        return (va - vb) * (sortDir === "asc" ? 1 : -1);
      return String(va ?? "").localeCompare(String(vb ?? "")) * (sortDir === "asc" ? 1 : -1);
    });
    return arr;
  }, [rows, columns, sortKey, sortDir]);

  const onHeaderClick = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={String(c.key)}
                style={{ width: c.width }}
                onClick={() => onHeaderClick(String(c.key))}
                className="cursor-pointer select-none"
              >
                <div className="flex items-center gap-1">
                  <span>{c.header}</span>
                  {sortKey === c.key ? (
                    <span className="text-slate-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const clickable = !!onRowClick;
            const rowCls =
              (rowClassName ? rowClassName(r) : "") +
              " " +
              (clickable ? "hover:bg-slate-50 cursor-pointer" : "hover:bg-slate-50");
            return (
              <tr
                key={i}
                className={rowCls.trim()}
                onClick={clickable ? () => onRowClick!(r) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick!(r);
                        }
                      }
                    : undefined
                }
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : -1}
              >
                {columns.map((c) => (
                  <td key={String(c.key)} className="pr-4">
                    {c.render ? c.render(r) : String((r as any)[c.key as keyof T] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
