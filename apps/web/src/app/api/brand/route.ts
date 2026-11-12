import { BrandKitSchema } from "@videoeditor/core";
import { db } from "@/server/db";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";

/** Salva o Brand Kit da conta: o padrão de todo vídeo novo do usuário. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const parsed = BrandKitSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Brand Kit inválido.");
    await db.run("UPDATE users SET brand_kit = $2 WHERE id = $1", [user.id, JSON.stringify(parsed.data)]);
    return Response.json({ brand: parsed.data });
  } catch (e) {
    return errorResponse(e);
  }
}
