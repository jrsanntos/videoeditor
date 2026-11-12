"use client";

import { useState } from "react";

const field =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500";

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (res?.ok) {
      window.location.href = "/";
      return;
    }
    setError(data?.error ?? "Não foi possível conectar. Tente de novo.");
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-white">videoeditor</h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          {mode === "login" ? "Entre para editar seus vídeos." : "Crie sua conta e ganhe 30 créditos para começar."}
        </p>
        <form
          className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(new FormData(e.currentTarget));
          }}
        >
          {mode === "signup" && (
            <label className="block text-xs text-zinc-400">
              Nome
              <input name="name" required autoComplete="name" className={`${field} mt-1`} />
            </label>
          )}
          <label className="block text-xs text-zinc-400">
            E-mail
            <input name="email" type="email" required autoComplete="email" className={`${field} mt-1`} />
          </label>
          <label className="block text-xs text-zinc-400">
            Senha
            <input
              name="password"
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={`${field} mt-1`}
            />
          </label>
          {error && <p className="rounded-md bg-rose-950/60 px-3 py-2 text-xs text-rose-300" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
          >
            {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          {mode === "login" ? "Ainda não tem conta? " : "Já tem conta? "}
          <button
            className="text-zinc-200 underline-offset-2 hover:underline"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Criar conta" : "Entrar"}
          </button>
        </p>
      </div>
    </div>
  );
}
