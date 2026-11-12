"use client";

import { useState } from "react";
import { Logo } from "@/components/ui";

export const field =
  "w-full rounded-xl border border-line bg-ink-900 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/15";
export const submitBtn = "btn-brand w-full rounded-xl px-3 py-2.5 text-sm font-semibold";
export const link = "font-medium text-brand-300 underline-offset-2 hover:underline";
export const card = "mt-7 space-y-3.5 rounded-2xl border border-line bg-ink-850/80 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur";

export function AuthShell({ title, subtitle, children, footer }: { title?: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="stage-bg flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <a href="/" className="flex justify-center" aria-label="Página inicial">
          <Logo size={32} />
        </a>
        {title && <h1 className="mt-7 text-center text-2xl font-semibold tracking-tight text-white">{title}</h1>}
        <p className={`${title ? "mt-2" : "mt-6"} text-center text-sm leading-relaxed text-zinc-400`}>{subtitle}</p>
        {children}
        {footer && <p className="mt-5 text-center text-sm text-zinc-500">{footer}</p>}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">
      {message}
    </p>
  );
}

type ApiResult = { error?: string; code?: string } & Record<string, unknown>;

/** Envia um formulário como JSON e guarda o erro devolvido pela API. */
export function useSubmit(url: string, onOk: (data: ApiResult) => void) {
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setCode(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) as ApiResult | null) ?? {};
    setBusy(false);
    if (res?.ok) return onOk(data);
    setError(data.error ?? "Não foi possível conectar. Tente de novo.");
    setCode(data.code ?? null);
  }
  return { error, code, busy, submit, setError };
}
