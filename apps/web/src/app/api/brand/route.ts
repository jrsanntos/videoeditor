import { BrandBody, createBrand } from "@/server/brands";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";

/** Cria um Brand Kit, respeitando o limite do plano. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = BrandBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Brand Kit inválido.");
    return Response.json({ saved: await createBrand(user, parsed.data.name, parsed.data.brand) });
  } catch (e) {
    return errorResponse(e);
  }
}
