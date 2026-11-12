import { endSession } from "@/server/users";

export const runtime = "nodejs";

export async function POST() {
  await endSession();
  return Response.json({ ok: true });
}
