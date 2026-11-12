import { overview } from "@/server/admin";
import { errorResponse, requireAdmin } from "@/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(overview());
  } catch (e) {
    return errorResponse(e);
  }
}
