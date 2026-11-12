import { z } from "zod";
import { describeSettings, isSettingKey, setSetting } from "@/server/settings";
import { errorResponse, HttpError, logAdmin, requireAdmin } from "@/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ settings: await describeSettings() });
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({ key: z.string(), value: z.string().max(500).nullable() });

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !isSettingKey(parsed.data.key)) throw new HttpError(400, "Configuração inválida.");
    const { key, value } = parsed.data;
    if (key === "USD_BRL" && value !== null && !(Number(value) > 0)) throw new HttpError(400, "Cotação inválida.");
    await setSetting(key, value, admin.id);
    // Nunca registra o valor de um segredo no log.
    await logAdmin(admin.id, value ? "set_setting" : "clear_setting", key);
    return Response.json({ settings: await describeSettings() });
  } catch (e) {
    return errorResponse(e);
  }
}
