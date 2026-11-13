"use client";

import type { SkillId } from "@videoeditor/core";

/**
 * Vídeo escolhido na página inicial, antes do cadastro. Fica no IndexedDB do
 * navegador (nada sobe para o servidor) até o editor abrir com a conta já
 * criada: aí ele é importado e, se a pessoa escolheu um estilo, a edição
 * automática começa usando os créditos dessa conta.
 */
export type PendingUpload = {
  file: File;
  /** Estilo escolhido; null = abrir no editor e editar por conta própria. */
  style: SkillId | null;
  /** Nome e credencial digitados na prévia: viram a tarja do vídeo e entram no Brand Kit. */
  identity?: { name: string; credential: string };
  savedAt: number;
};

const DB = "videoeditor-pending";
const STORE = "pending";
const KEY = "upload";
/** Um vídeo esquecido não reaparece semanas depois. */
const MAX_AGE_MS = 24 * 3600_000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Guarda o vídeo e o estilo. Devolve false se o navegador não deixou (modo anônimo, cota). */
export async function savePending(file: File, style: SkillId | null, identity?: PendingUpload["identity"]): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put({ file, style, ...(identity ? { identity } : {}), savedAt: Date.now() } satisfies PendingUpload, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function readPending(): Promise<PendingUpload | null> {
  try {
    const p = await run<PendingUpload | undefined>("readonly", (s) => s.get(KEY));
    if (!p?.file) return null;
    if (Date.now() - p.savedAt > MAX_AGE_MS) {
      await clearPending();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export async function clearPending() {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // nada a limpar
  }
}
