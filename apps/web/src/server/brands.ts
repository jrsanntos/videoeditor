import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { BrandKitSchema, PLANS, type BrandKit } from "@videoeditor/core";
import { db, tx } from "./db";
import { HttpError } from "./errors";
import type { User } from "./users";

/**
 * Brand Kits salvos na conta. O primeiro (mais antigo) é o padrão dos vídeos
 * novos. O limite vem do plano: 1 para quem edita os próprios vídeos, 10 no
 * Pro para quem atende vários clientes.
 */
export const BrandBody = z.object({ name: z.string().trim().min(1, "Dê um nome ao Brand Kit.").max(40), brand: BrandKitSchema });

export type SavedBrand = { id: string; name: string; brand: BrandKit };
type Row = { id: string; name: string; data: unknown };

const toSaved = (r: Row): SavedBrand => ({ id: r.id, name: r.name, brand: BrandKitSchema.parse(r.data) });

export async function listBrands(userId: string): Promise<SavedBrand[]> {
  return (await db.query<Row>("SELECT id, name, data FROM brand_kits WHERE user_id = $1 ORDER BY created_at, id", [userId])).map(toSaved);
}

export async function createBrand(user: User, name: string, brand: BrandKit): Promise<SavedBrand> {
  const limit = PLANS[user.plan].brandKits;
  return tx(async () => {
    // Bloqueia a conta: duas criações simultâneas não passam do limite.
    await db.one("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [user.id]);
    const count = (await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM brand_kits WHERE user_id = $1", [user.id]))?.n ?? 0;
    if (count >= limit)
      throw new HttpError(
        403,
        limit < PLANS.pro.brandKits
          ? `Seu plano salva ${limit} Brand Kit. No plano ${PLANS.pro.name} são até ${PLANS.pro.brandKits}, um para cada cliente.`
          : `Você chegou ao limite de ${limit} Brand Kits.`,
      );
    const row = await db.one<Row>("INSERT INTO brand_kits (id, user_id, name, data) VALUES ($1, $2, $3, $4) RETURNING id, name, data", [
      `brd_${crypto.randomUUID()}`,
      user.id,
      name,
      JSON.stringify(brand),
    ]);
    return toSaved(row!);
  });
}

export async function updateBrand(userId: string, id: string, name: string, brand: BrandKit): Promise<SavedBrand> {
  const row = await db.one<Row>(
    "UPDATE brand_kits SET name = $3, data = $4, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id, name, data",
    [id, userId, name, JSON.stringify(brand)],
  );
  if (!row) throw new HttpError(404, "Brand Kit não encontrado.");
  return toSaved(row);
}

export async function deleteBrand(userId: string, id: string) {
  if (!(await db.run("DELETE FROM brand_kits WHERE id = $1 AND user_id = $2", [id, userId]))) throw new HttpError(404, "Brand Kit não encontrado.");
}
