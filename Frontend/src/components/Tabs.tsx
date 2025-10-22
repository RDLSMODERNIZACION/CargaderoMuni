"use client";
import React, { useState } from "react";

type TabItem = {
  key: string;
  label: string;
  badge?: React.ReactNode;
  content: React.ReactNode;
};

export default function Tabs({
  tabs,
  defaultTab,
}: {
  tabs: TabItem[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState<string>(defaultTab ?? tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="flex flex-col">
      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {tabs.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                onClick={() => setActive(t.key)}
                className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
                  isActive
                    ? "border-brand text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                <span>{t.label}</span>
                {t.badge ? <span className="ml-2">{t.badge}</span> : null}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="py-4">{current?.content}</div>
    </div>
  );
}
