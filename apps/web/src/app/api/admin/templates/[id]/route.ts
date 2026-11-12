import { z } from "zod";
import { EditTemplateSchema } from "@videoeditor/core";
import { deleteTemplate, updateTemplate } from "@/server/templates";
import { errorResponse, HttpError, logAdmin, requireAdmin } from "@/server/users";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({ status: z.enum(["draft", "published"]).optional(), data: EditTemplateSchema.optional() });

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const admin = await requireAdmin();
    const parsed = Patch.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
    const { id } = await params;
    const template = await updateTemplate(id, parsed.data);
    await logAdmin(admin.id, parsed.data.status ? `template_${parsed.data.status}` : "edit_template", id);
    return Response.json({ template });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    await deleteTemplate(id);
    await logAdmin(admin.id, "delete_template", id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
