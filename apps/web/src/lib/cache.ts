"use client";

import type { Asset, AssetAnalysis, Transcript } from "@videoeditor/core";

/**
 * Cache de análise por conteúdo. A chave é o SHA-256 do arquivo de mídia: o
 * mesmo vídeo, enviado de novo (hoje, amanhã, com outro nome), nunca é
 * transcrito nem analisado duas vezes — não gasta tokens nem créditos de novo.
 * Fica num banco próprio do IndexedDB, que sobrevive à troca de projeto.
 */
export type CachedAnalysis = {
  transcript?: Transcript;
  analysis?: AssetAnalysis;
  subject?: NonNullable<Asset["subject"]>;
  /** Quadros pequenos (JPEG base64) que o Diretor de IA vê. */
  frames?: { t: number; data: string }[];
  savedAt: number;
};

const DB = "videoeditor-cache";
const STORE = "analysis";
/** Acima disto o arquivo é grande demais para ler inteiro na memória: o hash usa o tamanho e três trechos. */
const FULL_HASH_LIMIT = 256 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * SHA-256 do arquivo. Até 256 MB, do conteúdo inteiro. Acima disso, do
 * tamanho mais o começo, o meio e o fim (8 MB cada), com o prefixo "s:" — o
 * bastante para identificar o mesmo vídeo sem carregar gigabytes na memória.
 */
export async function fileHash(blob: Blob): Promise<string | null> {
  try {
    if (blob.size <= FULL_HASH_LIMIT) return hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    const mid = Math.floor(blob.size / 2);
    const parts = await Promise.all([blob.slice(0, CHUNK), blob.slice(mid, mid + CHUNK), blob.slice(blob.size - CHUNK)].map((b) => b.arrayBuffer()));
    const sized = new TextEncoder().encode(`size:${blob.size};`);
    const all = new Uint8Array(sized.length + parts.reduce((n, p) => n + p.byteLength, 0));
    all.set(sized, 0);
    let at = sized.length;
    for (const p of parts) {
      all.set(new Uint8Array(p), at);
      at += p.byteLength;
    }
    return `s:${hex(await crypto.subtle.digest("SHA-256", all))}`;
  } catch {
    // Sem crypto.subtle (contexto inseguro) ou sem memória: segue sem cache.
    return null;
  }
}

export async function cacheGet(hash: string | null | undefined): Promise<CachedAnalysis | null> {
  if (!hash) return null;
  try {
    return (await idb<CachedAnalysis | undefined>("readonly", (s) => s.get(hash))) ?? null;
  } catch {
    return null;
  }
}

/** Mescla `patch` ao que já está guardado para este arquivo. */
export async function cachePut(hash: string | null | undefined, patch: Partial<CachedAnalysis>) {
  if (!hash) return;
  try {
    const current = (await cacheGet(hash)) ?? { savedAt: 0 };
    await idb("readwrite", (s) => s.put({ ...current, ...patch, savedAt: Date.now() }, hash));
  } catch {
    // cota cheia ou modo anônimo: a análise vale só para esta sessão
  }
}
