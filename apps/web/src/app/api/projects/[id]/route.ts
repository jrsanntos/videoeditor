import { deleteProject, getProject, MAX_PROJECT_BYTES, saveProject } from "@/server/projects";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    return Response.json({ project: await getProject(user.id, (await params).id) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Salva (cria ou atualiza) o JSON da edição. Chamado pelo salvamento automático do editor. */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const text = await req.text();
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_PROJECT_BYTES) throw new HttpError(413, "Este projeto ficou grande demais para salvar na conta.");
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "Projeto inválido.");
    }
    return Response.json({ saved: await saveProject(user.id, (await params).id, body, bytes) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    await deleteProject(user.id, (await params).id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
