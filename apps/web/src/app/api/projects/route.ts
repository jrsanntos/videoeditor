import { listProjects } from "@/server/projects";
import { errorResponse, requireUser } from "@/server/users";

export const runtime = "nodejs";

/** Projetos salvos na conta, do mais recente para o mais antigo. */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ projects: await listProjects(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
