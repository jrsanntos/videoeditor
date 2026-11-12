"use client";

import { useState } from "react";
import { FinanceTab } from "./FinanceTab";
import { OverviewTab } from "./OverviewTab";
import { SettingsTab } from "./SettingsTab";
import { TemplatesTab } from "./TemplatesTab";
import { UsersTab } from "./UsersTab";

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "users", label: "Usuários" },
  { id: "finance", label: "Financeiro" },
  { id: "templates", label: "Modelos" },
  { id: "settings", label: "Chaves de API" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export type Me = { id: string; name: string; email: string };

export function AdminPanel({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center gap-4 border-b border-zinc-800 bg-zinc-950 px-4">
        <span className="text-sm font-semibold text-white">videoeditor</span>
        <span className="text-sm text-zinc-500">Administração</span>
        <a href="/app" className="ml-auto text-sm text-zinc-300 hover:text-white">
          ← Voltar ao editor
        </a>
        <span className="text-xs text-zinc-500">{me.email}</span>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-4" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${
              tab === t.id ? "border-white text-white" : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        {tab === "overview" && <OverviewTab />}
        {tab === "users" && <UsersTab me={me} />}
        {tab === "finance" && <FinanceTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}
