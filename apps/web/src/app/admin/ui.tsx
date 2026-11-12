"use client";

import { useCallback, useEffect, useState } from "react";

export const card = "rounded-xl border border-zinc-800 bg-zinc-950 p-4";
export const input =
  "rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500";
export const btn =
  "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40";
export const btnPrimary = "rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40";
export const btnDanger = "rounded-md border border-rose-900 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-950 disabled:opacity-40";
export const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
export const td = "px-3 py-2 text-sm text-zinc-300";

const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
export const brl = (n: number) => brlFmt.format(n);
export const usd = (n: number) => usdFmt.format(n);
export const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

/** fetch JSON que lança com a mensagem de erro do servidor. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) window.location.href = "/login";
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  return data;
}

/** Carrega `url` e expõe recarregar; erros viram texto. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className={card}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-rose-400" : "text-white"}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-md bg-rose-950/60 px-3 py-2 text-sm text-rose-300" role="alert">{message}</p>;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "info" }) {
  const cls = {
    neutral: "bg-zinc-800 text-zinc-300",
    good: "bg-emerald-950 text-emerald-300",
    bad: "bg-rose-950 text-rose-300",
    info: "bg-indigo-950 text-indigo-300",
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}
