"use client";

import { PLANS, type PlanId } from "@videoeditor/core";
import { brl, card, dateTime, ErrorBox, Stat, td, th, useApi } from "./ui";

type Overview = {
  users: number;
  active30: number;
  banned: number;
  newThisMonth: number;
  byPlan: { plan: string; n: number }[];
  mrrBRL: number;
  templates: number;
  month: { revenue: number; profit: number; expenses: { total: number; aiBRL: number } };
  recent: { id: string; email: string; name: string; plan: string; created_at: string }[];
  log: { action: string; target: string | null; created_at: string; actor_email: string | null; target_email: string | null }[];
};

const ACTIONS: Record<string, string> = {
  ban: "suspendeu",
  unban: "reativou",
  grant_credits: "ajustou créditos de",
  set_plan: "mudou o plano de",
  set_role: "mudou o papel de",
  set_setting: "atualizou a configuração",
  clear_setting: "removeu a configuração",
  add_payment: "lançou uma receita",
  add_expense: "lançou uma despesa",
  delete_payment: "apagou uma receita",
  delete_expense: "apagou uma despesa",
  extract_template: "extraiu um modelo",
  template_published: "publicou um modelo",
  template_draft: "despublicou um modelo",
  edit_template: "editou um modelo",
  delete_template: "apagou um modelo",
};

export function OverviewTab() {
  const { data, error } = useApi<Overview>("/api/admin/overview");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <p className="text-sm text-zinc-500">Carregando…</p>;
  const m = data.month;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Usuários" value={String(data.users)} hint={`${data.newThisMonth} novos este mês`} />
        <Stat label="Ativos (30 dias)" value={String(data.active30)} hint={`${data.banned} suspensos`} />
        <Stat label="Receita do mês" value={brl(m.revenue)} hint={`MRR estimado pelos planos: ${brl(data.mrrBRL)}`} />
        <Stat
          label="Resultado do mês"
          value={brl(m.profit)}
          hint={`Despesas ${brl(m.expenses.total)} (IA ${brl(m.expenses.aiBRL)})`}
          tone={m.profit >= 0 ? "good" : "bad"}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <h3 className="mb-3 text-sm font-medium text-zinc-200">Usuários por plano</h3>
          {(Object.keys(PLANS) as PlanId[]).map((p) => {
            const n = data.byPlan.find((b) => b.plan === p)?.n ?? 0;
            const pct = data.users ? (n / data.users) * 100 : 0;
            return (
              <div key={p} className="mb-2">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>{PLANS[p].name} · {brl(PLANS[p].priceBRL)}/mês</span>
                  <span>{n}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-zinc-800">
                  <div className="h-1.5 rounded bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          <p className="mt-3 text-xs text-zinc-500">{data.templates} modelo(s) de edição publicados.</p>
        </div>
        <div className={card}>
          <h3 className="mb-3 text-sm font-medium text-zinc-200">Cadastros recentes</h3>
          <table className="w-full">
            <tbody>
              {data.recent.map((u) => (
                <tr key={u.id} className="border-t border-zinc-900">
                  <td className={td}>
                    <div className="text-zinc-100">{u.name}</div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </td>
                  <td className={`${td} text-right text-xs text-zinc-500`}>{dateTime(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className={card}>
        <h3 className="mb-3 text-sm font-medium text-zinc-200">Atividade administrativa</h3>
        {data.log.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma ação registrada ainda.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Quando</th>
                <th className={th}>Quem</th>
                <th className={th}>O quê</th>
              </tr>
            </thead>
            <tbody>
              {data.log.map((l, i) => (
                <tr key={i} className="border-t border-zinc-900">
                  <td className={`${td} whitespace-nowrap text-xs`}>{dateTime(l.created_at)}</td>
                  <td className={td}>{l.actor_email}</td>
                  <td className={td}>
                    {ACTIONS[l.action] ?? l.action} {l.target_email ?? (l.action.includes("setting") ? l.target : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
