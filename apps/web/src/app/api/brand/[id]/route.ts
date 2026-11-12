import { BrandBody, deleteBrand, updateBrand } from "@/server/brands";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const parsed = BrandBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Brand Kit inválido.");
    return Response.json({ saved: await updateBrand(user.id, (await params).id, parsed.data.name, parsed.data.brand) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    await deleteBrand(user.id, (await params).id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
