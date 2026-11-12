"use client";

import { useState } from "react";
import { AuthShell, ErrorNote, field, link, submitBtn, useSubmit } from "./AuthShell";

export function LoginForm({ notice }: { notice?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const { error, busy, submit, setError } = useSubmit(mode === "login" ? "/api/auth/login" : "/api/auth/signup", () => {
    window.location.href = "/";
  });

  return (
    <AuthShell
      subtitle={mode === "login" ? "Entre para editar seus vídeos." : "Crie sua conta e ganhe 30 créditos para começar."}
      footer={
        <>
          {mode === "login" ? "Ainda não tem conta? " : "Já tem conta? "}
          <button
            className={link}
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Criar conta" : "Entrar"}
          </button>
        </>
      }
    >
      <form
        className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        {notice && !error && (
          <p className="rounded-md bg-emerald-950/60 px-3 py-2 text-xs text-emerald-300" role="status">
            {notice}
          </p>
        )}
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
        {mode === "login" && (
          <p className="text-right text-xs">
            <a href="/recuperar-senha" className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline">
              Esqueci minha senha
            </a>
          </p>
        )}
        <ErrorNote message={error} />
        <button type="submit" disabled={busy} className={submitBtn}>
          {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>
    </AuthShell>
  );
}
