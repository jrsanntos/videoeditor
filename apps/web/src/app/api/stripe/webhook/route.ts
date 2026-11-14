import { errorResponse } from "@/server/errors";
import { handleStripeEvent, parseWebhook } from "@/server/stripe";

export const runtime = "nodejs";

/**
 * Webhook do Stripe. Eventos usados: checkout.session.completed,
 * checkout.session.async_payment_succeeded, invoice.paid,
 * customer.subscription.created/updated/deleted, charge.refunded e
 * charge.dispute.created (ligue todos no endpoint do webhook no Stripe). Qualquer falha responde 5xx
 * para o Stripe reenviar; o processamento é idempotente.
 */
export async function POST(req: Request) {
  try {
    // A assinatura é calculada sobre o corpo bruto: não pode passar por JSON.parse antes.
    const { stripe, event } = await parseWebhook(await req.text(), req.headers.get("stripe-signature"));
    await handleStripeEvent(stripe, event);
    return Response.json({ received: true });
  } catch (e) {
    return errorResponse(e);
  }
}
