import { PLANS } from "@videoeditor/core";
import { listBrands } from "@/server/brands";
import { billingAvailability } from "@/server/stripe";
import { errorResponse, requireUser } from "@/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({
      brands: await listBrands(user.id),
      brandLimit: PLANS[user.plan].brandKits,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, planName: PLANS[user.plan]?.name },
      credits: user.credits_plan + user.credits_extra,
      // Só administradores: usam sem consumir créditos.
      unlimited: user.role === "admin",
      billing: {
        creditsPlan: user.credits_plan,
        creditsExtra: user.credits_extra,
        renewsAt: user.credits_renew_at,
        subscribed: !!user.stripe_subscription_id,
        subscriptionStatus: user.subscription_status,
        cancelAtPeriodEnd: user.subscription_cancel_at_period_end,
        hasPurchases: !!user.stripe_customer_id,
        available: await billingAvailability(),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
