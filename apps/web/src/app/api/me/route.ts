import { BrandKitSchema, PLANS } from "@videoeditor/core";
import { db } from "@/server/db";
import { billingAvailability } from "@/server/stripe";
import { errorResponse, requireUser } from "@/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const row = await db.one<{ brand_kit: unknown }>("SELECT brand_kit FROM users WHERE id = $1", [user.id]);
    const brand = BrandKitSchema.safeParse(row?.brand_kit);
    return Response.json({
      brand: row?.brand_kit && brand.success ? brand.data : null,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, planName: PLANS[user.plan]?.name },
      credits: user.credits_plan + user.credits_extra,
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
