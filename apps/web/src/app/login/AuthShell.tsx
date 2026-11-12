"use client";

import { useState } from "react";

export const field =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500";
export const submitBtn = "w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50";
export const link = "text-zinc-200 underline-offset-2 hover:underline";

export function AuthShell({ subtitle, children, footer }: { subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-white">videoeditor</h1>
        <p className="mt-2 text-center text-sm text-zinc-400">{subtitle}</p>
        {children}
        {footer && <p className="mt-4 text-center text-sm text-zinc-500">{footer}</p>}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md bg-rose-950/60 px-3 py-2 text-xs text-rose-300" role="alert">
      {message}
    </p>
  );
}

/** Envia um formulário como JSON e guarda o erro devolvido pela API. */
export function useSubmit(url: string, onOk: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (res?.ok) return onOk();
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    setError(data?.error ?? "Não foi possível conectar. Tente de novo.");
    setBusy(false);
  }
  return { error, busy, submit, setError };
}
