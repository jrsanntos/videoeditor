import { z } from "zod";
import { extractTemplate, listTemplates } from "@/server/templates";
import { errorResponse, HttpError, logAdmin, requireAdmin } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FRAMES = 16;

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ templates: await listTemplates() });
  } catch (e) {
    return errorResponse(e);
  }
}

const Meta = z.object({
  name: z.string().min(1).max(200),
  duration: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameTimes: z.array(z.number().min(0)).min(1).max(MAX_FRAMES),
  pauses: z.object({ count: z.number().int().min(0), total: z.number().min(0), longest: z.number().min(0) }),
});

/** Recebe quadros + áudio extraídos no navegador e cria um modelo em rascunho. */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const form = await req.formData().catch(() => null);
    let rawMeta: unknown = null;
    try {
      rawMeta = JSON.parse(String(form?.get("meta") ?? "null"));
    } catch {
      throw new HttpError(400, "Metadados inválidos.");
    }
    const meta = Meta.safeParse(rawMeta);
    const audio = form?.get("audio");
    const frames = form?.getAll("frames") ?? [];
    if (!meta.success || !(audio instanceof Blob)) throw new HttpError(400, "Envio incompleto.");
    if (frames.length !== meta.data.frameTimes.length || frames.some((f) => !(f instanceof Blob)))
      throw new HttpError(400, "Quadros inválidos.");
    const template = await extractTemplate(
      {
        sourceName: meta.data.name,
        duration: meta.data.duration,
        width: meta.data.width,
        height: meta.data.height,
        audio,
        frames: (frames as Blob[]).map((image, i) => ({ t: meta.data.frameTimes[i]!, image })),
        pauses: meta.data.pauses,
      },
      admin.id,
    );
    await logAdmin(admin.id, "extract_template", template.id, { source: meta.data.name });
    return Response.json({ template });
  } catch (e) {
    return errorResponse(e);
  }
}
