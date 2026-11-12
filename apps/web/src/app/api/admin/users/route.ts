import { listUsers } from "@/server/admin";
import { errorResponse, requireAdmin } from "@/server/users";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter");
    return Response.json(
      listUsers({
        q: url.searchParams.get("q")?.trim() || undefined,
        filter: filter === "banned" || filter === "admins" ? filter : "all",
        limit: Math.min(200, Number(url.searchParams.get("limit")) || 50),
        offset: Math.max(0, Number(url.searchParams.get("offset")) || 0),
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
