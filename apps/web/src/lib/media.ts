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

const monoCache = new Map<string, Promise<Float32Array>>();
export const SPEECH_RATE = 16000;

/** Áudio do asset em mono 16 kHz — base para detecção de silêncio local e transcrição. */
export function decodeMono(assetId: string): Promise<Float32Array> {
  let p = monoCache.get(assetId);
  if (!p) {
    p = (async () => {
      const blob = mediaBlob(assetId);
      if (!blob) throw new Error("Arquivo de mídia não encontrado. Envie o vídeo novamente.");
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
