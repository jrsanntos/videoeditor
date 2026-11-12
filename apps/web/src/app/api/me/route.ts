import { PLANS } from "@videoeditor/core";
import { balance } from "@/server/billing";
import { errorResponse, requireUser } from "@/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, planName: PLANS[user.plan]?.name },
      credits: balance(user.id),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
