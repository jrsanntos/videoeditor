import "server-only";
import Stripe from "stripe";
import { PLANS, TOPUPS, type PlanId } from "@videoeditor/core";
import { grantCredits, resetPlanCredits, revokeCredits } from "./billing";
import { db, tx } from "./db";
import { HttpError } from "./errors";
import { getSettings } from "./settings";
import type { User } from "./users";

/**
 * Cobrança pelo Stripe.
 * - Assinaturas (Creator/Pro): Checkout cria a assinatura; cada fatura paga
 *   (primeira e renovações) repõe os créditos do plano via webhook.
 * - Top-up: pagamento avulso no Checkout; os créditos entram como "extra".
 * - Troca de plano, cartão e cancelamento: Portal do Cliente do Stripe.
 * O banco é atualizado só por webhooks, sempre a partir do estado atual lido
 * da API (a ordem de chegada dos eventos não é garantida) e de forma idempotente.
 */

export type PaidPlan = Exclude<PlanId, "free">;
const TOPUP = TOPUPS[0];
const KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_CREATOR", "STRIPE_PRICE_PRO", "STRIPE_PRICE_TOPUP"] as const;

async function config() {
  const s = await getSettings(KEYS);
  return {
    secretKey: s.STRIPE_SECRET_KEY,
    webhookSecret: s.STRIPE_WEBHOOK_SECRET,
    prices: { creator: s.STRIPE_PRICE_CREATOR, pro: s.STRIPE_PRICE_PRO } as Record<PaidPlan, string | undefined>,
    topupPrice: s.STRIPE_PRICE_TOPUP,
  };
}

function client(secretKey: string | undefined): Stripe {
  if (!secretKey) throw new HttpError(503, "A cobrança ainda não está configurada. Fale com o suporte.");
  // STRIPE_API_BASE só para testes locais contra um servidor falso (ex.: stripe-mock).
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  return new Stripe(secretKey, {
    appInfo: { name: "videoeditor" },
    ...(base && { host: base.hostname, port: Number(base.port) || undefined, protocol: base.protocol === "http:" ? "http" : "https" }),
  });
}

/** O que a tela de planos pode oferecer com a configuração atual. */
export async function billingAvailability() {
  const c = await config();
  return {
    plans: { creator: !!(c.secretKey && c.prices.creator), pro: !!(c.secretKey && c.prices.pro) },
    topup: !!(c.secretKey && c.topupPrice),
  };
}

async function ensureCustomer(stripe: Stripe, user: User): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  // A chave de idempotência evita dois clientes se o usuário clicar duas vezes.
  const customer = await stripe.customers.create(
    { email: user.email, name: user.name, metadata: { user_id: user.id } },
    { idempotencyKey: `customer-${user.id}` },
  );
  await db.run("UPDATE users SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL", [user.id, customer.id]);
  return customer.id;
}

export type CheckoutRequest = { kind: "plan"; plan: PaidPlan } | { kind: "topup" };

/** Cria a sessão do Checkout e devolve a URL para redirecionar o usuário. */
export async function createCheckout(user: User, request: CheckoutRequest, baseUrl: string): Promise<string> {
  const c = await config();
  const stripe = client(c.secretKey);
  const price = request.kind === "plan" ? c.prices[request.plan] : c.topupPrice;
  if (!price) throw new HttpError(503, "Este item ainda não está disponível para compra.");
  if (request.kind === "plan" && user.stripe_subscription_id)
    throw new HttpError(409, "Você já tem uma assinatura. Use “Gerenciar assinatura” para trocar de plano.");

  const customer = await ensureCustomer(stripe, user);
  const metadata: Record<string, string> =
    request.kind === "plan"
      ? { user_id: user.id, kind: "plan", plan: request.plan }
      : { user_id: user.id, kind: "topup", credits: String(TOPUP.credits) };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: request.kind === "plan" ? "subscription" : "payment",
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      // Sem payment_method_types: os meios (cartão, Pix, boleto) são os habilitados no Dashboard.
      metadata,
      ...(request.kind === "plan" && { subscription_data: { metadata: { user_id: user.id } }, allow_promotion_codes: true }),
      locale: "pt-BR",
      success_url: `${baseUrl}/planos?status=sucesso`,
      cancel_url: `${baseUrl}/planos?status=cancelado`,
    });
    if (!session.url) throw new Error("checkout sem url");
    return session.url;
  } catch (e) {
    throw stripeError(e);
  }
}

