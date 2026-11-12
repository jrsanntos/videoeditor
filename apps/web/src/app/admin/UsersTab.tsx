"use client";

import { useState } from "react";
import { PLANS, type PlanId } from "@videoeditor/core";
import type { Me } from "./AdminPanel";
import { api, Badge, brl, btn, btnDanger, btnPrimary, card, date, dateTime, ErrorBox, input, td, th, usd, useApi } from "./ui";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  plan: PlanId;
  banned_at: string | null;
  ban_reason: string | null;
  created_at: string;
  last_seen_at: string | null;
  credits: number;
  spent_credits: number;
  cost_usd: number;
  paid_brl: number;
};

export function UsersTab({ me }: { me: Me }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "banned" | "admins">("all");
  const { data, error, reload } = useApi<{ total: number; users: UserRow[] }>(
    `/api/admin/users?q=${encodeURIComponent(query)}&filter=${filter}`,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.users.find((u) => u.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <input className={`${input} min-w-0 flex-1`} placeholder="Buscar por nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={input} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtro">
          <option value="all">Todos</option>
          <option value="banned">Suspensos</option>
          <option value="admins">Admins</option>
        </select>
        <button className={btn}>Buscar</button>
      </form>
      <ErrorBox message={error} />
      <div className={`${card} overflow-x-auto p-0`}>
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className={th}>Usuário</th>
              <th className={th}>Plano</th>
              <th className={`${th} text-right`}>Créditos</th>
              <th className={`${th} text-right`}>Custo IA</th>
              <th className={`${th} text-right`}>Pago</th>
              <th className={th}>Último acesso</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className="border-t border-zinc-900 hover:bg-zinc-900/50">
                <td className={td}>
                  <div className="flex items-center gap-2 text-zinc-100">
                    {u.name}
                    {u.role === "admin" && <Badge tone="info">admin</Badge>}
                    {u.banned_at && <Badge tone="bad">suspenso</Badge>}
                  </div>
                  <div className="text-xs text-zinc-500">{u.email}</div>
                </td>
                <td className={td}>{PLANS[u.plan]?.name ?? u.plan}</td>
                <td className={`${td} text-right tabular-nums`}>{u.credits}</td>
                <td className={`${td} text-right tabular-nums`}>{usd(u.cost_usd)}</td>
                <td className={`${td} text-right tabular-nums`}>{brl(u.paid_brl)}</td>
                <td className={`${td} text-xs`}>{dateTime(u.last_seen_at)}</td>
                <td className={`${td} text-right`}>
                  <button className={btn} onClick={() => setOpenId(u.id)}>
                    Gerenciar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.users.length === 0 && <p className="p-4 text-sm text-zinc-500">Nenhum usuário encontrado.</p>}
      </div>
      {data && <p className="text-xs text-zinc-500">{data.total} usuário(s).</p>}
      {open && <UserDrawer user={open} me={me} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

type Detail = {
  ledger: { delta: number; reason: string; created_at: string }[];
  usage: { kind: string; model: string | null; cost_usd: number; credits: number; created_at: string }[];
  payments: { amount_brl: number; description: string; paid_at: string }[];
};

function UserDrawer({ user, me, onClose, onChanged }: { user: UserRow; me: Me; onClose: () => void; onChanged: () => Promise<void> }) {
  const detail = useApi<Detail>(`/api/admin/users/${user.id}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<PlanId>(user.plan);
  const [grantPlanCredits, setGrantPlanCredits] = useState(true);
  const [payment, setPayment] = useState("");
  const [banReason, setBanReason] = useState("");
  const self = user.id === me.id;

  async function act(body: Record<string, unknown>, confirmText?: string): Promise<boolean> {
    if (confirmText && !confirm(confirmText)) return false;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/users/${user.id}`, { method: "POST", json: body });
      await Promise.all([onChanged(), detail.reload()]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Gerenciar ${user.name}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{user.name}</h2>
            <p className="text-sm text-zinc-400">{user.email}</p>
            <p className="mt-1 text-xs text-zinc-500">Desde {date(user.created_at)} · {user.spent_credits} créditos usados</p>
          </div>
          <button className={btn} onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className={card}>
            <div className="text-xs text-zinc-500">Saldo</div>
            <div className="text-lg font-semibold text-amber-300">{user.credits}</div>
          </div>
          <div className={card}>
            <div className="text-xs text-zinc-500">Custo IA</div>
            <div className="text-lg font-semibold text-white">{usd(user.cost_usd)}</div>
          </div>
          <div className={card}>
            <div className="text-xs text-zinc-500">Pago</div>
            <div className="text-lg font-semibold text-white">{brl(user.paid_brl)}</div>
          </div>
        </div>

        <div className="mt-4">
          <ErrorBox message={error} />
        </div>

        <section className="mt-5">
          <h3 className="mb-2 text-sm font-medium text-zinc-200">Dar ou remover créditos</h3>
          <div className="flex gap-2">
            <input className={`${input} w-24`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Quantidade" />
            <input className={`${input} min-w-0 flex-1`} placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button
            className={`${btnPrimary} mt-2`}
            disabled={busy || !Number.isInteger(Number(amount)) || Number(amount) === 0}
            onClick={async () => {
              if (await act({ action: "grant_credits", amount: Number(amount), reason: reason || undefined })) setReason("");
            }}
          >
            {Number(amount) < 0 ? `Remover ${-Number(amount)} créditos` : `Dar ${Number(amount) || 0} créditos`}
          </button>
        </section>

        <section className="mt-5">
          <h3 className="mb-2 text-sm font-medium text-zinc-200">Plano</h3>
          <select className={`${input} w-full`} value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} aria-label="Plano">
            {(Object.keys(PLANS) as PlanId[]).map((p) => (
              <option key={p} value={p}>
                {PLANS[p].name} — {brl(PLANS[p].priceBRL)}/mês · {PLANS[p].monthlyCredits} créditos
              </option>
            ))}
          </select>
          <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={grantPlanCredits} onChange={(e) => setGrantPlanCredits(e.target.checked)} />
            Creditar os {PLANS[plan].monthlyCredits} créditos do plano agora
          </label>
          <input
            className={`${input} mt-2 w-full`}
            type="number"
            min={0}
            step="0.01"
            placeholder="Registrar pagamento recebido (R$, opcional)"
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
          />
          <button
            className={`${btn} mt-2`}
            disabled={busy}
            onClick={async () => {
              const ok = await act({
                action: "set_plan",
                plan,
                grantCredits: grantPlanCredits,
                paymentBRL: payment ? Number(payment) : undefined,
              });
              // Evita lançar o mesmo pagamento duas vezes num segundo clique.
              if (ok) setPayment("");
            }}
          >
            Salvar plano
          </button>
        </section>

        <section className="mt-5">
          <h3 className="mb-2 text-sm font-medium text-zinc-200">Acesso</h3>
          <div className="flex flex-wrap gap-2">
            {user.role === "admin" ? (
              <button
                className={btn}
                disabled={busy || self}
                title={self ? "Você não pode remover o próprio acesso" : undefined}
                onClick={() => void act({ action: "set_role", role: "user" }, `Remover o acesso de admin de ${user.email}?`)}
              >
                Remover admin
              </button>
            ) : (
              <button
                className={btn}
                disabled={busy}
                onClick={() =>
                  void act({ action: "set_role", role: "admin" }, `Tornar ${user.email} administrador? Essa pessoa terá acesso total a este painel.`)
                }
              >
                Tornar admin
              </button>
            )}
          </div>
          {user.banned_at ? (
            <div className="mt-3 rounded-md border border-rose-900/60 p-3">
              <p className="text-xs text-rose-300">
                Suspenso em {dateTime(user.banned_at)}
                {user.ban_reason ? `: ${user.ban_reason}` : ""}
              </p>
              <button className={`${btn} mt-2`} disabled={busy} onClick={() => void act({ action: "unban" })}>
                Reativar conta
              </button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <input
                className={`${input} min-w-0 flex-1`}
                placeholder="Motivo da suspensão (o usuário verá)"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                disabled={self}
              />
              <button
                className={btnDanger}
                disabled={busy || self}
                onClick={() =>
                  void act(
                    { action: "ban", reason: banReason || undefined },
                    `Suspender ${user.email}? As sessões abertas caem na hora e a conta não consegue mais entrar.`,
                  )
                }
              >
                Banir
              </button>
            </div>
          )}
        </section>

        <section className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-zinc-200">Extrato de créditos</h3>
          <ul className="space-y-1 text-xs">
            {detail.data?.ledger.map((l, i) => (
              <li key={i} className="flex justify-between gap-2 text-zinc-400">
                <span className="truncate">
                  {dateTime(l.created_at)} · {l.reason}
                </span>
                <span className={l.delta > 0 ? "text-emerald-400" : "text-zinc-300"}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5">
          <h3 className="mb-2 text-sm font-medium text-zinc-200">Uso de IA</h3>
          {detail.data?.usage.length ? (
            <ul className="space-y-1 text-xs">
              {detail.data.usage.map((u, i) => (
                <li key={i} className="flex justify-between gap-2 text-zinc-400">
                  <span className="truncate">
                    {dateTime(u.created_at)} · {u.kind} {u.model ? `(${u.model})` : ""}
                  </span>
                  <span className="text-zinc-300">{usd(u.cost_usd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">Sem uso ainda.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
