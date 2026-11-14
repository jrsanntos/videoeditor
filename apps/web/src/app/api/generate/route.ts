import { creditCost } from "@videoeditor/core";
import { z } from "zod";
import { assertCredits, charge, recordUsage } from "@/server/billing";
import { generateImage, generateVideo, IMAGE_USD, VIDEO_USD_PER_SECOND } from "@/server/media-gen";
import { rateLimit } from "@/server/ratelimit";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  kind: z.enum(["image", "video"]),
  prompt: z.string().min(8).max(1200),
  aspect: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4"]),
  seconds: z.number().min(2).max(8).optional(),
});

/**
 * Gera uma imagem ou um vídeo curto para inserir na edição (a pedido do
 * usuário, a partir de uma sugestão do Diretor). Cobra só se gerou; devolve o
 * arquivo e o saldo no cabeçalho.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Pedido inválido.");
    const { kind, prompt, aspect, seconds } = parsed.data;
    const credits = kind === "image" ? creditCost({ type: "generative_image", images: 1 }) : creditCost({ type: "generative", clips: 1 });
    await assertCredits(user.id, credits);
    await rateLimit("generateMedia", user.id);
    let out: { data: Buffer; mime: string; model: string };
    let costUSD: number;
    if (kind === "image") {
      out = await generateImage(prompt, aspect);
      costUSD = IMAGE_USD;
    } else {
      const video = await generateVideo(prompt, aspect, seconds ?? 4);
      out = video;
      costUSD = VIDEO_USD_PER_SECOND * video.seconds;
    }
    const charged = user.role === "admin" ? 0 : credits;
    await recordUsage({ userId: user.id, kind: kind === "image" ? "generate_image" : "generate_video", provider: "google", model: out.model, costUSD, credits: charged });
    const balance = charged ? await charge(user.id, charged, kind === "image" ? "imagem gerada por IA" : "vídeo gerado por IA") : null;
    return new Response(new Uint8Array(out.data), { headers: { "content-type": out.mime, "x-credits": String(charged), ...(balance !== null ? { "x-balance": String(balance) } : {}) } });
  } catch (e) {
    return errorResponse(e);
  }
}
