import { rateLimit } from "@/server/ratelimit";
import { STOCK_HOSTS } from "@/server/stock";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 120 * 1024 * 1024;

/**
 * Entrega ao navegador um arquivo dos bancos gratuitos. Passa pelo servidor
 * porque o navegador não pode ler esses arquivos de outro domínio; só os
 * hosts dos bancos são aceitos, então a rota não serve de proxy aberto.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const raw = new URL(req.url).searchParams.get("url") ?? "";
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new HttpError(400, "Endereço inválido.");
    }
    if (target.protocol !== "https:" || !STOCK_HOSTS.has(target.hostname)) throw new HttpError(400, "Este arquivo não vem de um banco de mídia aceito.");
    await rateLimit("stockDownload", user.id);
    // redirect manual: um redirecionamento não pode levar a busca para fora dos hosts aceitos.
    let res = await fetch(target, { redirect: "manual", signal: req.signal });
    for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400; hop++) {
      const next = new URL(res.headers.get("location") ?? "", target);
      if (next.protocol !== "https:" || !STOCK_HOSTS.has(next.hostname)) throw new HttpError(502, "O banco de mídia redirecionou para um endereço não aceito.");
      res = await fetch(next, { redirect: "manual", signal: req.signal });
    }
    if (!res.ok || !res.body) throw new HttpError(502, "Não foi possível baixar este arquivo do banco de mídia.");
    const type = res.headers.get("content-type") ?? "";
    if (!/^(video|image)\//.test(type)) throw new HttpError(502, "O banco de mídia devolveu um arquivo inesperado.");
    const length = Number(res.headers.get("content-length"));
    if (length > MAX_BYTES) throw new HttpError(413, "Este arquivo é grande demais. Escolha outro resultado.");
    return new Response(res.body, { headers: { "content-type": type, ...(length ? { "content-length": String(length) } : {}), "cache-control": "private, max-age=3600" } });
  } catch (e) {
    return errorResponse(e);
  }
}
