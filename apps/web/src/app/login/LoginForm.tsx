"use client";

import { useState } from "react";
import { SIGNUP_CREDITS } from "@videoeditor/core";
import { GoogleButton, OrDivider } from "@/components/GoogleButton";
import { Icon } from "@/components/ui";
import { AuthShell, card, ErrorNote, field, link, submitBtn, useSubmit } from "./AuthShell";

export function LoginForm({ notice, warning, initialMode = "login", google = false }: { notice?: string; warning?: string; initialMode?: "login" | "signup"; google?: boolean }) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  /** E-mail aguardando confirmação: mostra a tela "confira sua caixa de entrada". */
  const [pending, setPending] = useState<string | null>(null);
  const { error, code, busy, submit, setError } = useSubmit(mode === "login" ? "/api/auth/login" : "/api/auth/signup", (data) => {
    if (data.verify) setPending(typeof data.email === "string" ? data.email : email);
    else window.location.href = "/app";
  });

  if (pending) return <CheckInbox email={pending} onBack={() => (setPending(null), setMode("login"))} />;

  return (
    <AuthShell
      title={mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}
      subtitle={mode === "login" ? "Entre para editar seus vídeos." : `Ganhe ${SIGNUP_CREDITS} créditos para editar seus primeiros vídeos. Sem cartão.`}
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
            {mode === "login" ? "Criar conta grátis" : "Entrar"}
          </button>
        </>
      }
    >
      <form
        className={card}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        {notice && !error && (
          <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200" role="status">
            {notice}
          </p>
        )}
        {warning && !error && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">
            {warning}
          </p>
        )}
        {google && (
          <>
            <GoogleButton label={mode === "login" ? "Entrar com Google" : "Criar conta com Google"} />
            <OrDivider />
          </>
        )}
        {mode === "signup" && (
          <label className="block text-xs font-medium text-zinc-400">
            Nome
            <input name="name" required autoComplete="name" className={`${field} mt-1.5`} />
          </label>
        )}
        <label className="block text-xs font-medium text-zinc-400">
          E-mail
          <input name="email" type="email" required autoComplete="email" className={`${field} mt-1.5`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-zinc-400">
          Senha
          <input
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={`${field} mt-1.5`}
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
        {code === "email_unverified" && (
          <button type="button" className={`${link} block text-xs`} onClick={() => setPending(email)}>
            Reenviar o e-mail de confirmação
          </button>
        )}
        <button type="submit" disabled={busy} className={submitBtn}>
          {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
        {mode === "signup" && <p className="text-center text-[11px] leading-relaxed text-zinc-500">Enviaremos um link para confirmar seu e-mail antes do primeiro acesso.</p>}
      </form>
    </AuthShell>
  );
}

/** Depois do cadastro: a conta só entra depois de abrir o link enviado por e-mail. */
function CheckInbox({ email, onBack }: { email: string; onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const { error, busy, submit } = useSubmit("/api/auth/resend", () => setSent(true));
  return (
    <AuthShell
      title="Confirme seu e-mail"
      subtitle="Falta um passo para ativar sua conta."
      footer={
        <button className={link} onClick={onBack}>
          Voltar para o login
        </button>
      }
    >
      <div className={`${card} text-center`} role="status" data-testid="check-inbox">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300">
          <Icon.mail size={22} />
        </span>
        <p className="text-sm leading-relaxed text-zinc-300">
          Enviamos um link de confirmação para <b className="font-semibold text-white">{email}</b>. Abra o e-mail e clique em “Confirmar meu e-mail” para entrar.
        </p>
        <p className="text-xs leading-relaxed text-zinc-500">O link vale por 24 horas. Não chegou? Veja a caixa de spam ou peça outro.</p>
        <ErrorNote message={error} />
        {sent && !error && <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">Se a conta ainda está pendente, um novo link foi enviado.</p>}
        <button className="w-full rounded-xl border border-line-strong px-3 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/5 disabled:opacity-50" disabled={busy} onClick={() => void submit({ email })}>
          {busy ? "Enviando…" : "Reenviar o e-mail"}
        </button>
      </div>
    </AuthShell>
  );
}
