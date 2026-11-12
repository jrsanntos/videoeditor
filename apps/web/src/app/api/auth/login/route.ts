import { z } from "zod";
import { errorResponse, HttpError, startSession, verifyLogin } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().max(200), password: z.string().max(200) });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Informe e-mail e senha.");
    const user = verifyLogin(parsed.data.email, parsed.data.password);
    await startSession(user.id);
    return Response.json({ ok: true, admin: user.role === "admin" });
  } catch (e) {
    return errorResponse(e);
  }
}
