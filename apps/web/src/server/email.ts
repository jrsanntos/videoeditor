import "server-only";
import { getSettings } from "./settings";

/**
 * Envio de e-mails transacionais pela API do Resend (uma chamada HTTP, sem
 * dependência). Trocar de provedor é local a este arquivo.
 * Sem RESEND_API_KEY: em desenvolvimento o e-mail é impresso no terminal; em
 * produção nada é enviado e o erro fica no log.
 */
export async function sendEmail(msg: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  const cfg = await getSettings(["RESEND_API_KEY", "EMAIL_FROM"]);
  if (!cfg.RESEND_API_KEY || !cfg.EMAIL_FROM) {
    if (process.env.NODE_ENV === "production") console.error("e-mail não enviado: configure RESEND_API_KEY e EMAIL_FROM");
    else console.log(`\n[e-mail não enviado: RESEND_API_KEY/EMAIL_FROM ausentes]\nPara: ${msg.to}\nAssunto: ${msg.subject}\n\n${msg.text}\n`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e: unknown) => {
    console.error("e-mail: falha de rede", e);
    return null;
  });
  if (!res) return false;
  if (!res.ok) console.error("e-mail: provedor recusou", res.status, await res.text().catch(() => ""));
  return res.ok;
}

/** Há provedor de e-mail configurado (painel ou ambiente)? */
export async function emailConfigured(): Promise<boolean> {
  const cfg = await getSettings(["RESEND_API_KEY", "EMAIL_FROM"]);
  return Boolean(cfg.RESEND_API_KEY && cfg.EMAIL_FROM);
}

/**
 * O cadastro exige confirmar o e-mail?
 * EMAIL_VERIFICATION=required força (sem provedor de e-mail o cadastro é recusado, com aviso);
 * =off desliga; sem a variável, vale sempre que há provedor de e-mail configurado.
 */
export async function verificationRequired(): Promise<boolean> {
  const mode = process.env.EMAIL_VERIFICATION?.trim().toLowerCase();
  if (mode === "off") return false;
  if (mode === "required") return true;
  const configured = await emailConfigured();
  if (!configured && process.env.NODE_ENV === "production")
    console.error("cadastro SEM confirmação de e-mail: configure RESEND_API_KEY e EMAIL_FROM (painel /admin ou ambiente) para ativá-la");
  return configured;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function passwordResetEmail(name: string, link: string, minutes: number) {
  const text = `Olá, ${name}.\n\nRecebemos um pedido para redefinir a senha da sua conta no videoeditor. Abra o link abaixo para criar uma nova senha (vale por ${minutes} minutos e só pode ser usado uma vez):\n\n${link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18181b;max-width:480px">
<p>Olá, ${escapeHtml(name)}.</p>
<p>Recebemos um pedido para redefinir a senha da sua conta no videoeditor.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Criar nova senha</a></p>
<p style="color:#52525b;font-size:13px">O link vale por ${minutes} minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
</div>`;
  return { subject: "Redefinir sua senha — videoeditor", text, html };
}

export function verifyEmailMessage(name: string, link: string, hours: number) {
  const text = `Olá, ${name}.\n\nFalta um passo para ativar sua conta no videoeditor: confirme seu e-mail abrindo o link abaixo (vale por ${hours} horas):\n\n${link}\n\nSe você não criou esta conta, ignore este e-mail.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18181b;max-width:480px">
<p>Olá, ${escapeHtml(name)}.</p>
<p>Falta um passo para ativar sua conta no videoeditor: confirme que este e-mail é seu.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#6548f0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600">Confirmar meu e-mail</a></p>
<p style="color:#52525b;font-size:13px">O link vale por ${hours} horas. Se você não criou esta conta, ignore este e-mail.</p>
</div>`;
  return { subject: "Confirme seu e-mail — videoeditor", text, html };
}

/**
 * Endereço público da aplicação, usado nos links de e-mail e nos retornos do
 * Stripe. Em produção vem só de APP_URL: montar links a partir do cabeçalho
 * Host da requisição deixaria um atacante apontar o link de redefinição para o
 * próprio domínio.
 */
export function appUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL não definida: obrigatória em produção.");
  return new URL(req.url).origin;
}
