import { z } from "zod";
import { deleteFinanceEntry, financeSummary, recordExpense, recordPayment } from "@/server/admin";
import { errorResponse, findUserIdByEmail, HttpError, logAdmin, requireAdmin } from "@/server/users";

export const runtime = "nodejs";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const today = new Date();
    const from = url.searchParams.get("from") ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const to = url.searchParams.get("to") ?? today.toISOString().slice(0, 10);
    if (!isoDay.safeParse(from).success || !isoDay.safeParse(to).success) throw new HttpError(400, "Período inválido.");
    // `to` é inclusivo para quem usa o painel.
    const end = new Date(`${to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return Response.json({ from, to, ...(await financeSummary(`${from}T00:00:00.000Z`, end.toISOString())) });
  } catch (e) {
    return errorResponse(e);
  }
}

const Entry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("payment"),
    amountBRL: z.number().positive().max(10_000_000),
    description: z.string().trim().min(1).max(200),
    userEmail: z.string().max(200).optional(),
    date: isoDay,
  }),
  z.object({
    kind: z.literal("expense"),
    amountBRL: z.number().positive().max(10_000_000),
    description: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(60),
    date: isoDay,
  }),
]);

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = Entry.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Lançamento inválido.");
    const e = parsed.data;
    const at = `${e.date}T12:00:00.000Z`;
    if (e.kind === "payment") {
      let userId: string | null = null;
      if (e.userEmail?.trim()) {
        userId = await findUserIdByEmail(e.userEmail);
        if (!userId) throw new HttpError(404, "Nenhum usuário com este e-mail.");
      }
      await recordPayment(admin.id, { userId, amountBRL: e.amountBRL, description: e.description, paidAt: at });
    } else {
      await recordExpense(admin.id, { category: e.category, description: e.description, amountBRL: e.amountBRL, spentAt: at });
    }
    await logAdmin(admin.id, `add_${e.kind}`, undefined, e);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const id = Number(url.searchParams.get("id"));
    if ((kind !== "payment" && kind !== "expense") || !Number.isInteger(id)) throw new HttpError(400, "Lançamento inválido.");
    await deleteFinanceEntry(admin.id, kind, id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
