"use client";

/**
 * Mídia local. No MVP o arquivo bruto nunca sai do navegador: fica em
 * IndexedDB e é lido por object URL. Só o áudio comprimido (16 kHz mono)
 * sobe para transcrição.
 */

const DB = "videoeditor";
const STORE = "media";
const urls = new Map<string, { blob: Blob; url: string }>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeMedia(assetId: string, blob: Blob) {
  urls.set(assetId, { blob, url: URL.createObjectURL(blob) });
  try {
    await idb("readwrite", (s) => s.put(blob, assetId));
  } catch {
    // sem persistência (modo anônimo/cota): o vídeo vale só para esta sessão
  }
}

/** Garante que os assets do projeto estão carregados; retorna os ids ausentes. */
export async function loadMedia(assetIds: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const id of assetIds) {
    if (urls.has(id)) continue;
    try {
      const blob = await idb<Blob | undefined>("readonly", (s) => s.get(id));
      if (blob) urls.set(id, { blob, url: URL.createObjectURL(blob) });
      else missing.push(id);
    } catch {
      missing.push(id);
    }
  }
  return missing;
}

export async function clearMedia() {
  for (const { url } of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  try {
    await idb("readwrite", (s) => s.clear());
  } catch {
    // nada a limpar
  }
}

export const mediaUrl = (assetId: string) => urls.get(assetId)?.url ?? null;
export const mediaBlob = (assetId: string) => urls.get(assetId)?.blob ?? null;

export function probeVideo(file: Blob): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = () => URL.revokeObjectURL(url);
    v.onloadedmetadata = () => {
      const meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      done();
      if (!Number.isFinite(meta.duration) || !meta.width)
        reject(new Error("Não foi possível ler este vídeo. Tente um MP4 (H.264) ou WebM."));
      else resolve(meta);
    };
    v.onerror = () => {
      done();
      reject(new Error("Formato de vídeo não suportado por este navegador."));
    };
    v.src = url;
  });
}

/** Erro de formato que deve chegar ao usuário como está (não é falha interna). */
class FormatError extends Error {}

/**
 * Confere se ESTE navegador consegue decodificar o vídeo antes de começar:
 * o caso comum é o HEVC (H.265) do iPhone, que o <video> às vezes abre (lê a
 * duração) mas não desenha nem exporta. Sem essa conferência a pessoa só
 * descobre na hora de exportar. Formatos que o leitor não reconhece passam:
 * quem decide é o próprio <video>.
 */
export async function assertDecodable(file: Blob): Promise<void> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new FormatError("Este arquivo não tem imagem de vídeo.");
      if (await track.canDecode()) return;
      const codec = track.codec;
      throw new FormatError(
        codec === "hevc"
          ? "Este vídeo está em HEVC (H.265), o formato de alta eficiência do iPhone, e este navegador não consegue lê-lo. Abra no Chrome ou Edge atualizados num computador com suporte a HEVC, ou envie uma versão em H.264. No iPhone, para os próximos vídeos: Ajustes › Câmera › Formatos › Mais Compatível."
          : `Este navegador não consegue ler o vídeo (codec ${codec ?? "desconhecido"}). Envie um MP4 em H.264 ou abra no Chrome atualizado.`,
      );
    } finally {
      input.dispose();
    }
  } catch (e) {
    if (e instanceof FormatError) throw e;
    // Container que o leitor não conhece: segue para o <video>.
  }
}

const monoCache = new Map<string, Promise<Float32Array>>();
export const SPEECH_RATE = 16000;

/** Decodifica o áudio de qualquer arquivo de vídeo em mono 16 kHz. */
export async function decodeBlobMono(blob: Blob): Promise<Float32Array> {
  const ac = new AudioContext();
  try {
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SPEECH_RATE), SPEECH_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } catch {
    throw new Error("Este vídeo não tem uma faixa de áudio legível.");
  } finally {
    void ac.close();
  }
}

/** Amostra `count` quadros espaçados do vídeo como JPEG (largura máx. `maxWidth`). */
export async function sampleFrames(file: Blob, count: number, maxWidth = 768): Promise<{ t: number; image: Blob }[]> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("Formato de vídeo não suportado por este navegador."));
    });
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    const out: { t: number; image: Blob }[] = [];
    for (let i = 0; i < count; i++) {
      // Centro de cada fatia: evita o primeiro quadro preto e o último.
      const t = ((i + 0.5) / count) * v.duration;
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = t;
      });
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const image = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao capturar quadro."))), "image/jpeg", 0.8),
      );
      out.push({ t: Math.round(t * 100) / 100, image });
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Áudio do asset em mono 16 kHz — base para detecção de silêncio local e transcrição. */
export function decodeMono(assetId: string): Promise<Float32Array> {
  let p = monoCache.get(assetId);
  if (!p) {
    p = (async () => {
      const blob = mediaBlob(assetId);
      if (!blob) throw new Error("Arquivo de mídia não encontrado. Envie o vídeo novamente.");
      return decodeBlobMono(blob);
    })();
    monoCache.set(assetId, p);
    p.catch(() => monoCache.delete(assetId));
  }
  return p;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/**
 * Áudio da fala comprimido para envio: Opus mono a 32 kbps em WebM
 * (~0,24 MB por minuto; 10 min ≈ 2,4 MB, contra ~19 MB em WAV). Cabe com folga
 * nos limites de corpo de requisição de hosts serverless. Se o navegador não
 * codifica Opus, cai para WAV.
 */
export async function encodeSpeech(samples: Float32Array, sampleRate: number): Promise<{ blob: Blob; filename: string }> {
  try {
    const { AudioBufferSource, BufferTarget, getFirstEncodableAudioCodec, Output, WebMOutputFormat } = await import("mediabunny");
    const codec = await getFirstEncodableAudioCodec(["opus"], { numberOfChannels: 1, sampleRate, bitrate: SPEECH_BITRATE });
    if (!codec) throw new Error("opus indisponível");
    const buffer = new AudioBuffer({ length: samples.length, sampleRate, numberOfChannels: 1 });
    buffer.getChannelData(0).set(samples);
    const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
    const source = new AudioBufferSource({ codec, bitrate: SPEECH_BITRATE });
    output.addAudioTrack(source);
    await output.start();
    await source.add(buffer);
    source.close();
    await output.finalize();
    if (!output.target.buffer) throw new Error("codificação vazia");
    return { blob: new Blob([output.target.buffer], { type: "audio/webm" }), filename: "audio.webm" };
  } catch (e) {
    console.warn("compressão de áudio indisponível; enviando WAV", e);
    return { blob: encodeWav(samples, sampleRate), filename: "audio.wav" };
  }
}
const SPEECH_BITRATE = 32_000;
