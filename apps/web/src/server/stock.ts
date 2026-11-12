import "server-only";
import { getSettings } from "./settings";
import { HttpError } from "./errors";

/**
 * Bancos gratuitos de mídia de contexto: Pexels e Pixabay. Os dois liberam uso
 * comercial sem atribuição obrigatória; mesmo assim o crédito do autor
 * acompanha cada resultado e fica guardado no projeto.
 *
 * As chaves ficam no servidor: o navegador fala só com estas rotas.
 */
export type StockItem = {
  id: string;
  provider: "pexels" | "pixabay";
  kind: "video" | "image";
  /** Miniatura para a grade de resultados. */
  thumb: string;
  /** Arquivo a baixar (vídeo em HD moderado, ou a foto em tamanho grande). */
  url: string;
  width: number;
  height: number;
  duration: number;
  author: string;
  /** Página do item no banco, para o crédito. */
  page: string;
};

/** Hosts de onde a rota de download aceita buscar arquivos. */
export const STOCK_HOSTS = new Set(["videos.pexels.com", "images.pexels.com", "cdn.pixabay.com", "pixabay.com"]);

const get = async <T>(url: string, headers: Record<string, string> = {}): Promise<T | null> => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) }).catch(() => null);
  if (!res?.ok) {
    if (res) console.error("stock: provedor recusou", new URL(url).host, res.status);
    return null;
  }
  return (await res.json().catch(() => null)) as T | null;
};

type PexelsVideo = { id: number; width: number; height: number; duration: number; url: string; image: string; user?: { name?: string }; video_files: { link: string; width: number | null; height: number | null; file_type: string }[] };
type PexelsPhoto = { id: number; width: number; height: number; url: string; photographer?: string; src: { large2x: string; medium: string } };
type PixabayVideo = { id: number; pageURL: string; duration: number; user: string; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> };
type PixabayPhoto = { id: number; pageURL: string; user: string; webformatURL: string; largeImageURL: string; imageWidth: number; imageHeight: number };

/** Entre os arquivos de um vídeo, o MP4 mais próximo de 1080 no lado menor: nítido sem pesar o navegador. */
function pickFile<T extends { width: number | null; height: number | null }>(files: T[]): T | undefined {
  const sized = files.filter((f) => f.width && f.height);
  const score = (f: T) => Math.abs(Math.min(f.width!, f.height!) - 1080);
  return sized.sort((a, b) => score(a) - score(b))[0];
}

async function pexels(key: string, q: string, kind: "video" | "image", orientation: string): Promise<StockItem[]> {
  const params = `query=${encodeURIComponent(q)}&per_page=12&orientation=${orientation}&locale=pt-BR`;
  const headers = { authorization: key };
  if (kind === "image") {
    const data = await get<{ photos: PexelsPhoto[] }>(`https://api.pexels.com/v1/search?${params}`, headers);
    return (data?.photos ?? []).map((p) => ({ id: `pexels-i${p.id}`, provider: "pexels", kind: "image", thumb: p.src.medium, url: p.src.large2x, width: p.width, height: p.height, duration: 0, author: p.photographer ?? "", page: p.url }));
  }
  const data = await get<{ videos: PexelsVideo[] }>(`https://api.pexels.com/videos/search?${params}`, headers);
  return (data?.videos ?? []).flatMap((v): StockItem[] => {
    const file = pickFile(v.video_files.filter((f) => f.file_type === "video/mp4"));
    return file ? [{ id: `pexels-v${v.id}`, provider: "pexels", kind: "video", thumb: v.image, url: file.link, width: file.width!, height: file.height!, duration: v.duration, author: v.user?.name ?? "", page: v.url }] : [];
  });
}

async function pixabay(key: string, q: string, kind: "video" | "image", orientation: string): Promise<StockItem[]> {
  const params = `key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=12&lang=pt&safesearch=true`;
  if (kind === "image") {
    const data = await get<{ hits: PixabayPhoto[] }>(`https://pixabay.com/api/?${params}&image_type=photo&orientation=${orientation === "portrait" ? "vertical" : "horizontal"}`);
    return (data?.hits ?? []).map((p) => ({ id: `pixabay-i${p.id}`, provider: "pixabay", kind: "image", thumb: p.webformatURL, url: p.largeImageURL, width: p.imageWidth, height: p.imageHeight, duration: 0, author: p.user, page: p.pageURL }));
  }
  const data = await get<{ hits: PixabayVideo[] }>(`https://pixabay.com/api/videos/?${params}`);
  return (data?.hits ?? []).flatMap((v): StockItem[] => {
    const file = pickFile(Object.values(v.videos).filter((f) => f.url));
    return file ? [{ id: `pixabay-v${v.id}`, provider: "pixabay", kind: "video", thumb: file.thumbnail ?? v.videos.tiny?.thumbnail ?? "", url: file.url, width: file.width, height: file.height, duration: v.duration, author: v.user, page: v.pageURL }] : [];
  });
}

export async function stockProviders(): Promise<{ pexels: boolean; pixabay: boolean }> {
  const cfg = await getSettings(["PEXELS_API_KEY", "PIXABAY_API_KEY"]);
  return { pexels: !!cfg.PEXELS_API_KEY, pixabay: !!cfg.PIXABAY_API_KEY };
}

/** Busca nos bancos configurados e intercala os resultados (um de cada por vez). */
export async function searchStock(q: string, kind: "video" | "image", orientation: "portrait" | "landscape"): Promise<StockItem[]> {
  const cfg = await getSettings(["PEXELS_API_KEY", "PIXABAY_API_KEY"]);
  if (!cfg.PEXELS_API_KEY && !cfg.PIXABAY_API_KEY)
    throw new HttpError(503, "A busca em bancos gratuitos ainda não está configurada. Você pode enviar seus próprios vídeos e imagens.");
  const [a, b] = await Promise.all([
    cfg.PEXELS_API_KEY ? pexels(cfg.PEXELS_API_KEY, q, kind, orientation) : [],
    cfg.PIXABAY_API_KEY ? pixabay(cfg.PIXABAY_API_KEY, q, kind, orientation) : [],
  ]);
  const out: StockItem[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]!);
    if (b[i]) out.push(b[i]!);
  }
  return out;
}
