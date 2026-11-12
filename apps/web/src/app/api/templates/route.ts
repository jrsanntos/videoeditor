import { listTemplates } from "@/server/templates";
import { errorResponse, requireUser } from "@/server/users";

export const runtime = "nodejs";

/** Modelos publicados, para todos os usuários no editor. */
export async function GET() {
  try {
    await requireUser();
    return Response.json({ templates: listTemplates({ publishedOnly: true }) });
  } catch (e) {
    return errorResponse(e);
  }
}
