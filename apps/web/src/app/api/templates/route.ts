import { builtinTemplates, listTemplates } from "@/server/templates";
import { errorResponse, requireUser } from "@/server/users";

export const runtime = "nodejs";

/** Modelos publicados, para todos os usuários no editor. */
export async function GET() {
  try {
    await requireUser();
    // Os modelos da casa vêm primeiro; se o banco falhar, eles continuam disponíveis.
    const published = await listTemplates({ publishedOnly: true }).catch(() => []);
    return Response.json({ templates: [...builtinTemplates(), ...published] });
  } catch (e) {
    return errorResponse(e);
  }
}
