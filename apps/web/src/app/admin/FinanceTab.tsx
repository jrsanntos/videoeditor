"use client";

import { useState } from "react";
import { api, brl, btn, btnPrimary, card, date, ErrorBox, input, Stat, td, th, usd, useApi } from "./ui";

type Finance = {
  from: string;
  to: string;
  rate: number;
  revenue: number;
  profit: number;
  expenses: {
    total: number;
    manual: number;
    aiBRL: number;
    aiUSD: number;
    aiByProvider: { provider: string; kind: string; calls: number; cost_usd: number; credits: number }[];
  };
  months: { month: string; revenue: number; expenses: number }[];
  payments: { id: number; amount_brl: number; description: string; paid_at: string; user_email: string | null }[];
  expenseEntries: { id: number; category: string; description: string; amount_brl: number; spent_at: string }[];
};

const KIND: Record<string, string> = { agent: "Agente de edição", transcribe: "Transcrição", template_extract: "Extração de modelos" };
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

export function FinanceTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { data, error, reload } = useApi<Finance>(`/api/admin/finance?from=${from}&to=${to}`);

  async function remove(kind: "payment" | "expense", id: number) {
    if (!confirm("Apagar este lançamento?")) return;
    await api(`/api/admin/finance?kind=${kind}&id=${id}`, { method: "DELETE" });
    await reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-400">
          De
          <input type="date" className={`${input} ml-2`} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-zinc-400">
          Até
          <input type="date" className={`${input} ml-2`} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ErrorBox message={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Receitas" value={brl(data.revenue)} />
            <Stat label="Despesas" value={brl(data.expenses.total)} hint={`Lançadas ${brl(data.expenses.manual)}`} />
            <Stat label="Custo de IA" value={brl(data.expenses.aiBRL)} hint={`${usd(data.expenses.aiUSD)} · cotação ${data.rate.toFixed(2)}`} />
            <Stat label="Resultado" value={brl(data.profit)} tone={data.profit >= 0 ? "good" : "bad"} />
          </div>

          <MonthsChart months={data.months} />

          <div className={card}>
            <h3 className="mb-3 text-sm font-medium text-zinc-200">Custo de IA no período (despesa automática)</h3>
            {data.expenses.aiByProvider.length === 0 ? (
              <p className="text-sm text-zinc-500">Nenhuma chamada de IA no período.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Uso</th>
                    <th className={`${th} text-right`}>Chamadas</th>
                    <th className={`${th} text-right`}>Créditos cobrados</th>
                    <th className={`${th} text-right`}>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.aiByProvider.map((r) => (
                    <tr key={`${r.provider}-${r.kind}`} className="border-t border-zinc-900">
                      <td className={td}>
                        {KIND[r.kind] ?? r.kind} <span className="text-xs text-zinc-500">({r.provider})</span>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{r.calls}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.credits}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {usd(r.cost_usd)} <span className="text-xs text-zinc-500">≈ {brl(r.cost_usd * data.rate)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Ledger
              title="Receitas"
              rows={data.payments.map((p) => ({
                id: p.id,
                date: p.paid_at,
                text: p.description,
                sub: p.user_email ?? "sem usuário",
                amount: p.amount_brl,
              }))}
              onDelete={(id) => void remove("payment", id)}
            />
            <Ledger
              title="Despesas lançadas"
              rows={data.expenseEntries.map((e) => ({ id: e.id, date: e.spent_at, text: e.description, sub: e.category, amount: e.amount_brl }))}
              onDelete={(id) => void remove("expense", id)}
            />
          </div>
          <EntryForm onSaved={reload} />
          <p className="text-xs text-zinc-500">
            As receitas são lançadas à mão (ou ao mudar o plano de um usuário) até a integração com Stripe/Pix. O custo de IA é medido em cada chamada,
            pelos tokens e segundos de áudio, e convertido pela cotação definida em Chaves de API.
          </p>
        </>
      )}
    </div>
  );
}

function MonthsChart({ months }: { months: Finance["months"] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.revenue, m.expenses]));
  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Últimos 12 meses</h3>
        <div className="flex gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-sm bg-emerald-500" /> Receitas
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-sm bg-rose-500" /> Despesas
          </span>
        </div>
      </div>
      <div className="flex h-40 items-end gap-1.5">
        {months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: receitas ${brl(m.revenue)}, despesas ${brl(m.expenses)}`}>
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              <div className="w-1/2 max-w-3 rounded-t bg-emerald-500" style={{ height: `${(m.revenue / max) * 100}%` }} />
              <div className="w-1/2 max-w-3 rounded-t bg-rose-500" style={{ height: `${(m.expenses / max) * 100}%` }} />
            </div>
            <span className="text-[10px] text-zinc-500">{m.month.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ledger({
  title,
  rows,
  onDelete,
}: {
  title: string;
  rows: { id: number; date: string; text: string; sub: string; amount: number }[];
  onDelete: (id: number) => void;
}) {
  return (
    <div className={card}>
      <h3 className="mb-3 text-sm font-medium text-zinc-200">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nada no período.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="truncate text-zinc-200">{r.text}</div>
                <div className="text-xs text-zinc-500">
                  {date(r.date)} · {r.sub}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-zinc-100">{brl(r.amount)}</span>
                <button className="text-xs text-zinc-500 hover:text-rose-300" onClick={() => onDelete(r.id)} aria-label="Apagar">
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<"expense" | "payment">("expense");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/finance", {
        method: "POST",
        json: {
          kind,
          amountBRL: Number(f.get("amount")),
          description: f.get("description"),
          date: f.get("date"),
          ...(kind === "expense" ? { category: f.get("category") } : { userEmail: f.get("userEmail") || undefined }),
        },
      });
      form.reset();
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-200">Novo lançamento</h3>
        <div className="ml-auto flex rounded-md border border-zinc-800 p-0.5">
          {(["expense", "payment"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded px-2 py-1 text-xs ${kind === k ? "bg-zinc-800 text-white" : "text-zinc-400"}`}
            >
              {k === "expense" ? "Despesa" : "Receita"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <input name="description" required placeholder={kind === "expense" ? "Ex.: Hospedagem de novembro" : "Ex.: Plano Creator — novembro"} className={`${input} md:col-span-2`} />
        {kind === "expense" ? (
          <input name="category" required placeholder="Categoria (ex.: infraestrutura)" list="expense-categories" className={input} />
        ) : (
          <input name="userEmail" type="email" placeholder="E-mail do cliente (opcional)" className={input} />
        )}
        <input name="amount" type="number" min="0.01" step="0.01" required placeholder="Valor (R$)" className={input} />
        <input name="date" type="date" required defaultValue={today()} className={input} />
      </div>
      <datalist id="expense-categories">
        <option value="infraestrutura" />
        <option value="marketing" />
        <option value="ferramentas" />
        <option value="impostos" />
        <option value="pessoal" />
      </datalist>
      <ErrorBox message={error} />
      <button className={btnPrimary} disabled={busy}>
        Lançar {kind === "expense" ? "despesa" : "receita"}
      </button>
      <button type="reset" className={`${btn} ml-2`}>
        Limpar
      </button>
    </form>
  );
}
