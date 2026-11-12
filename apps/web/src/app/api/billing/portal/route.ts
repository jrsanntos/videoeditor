import { appUrl } from "@/server/email";
import { createPortal } from "@/server/stripe";
import { errorResponse, requireUser } from "@/server/users";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    return Response.json({ url: await createPortal(user, appUrl(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
