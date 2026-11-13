"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCredits, PLANS, SIGNUP_CREDITS, TOPUPS, videosEstimate, type PlanId } from "@videoeditor/core";

type Me = {
  user: { plan: PlanId; planName?: string };
  credits: number;
  billing: {
    creditsPlan: number;
    creditsExtra: number;
    renewsAt: string;
    subscribed: boolean;
    subscriptionStatus: string | null;
    cancelAtPeriodEnd: boolean;
    hasPurchases: boolean;
    available: { plans: { creator: boolean; pro: boolean }; topup: boolean };
  };
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
const card = "rounded-2xl border border-zinc-800 bg-zinc-950 p-5";
const primary = "w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40";
const secondary = "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40";
const TOPUP = TOPUPS[0];
/** "35 a 50": quantos vídeos curtos um saldo rende, pela tabela de créditos. */
const videos = (credits: number) => {
  const { min, max } = videosEstimate(credits);
  return min === max ? String(max) : `${min} a ${max}`;
};

export function Plans({ status }: { status?: "sucesso" | "cancelado" }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 401) return void (window.location.href = "/login");
    if (res?.ok) setMe((await res.json()) as Me);
    else setError("Não foi possível carregar sua conta. Recarregue a página.");
  }, []);

  useEffect(() => {
    void load();
    if (status !== "sucesso") return;
    // A confirmação chega do Stripe por webhook, alguns segundos depois do retorno.
    const timers = [2000, 5000, 10000].map((ms) => setTimeout(() => void load(), ms));
    return () => timers.forEach(clearTimeout);
  }, [load, status]);

  async function go(key: string, url: string, body?: unknown) {
    setBusy(key);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res?.ok && data?.url) return void (window.location.href = data.url);
    setError(data?.error ?? "Não foi possível conectar. Tente de novo.");
    setBusy(null);
  }

  const b = me?.billing;
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Planos e créditos</h1>
        <a href="/app" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Voltar ao editor
        </a>
      </div>

      {status === "sucesso" && (
        <p className="mt-4 rounded-lg bg-emerald-950/60 px-4 py-3 text-sm text-emerald-300" role="status">
          Pagamento recebido. Seu plano e seus créditos são atualizados em alguns segundos.
        </p>
      )}
      {status === "cancelado" && (
        <p className="mt-4 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-300" role="status">
          Compra cancelada. Nada foi cobrado.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-rose-950/60 px-4 py-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}

      {me && b && (
        <>
          <div className={`${card} mt-6 flex flex-wrap items-center gap-x-8 gap-y-3`}>
            <div>
              <div className="text-xs text-zinc-500">Saldo</div>
              <div className="text-2xl font-semibold text-amber-300" data-testid="plans-credits">
                {formatCredits(me.credits)} <span className="text-sm font-normal text-zinc-400">créditos</span>
              </div>
            </div>
            <div className="text-sm text-zinc-400">
              <div>
                rende cerca de <b className="font-medium text-zinc-200">{videos(me.credits)}</b> vídeos curtos
              </div>
              {me.user.plan !== "free" && (
                <div>
                  <b className="font-medium text-zinc-200">{formatCredits(b.creditsPlan)}</b> do plano {me.user.planName}
                  {b.cancelAtPeriodEnd ? ` · assinatura termina em ${day(b.renewsAt)}` : ` · renovam em ${day(b.renewsAt)}`}
                </div>
              )}
              <div>
                <b className="font-medium text-zinc-200">{formatCredits(b.creditsExtra)}</b> {me.user.plan === "free" ? "de boas-vindas e pacotes, que não expiram" : "extras, que não expiram na renovação"}
              </div>
            </div>
            {b.hasPurchases && (
              <button className={`${secondary} ml-auto`} disabled={!!busy} onClick={() => void go("portal", "/api/billing/portal")}>
                {busy === "portal" ? "Abrindo…" : b.subscribed ? "Gerenciar assinatura" : "Ver faturas"}
              </button>
            )}
          </div>
          {b.subscriptionStatus === "past_due" && (
            <p className="mt-3 rounded-lg bg-amber-950/50 px-4 py-3 text-sm text-amber-300" role="alert">
              Não conseguimos cobrar a renovação. Atualize a forma de pagamento em “Gerenciar assinatura” para não perder o plano.
            </p>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {(Object.keys(PLANS) as PlanId[]).map((id) => {
              const plan = PLANS[id];
              const current = me.user.plan === id;
              return (
                <div key={id} className={`${card} flex flex-col ${current ? "border-zinc-500" : ""}`}>
                  <div className="flex items-center justify-between">
                    <h2 className="font-medium text-white">{plan.name}</h2>
                    {current && <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">seu plano</span>}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {plan.priceBRL ? brl(plan.priceBRL) : "Grátis"}
                    {plan.priceBRL > 0 && <span className="text-sm font-normal text-zinc-500">/mês</span>}
                  </div>
                  <ul className="mt-3 flex-1 space-y-1 text-sm text-zinc-400">
                    <li>
                      <b className="font-medium text-zinc-200">
                        {id === "free" ? `${SIGNUP_CREDITS} créditos de boas-vindas` : `${plan.monthlyCredits.toLocaleString("pt-BR")} créditos por mês`}
                      </b>
                      <span className="block text-xs text-zinc-500">
                        {id === "free"
                          ? `${videos(SIGNUP_CREDITS) === "1" ? "1 vídeo editado pela IA" : `${videos(SIGNUP_CREDITS)} vídeos curtos`} para testar · não renovam`
                          : `cerca de ${videos(plan.monthlyCredits)} ${plan.monthlyCredits >= 2000 ? "vídeos" : "Reels"} por mês`}
                      </span>
                    </li>
                    <li>Vídeos de até {plan.maxUploadMinutes} min</li>
                    <li>Exportação em até {plan.maxExportHeight}p</li>
                    <li>{plan.watermark ? "Com marca d'água" : "Sem marca d'água"}</li>
                    <li>{plan.brandKits === 1 ? "1 Brand Kit salvo" : `Até ${plan.brandKits} Brand Kits (ideal para agências)`}</li>
                  </ul>
                  <div className="mt-4">
                    {id === "free" || current ? null : b.subscribed ? (
                      <button className={primary} disabled={!!busy} onClick={() => void go(id, "/api/billing/portal")}>
                        {busy === id ? "Abrindo…" : "Trocar de plano"}
                      </button>
                    ) : b.available.plans[id] ? (
                      <button className={primary} disabled={!!busy} onClick={() => void go(id, "/api/billing/checkout", { kind: "plan", plan: id })}>
                        {busy === id ? "Abrindo…" : `Assinar ${plan.name}`}
                      </button>
                    ) : (
                      <p className="text-xs text-zinc-500">Em breve.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`${card} mt-4 flex flex-wrap items-center gap-4`}>
            <div className="min-w-0 flex-1">
              <h2 className="font-medium text-white">Pacote de {TOPUP.credits} créditos</h2>
              <p className="mt-1 text-sm text-zinc-400">
                {brl(TOPUP.priceBRL)}, pagamento único: cerca de {videos(TOPUP.credits)} vídeos curtos a mais. Entram como créditos extras e só são usados
                depois dos créditos do plano.
              </p>
            </div>
            {b.available.topup ? (
              <button className={secondary} disabled={!!busy} onClick={() => void go("topup", "/api/billing/checkout", { kind: "topup" })}>
                {busy === "topup" ? "Abrindo…" : "Comprar créditos"}
              </button>
            ) : (
              <p className="text-xs text-zinc-500">Em breve.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