/** Portal do Cliente: trocar de plano, atualizar cartão, ver faturas, cancelar. */
export async function createPortal(user: User, baseUrl: string): Promise<string> {
  const stripe = client((await config()).secretKey);
  if (!user.stripe_customer_id) throw new HttpError(400, "Você ainda não tem compras para gerenciar.");
  try {
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${baseUrl}/planos` });
    return session.url;
  } catch (e) {
    throw stripeError(e);
  }
}

function stripeError(e: unknown): unknown {
  if (e instanceof Stripe.errors.StripeError) {
    console.error("stripe error", e.type, e.code, e.message);
    return new HttpError(502, "Não foi possível falar com o serviço de pagamentos. Tente de novo em instantes.");
  }
  return e;
}

// ---------- Webhook ----------

/** Confere a assinatura do webhook e devolve o evento. */
export async function parseWebhook(rawBody: string, signature: string | null): Promise<{ stripe: Stripe; event: Stripe.Event }> {
  const c = await config();
  if (!c.webhookSecret) throw new HttpError(503, "Webhook do Stripe não configurado.");
  const stripe = client(c.secretKey);
  try {
    return { stripe, event: await stripe.webhooks.constructEventAsync(rawBody, signature ?? "", c.webhookSecret) };
  } catch {
    throw new HttpError(400, "Assinatura do webhook inválida.");
  }
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));
const brl = (cents: number) => Math.round(cents) / 100;

async function findUser(userId: string | null | undefined, customerId: string | null): Promise<{ id: string } | undefined> {
  if (userId) {
    const byId = await db.one<{ id: string }>("SELECT id FROM users WHERE id = $1", [userId]);
    if (byId) return byId;
  }
  return customerId ? db.one<{ id: string }>("SELECT id FROM users WHERE stripe_customer_id = $1", [customerId]) : undefined;
}

async function recordStripePayment(userId: string, cents: number, currency: string, description: string, ref: string, paidAt: Date) {
  if (cents <= 0) return;
  if (currency !== "brl") console.error(`stripe: cobrança ${ref} em ${currency}; lançada como R$ sem conversão`);
  await db.run(
    `INSERT INTO payments (user_id, amount_brl, description, source, ref, paid_at) VALUES ($1, $2, $3, 'stripe', $4, $5)
     ON CONFLICT (ref) DO NOTHING`,
    [userId, brl(cents), description, ref, paidAt.toISOString()],
  );
}

/** Assinaturas nestes estados dão direito ao plano; em past_due o Stripe ainda está tentando cobrar. */
const ENTITLED = new Set(["active", "trialing", "past_due"]);
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);

/**
 * Espelha no usuário o estado atual da assinatura. Não mexe em créditos, com
 * uma exceção: quando a assinatura termina, a conta volta ao Free.
 */
async function syncSubscription(sub: Stripe.Subscription, prices: Record<PaidPlan, string | undefined>): Promise<string | null> {
  const customerId = idOf(sub.customer);
  const user = await findUser(sub.metadata?.user_id, customerId);
  if (!user) {
    console.error(`stripe: assinatura ${sub.id} sem usuário correspondente (cliente ${customerId})`);
    return null;
  }
  const item = sub.items.data[0];
  const plan = (Object.keys(prices) as PaidPlan[]).find((p) => prices[p] && prices[p] === item?.price.id);

  if (ENTITLED.has(sub.status)) {
    if (!plan) {
      console.error(`stripe: assinatura ${sub.id} usa um preço que não corresponde a nenhum plano configurado (${item?.price.id})`);
      return user.id;
    }
    await db.run(
      `UPDATE users SET plan = $2, stripe_customer_id = COALESCE(stripe_customer_id, $3), stripe_subscription_id = $4,
         subscription_status = $5, subscription_period_end = $6, subscription_cancel_at_period_end = $7
       WHERE id = $1`,
      [
        user.id,
        plan,
        customerId,
        sub.id,
        sub.status,
        item ? new Date(item.current_period_end * 1000).toISOString() : null,
        sub.cancel_at_period_end || sub.cancel_at != null,
      ],
    );
  } else if (ENDED.has(sub.status)) {
    // Só rebaixa se esta ainda é a assinatura da conta (o usuário pode já ter assinado outra).
    const downgraded = await db.run(
      `UPDATE users SET plan = 'free', stripe_subscription_id = NULL, subscription_status = NULL,
         subscription_period_end = NULL, subscription_cancel_at_period_end = false
       WHERE id = $1 AND stripe_subscription_id = $2`,
      [user.id, sub.id],
    );
    if (downgraded) await resetPlanCredits(user.id, "free", new Date(Date.now() + 30 * 86400_000));
  }
  // "incomplete": primeira cobrança pendente; nada muda até pagar ou expirar.
  return user.id;
}

async function onInvoicePaid(invoice: Stripe.Invoice, sub: Stripe.Subscription | null, prices: Record<PaidPlan, string | undefined>) {
  if (!sub || !invoice.id) return;
  const userId = await syncSubscription(sub, prices);
  if (!userId) return;
  const user = await db.one<{ plan: PlanId; stripe_subscription_id: string | null; credits_cycle_grant: number }>(
    "SELECT plan, stripe_subscription_id, credits_cycle_grant FROM users WHERE id = $1 FOR UPDATE",
    [userId],
  );
  if (!user) return;
  const paidAt = new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000);
  await recordStripePayment(userId, invoice.amount_paid, invoice.currency, `Assinatura ${PLANS[user.plan].name}`, invoice.id, paidAt);
  // Só credita se a assinatura continua valendo para a conta (fatura antiga de assinatura já encerrada não credita).
  if (user.stripe_subscription_id !== sub.id || user.plan === "free") return;

  const periodEnd = new Date((sub.items.data[0]?.current_period_end ?? Date.now() / 1000 + 30 * 86400) * 1000);
  if (invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle") {
    // Novo ciclo pago: o saldo do plano volta ao valor mensal.
    await resetPlanCredits(userId, user.plan, periodEnd, { ref: `invoice:${invoice.id}` });
  } else if (invoice.billing_reason === "subscription_update" && invoice.amount_paid > 0) {
    // Upgrade no meio do ciclo, já pago: completa a diferença para o novo plano.
    const diff = PLANS[user.plan].monthlyCredits - user.credits_cycle_grant;
    if (diff > 0 && (await grantCredits(userId, diff, "plan", `upgrade para o plano ${PLANS[user.plan].name}`, { ref: `invoice:${invoice.id}` })))
      await db.run("UPDATE users SET credits_cycle_grant = $2 WHERE id = $1", [userId, PLANS[user.plan].monthlyCredits]);
  }
}

async function onCheckoutPaid(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment" || session.payment_status !== "paid" || session.metadata?.kind !== "topup") return;
  const user = await findUser(session.client_reference_id ?? session.metadata.user_id, idOf(session.customer));
  const credits = Number(session.metadata.credits);
  if (!user || !Number.isInteger(credits) || credits <= 0) {
    console.error(`stripe: top-up ${session.id} sem usuário ou quantidade válida`);
    return;
  }
  // Pix/boleto confirmam depois: o mesmo checkout pode chegar em dois eventos; a ref garante um crédito só.
  await grantCredits(user.id, credits, "extra", `pacote de ${credits} créditos`, { ref: `checkout:${session.id}` });
  await recordStripePayment(user.id, session.amount_total ?? 0, session.currency ?? "brl", `Pacote de ${credits} créditos`, session.id, new Date());
}

/** O que uma cobrança comprou: um pacote avulso (com quantos créditos) ou uma fatura de assinatura. */
type ChargeOrigin = { kind: "topup"; credits: number } | { kind: "subscription" };

/** Descobre a origem de uma cobrança pelo checkout que a gerou. Fora da transação (lê a API do Stripe). */
async function chargeOrigin(stripe: Stripe, paymentIntent: string | null): Promise<ChargeOrigin> {
  if (!paymentIntent) return { kind: "subscription" };
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 1 });
  const session = sessions.data[0];
  const credits = Number(session?.metadata?.credits);
  return session?.mode === "payment" && session.metadata?.kind === "topup" && Number.isInteger(credits) && credits > 0 ? { kind: "topup", credits } : { kind: "subscription" };
}

/**
 * Dinheiro devolvido (estorno) ou contestado no cartão: a receita é abatida no
 * financeiro e os créditos comprados saem do saldo, até onde ainda existirem.
 *
 * - pacote avulso: saem os créditos proporcionais ao valor devolvido;
 * - assinatura: só o estorno TOTAL da fatura zera os créditos do plano no ciclo
 *   (devolução parcial é desconto, não cancelamento). O plano em si segue o
 *   estado da assinatura, que chega pelos eventos customer.subscription.*.
 *
 * `returnedCents` é o total devolvido até agora nesta cobrança: um segundo
 * estorno parcial só tira a diferença.
 */
async function onMoneyReturned(o: { chargeId: string; customerId: string | null; amountCents: number; returnedCents: number; currency: string; origin: ChargeOrigin; why: "estorno" | "contestação" }) {
  const user = await findUser(null, o.customerId);
  if (!user) {
    console.error(`stripe: ${o.why} da cobrança ${o.chargeId} sem usuário correspondente (cliente ${o.customerId})`);
    return;
  }
  if (o.returnedCents <= 0 || o.amountCents <= 0) return;
  const tag = `${o.why === "estorno" ? "refund" : "dispute"}:${o.chargeId}`;
  // Receita: lança só o que ainda não foi abatido desta cobrança.
  const already = (await db.one<{ total: number }>("SELECT COALESCE(SUM(amount_brl), 0) AS total FROM payments WHERE ref LIKE $1", [`%:${o.chargeId}:%`]))?.total ?? 0;
  const pending = brl(o.returnedCents) + already;
  if (pending > 0.004) {
    if (o.currency !== "brl") console.error(`stripe: ${o.why} ${o.chargeId} em ${o.currency}; lançado como R$ sem conversão`);
    await db.run(
      `INSERT INTO payments (user_id, amount_brl, description, source, ref, paid_at) VALUES ($1, $2, $3, 'stripe', $4, now())
       ON CONFLICT (ref) DO NOTHING`,
      [user.id, -pending, `${o.why === "estorno" ? "Estorno" : "Contestação"} (${o.origin.kind === "topup" ? "pacote de créditos" : "assinatura"})`, `${tag}:${o.returnedCents}`],
    );
  }
  const full = o.returnedCents >= o.amountCents;
  if (o.origin.kind === "topup") {
    const owed = Math.floor(((o.origin.credits * Math.min(1, o.returnedCents / o.amountCents)) * 2)) / 2;
    const done = -((await db.one<{ total: number }>("SELECT COALESCE(SUM(delta), 0) AS total FROM credit_ledger WHERE ref LIKE $1", [`%:${o.chargeId}:%`]))?.total ?? 0);
    await revokeCredits(user.id, owed - done, "extra", `${o.why} do pacote de ${o.origin.credits} créditos`, `${tag}:${o.returnedCents}`);
  } else if (full) {
    const plan = (await db.one<{ credits_plan: number }>("SELECT credits_plan FROM users WHERE id = $1", [user.id]))?.credits_plan ?? 0;
    await revokeCredits(user.id, plan, "plan", `${o.why} da assinatura: créditos do ciclo removidos`, `${tag}:${o.returnedCents}`);
  }
  if (o.why === "contestação") console.error(`ALERTA OPERACIONAL: contestação no cartão (cobrança ${o.chargeId}, usuário ${user.id}). Responda no painel do Stripe; os créditos já foram removidos.`);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

/**
 * Processa um evento já autenticado. Lança em caso de falha: a rota responde
 * 500 e o Stripe reenvia. Eventos repetidos são ignorados.
 */
export async function handleStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  const { prices } = await config();

  // Leituras na API do Stripe ficam fora da transação (não seguram conexão nem bloqueios).
  let sub: Stripe.Subscription | null = null;
  const subId =
    event.type === "invoice.paid"
      ? invoiceSubscriptionId(event.data.object)
      : event.type === "checkout.session.completed"
        ? idOf(event.data.object.subscription)
        : event.type.startsWith("customer.subscription.")
          ? (event.data.object as Stripe.Subscription).id
          : null;
  if (subId) sub = await stripe.subscriptions.retrieve(subId);
  // Estorno e contestação: a cobrança e a origem dela também são lidas antes da transação.
  let returned: Parameters<typeof onMoneyReturned>[0] | null = null;
  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    returned = { chargeId: charge.id, customerId: idOf(charge.customer), amountCents: charge.amount, returnedCents: charge.amount_refunded, currency: charge.currency, origin: await chargeOrigin(stripe, idOf(charge.payment_intent)), why: "estorno" };
  } else if (event.type === "charge.dispute.created") {
    const dispute = event.data.object;
    const chargeId = idOf(dispute.charge);
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId);
      // Contestado + o que já tinha sido devolvido antes: o total que saiu desta cobrança.
      returned = { chargeId, customerId: idOf(charge.customer), amountCents: charge.amount, returnedCents: Math.min(charge.amount, charge.amount_refunded + dispute.amount), currency: charge.currency, origin: await chargeOrigin(stripe, idOf(charge.payment_intent)), why: "contestação" };
    }
  }

  await tx(async () => {
    // Trava o evento: uma entrega repetida espera esta transação e depois não insere nada.
    if (!(await db.run("INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [event.id, event.type]))) return;
    switch (event.type) {
      case "invoice.paid":
        await onInvoicePaid(event.data.object, sub, prices);
        break;
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (sub) await syncSubscription(sub, prices);
        await onCheckoutPaid(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        if (sub) await syncSubscription(sub, prices);
        break;
      case "charge.refunded":
      case "charge.dispute.created":
        if (returned) await onMoneyReturned(returned);
        break;
    }
  });
}
