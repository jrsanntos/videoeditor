"use client";

import { useState } from "react";
import { AuthShell, card, ErrorNote, field, link, submitBtn, useSubmit } from "../login/AuthShell";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const { error, busy, submit } = useSubmit("/api/auth/forgot", () => setSent(true));
  const back = (
    <a href="/login" className={link}>
      Voltar para o login
    </a>
  );

  if (sent)
    return (
      <AuthShell subtitle="Confira seu e-mail." footer={back}>
        <p className={`${card} text-sm leading-relaxed text-zinc-300`} role="status">
          Se existe uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora. Não chegou? Veja a caixa de spam.
        </p>
      </AuthShell>
    );

  return (
    <AuthShell subtitle="Informe seu e-mail e enviamos um link para criar uma nova senha." footer={back}>
      <form
        className={card}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        <label className="block text-xs text-zinc-400">
          E-mail
          <input name="email" type="email" required autoComplete="email" className={`${field} mt-1`} />
        </label>
        <ErrorNote message={error} />
        <button type="submit" disabled={busy} className={submitBtn}>
          {busy ? "Aguarde…" : "Enviar link"}
        </button>
      </form>
    </AuthShell>
  );
}
