import { z } from "zod";
import { applyUserAction, userDetail } from "@/server/admin";
import { errorResponse, HttpError, requireAdmin } from "@/server/users";

export const runtime = "nodejs";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ban"), reason: z.string().max(200).optional() }),
  z.object({ action: z.literal("unban") }),
  z.object({
    action: z.literal("grant_credits"),
    amount: z.number().int().min(-100000).max(100000),
    reason: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("set_plan"),
    plan: z.enum(["free", "creator", "pro"]),
    grantCredits: z.boolean().default(false),
    paymentBRL: z.number().min(0).max(1_000_000).optional(),
  }),
  z.object({ action: z.literal("set_role"), role: z.enum(["user", "admin"]) }),
]);

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    return Response.json(await userDetail((await params).id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const admin = await requireAdmin();
    const parsed = Action.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Ação inválida.");
    const user = await applyUserAction(admin, (await params).id, parsed.data);
    return Response.json({ user });
  } catch (e) {
    return errorResponse(e);
  }
}
