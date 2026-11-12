"use client";

import { AuthShell, ErrorNote, field, link, submitBtn, useSubmit } from "../login/AuthShell";

export function ResetForm({ token }: { token: string }) {
  const { error, busy, submit, setError } = useSubmit("/api/auth/reset", () => {
    window.location.href = "/login?senha=redefinida";
  });
  const again = (
    <a href="/recuperar-senha" className={link}>
      Pedir um novo link
    </a>
  );

  if (!token)
    return (
      <AuthShell subtitle="Este link de redefinição está incompleto." footer={again}>
        <span />
      </AuthShell>
    );

  return (
    <AuthShell subtitle="Crie uma nova senha para a sua conta." footer={again}>
      <form
        className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          if (form.get("password") !== form.get("confirm")) return setError("As senhas não são iguais.");
          void submit({ token, password: form.get("password") });
        }}
      >
        <label className="block text-xs text-zinc-400">
          Nova senha
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs text-zinc-400">
          Repita a nova senha
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={`${field} mt-1`} />
        </label>
        <ErrorNote message={error} />
        <button type="submit" disabled={busy} className={submitBtn}>
          {busy ? "Aguarde…" : "Salvar nova senha"}
        </button>
      </form>
    </AuthShell>
  );
}
