"use client";

import { create } from "zustand";
import {
  applyOperations,
  projectDuration,
  ProjectSchema,
  type BrandKit,
  type OperationInput,
  type Project,
  type TimeRange,
} from "@videoeditor/core";
import { validateComponent } from "@videoeditor/renderer";

export type SessionUser = { id: string; name: string; email: string; role: "user" | "admin"; plan: string; planName?: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  log?: string[];
  credits?: number;
  error?: boolean;
};

type State = {
  /** Brand Kit salvo na conta: vira o padrão de cada projeto novo. */
  brand: BrandKit | null;
  project: Project | null;
  past: Project[];
  future: Project[];
  time: number;
  playing: boolean;
  selectedClipId: string | null;
  range: TimeRange | null;
  pxPerSec: number;
  /** Saldo do ledger no servidor; atualizado por /api/me e pelas respostas das ações pagas. */
  credits: number;
  user: SessionUser | null;
  chat: ChatMessage[];
  busy: string | null;
  notice: string | null;

  /** history: true empilha o estado atual para desfazer; "keep" troca o projeto sem mexer no histórico (atualizações ao vivo do agente). */
  setProject: (p: Project | null, opts?: { history?: boolean | "keep" }) => void;
  /** Aplica operações (edição manual = 0 créditos). Retorna mensagem de erro ou null. */
  apply: (ops: OperationInput[]) => string | null;
  undo: () => void;
  redo: () => void;
  seek: (t: number) => void;
  setPlaying: (p: boolean) => void;
  select: (clipId: string | null) => void;
  setRange: (r: TimeRange | null) => void;
  setPxPerSec: (n: number) => void;
  setCredits: (n: number) => void;
  pushChat: (m: Omit<ChatMessage, "id">) => void;
  setBusy: (b: string | null) => void;
  setNotice: (n: string | null) => void;
};

const HISTORY_LIMIT = 100;
const PROJECT_KEY = "ve:project";

export const useEditor = create<State>((set, get) => ({
  brand: null,
  project: null,
  past: [],
  future: [],
  time: 0,
  playing: false,
  selectedClipId: null,
  range: null,
  pxPerSec: 60,
  credits: 0,
  user: null,
  chat: [],
  busy: null,
  notice: null,

  setProject: (project, opts) =>
    set((s) => {
      const duration = project ? projectDuration(project) : 0;
      return {
        project,
        past: opts?.history === true && s.project ? [...s.past.slice(-HISTORY_LIMIT), s.project] : opts?.history ? s.past : [],
        future: [],
        time: Math.min(s.time, duration),
        selectedClipId: null,
        range: opts?.history ? null : s.range,
      };
    }),

  apply: (ops) => {
    const { project } = get();
    if (!project) return "Nenhum projeto aberto";
    try {
      const next = applyOperations(project, ops, { validateComponent }).project;
      set((s) => ({
        project: next,
        past: [...s.past.slice(-HISTORY_LIMIT), project],
        future: [],
        time: Math.min(s.time, projectDuration(next)),
        notice: null,
      }));
      return null;
    } catch (e) {
      const message = (e as Error).message;
      set({ notice: message });
      return message;
    }
  },

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev || !s.project) return s;
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], selectedClipId: null };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next || !s.project) return s;
      return { project: next, past: [...s.past, s.project], future: s.future.slice(1), selectedClipId: null };
    }),

  seek: (t) => {
    const p = get().project;
    set({ time: Math.max(0, Math.min(t, p ? projectDuration(p) : 0)) });
  },
  setPlaying: (playing) => set({ playing }),
  select: (selectedClipId) => set({ selectedClipId }),
  setRange: (range) => set({ range }),
  setPxPerSec: (pxPerSec) => set({ pxPerSec }),
  setCredits: (credits) => set({ credits }),
  pushChat: (m) => set((s) => ({ chat: [...s.chat, { ...m, id: crypto.randomUUID() }] })),
  setBusy: (busy) => set({ busy }),
  setNotice: (notice) => set({ notice }),
}));

/** Carrega o projeto salvo e passa a persistir o JSON da edição (leve) no navegador. */
export function hydrateEditor() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) {
      const parsed = ProjectSchema.safeParse(JSON.parse(raw));
      if (parsed.success) useEditor.setState({ project: parsed.data });
    }
  } catch {
    // estado salvo corrompido: começa do zero
  }
  let lastProject = useEditor.getState().project;
  return useEditor.subscribe((s) => {
    try {
      if (s.project !== lastProject) {
        lastProject = s.project;
        if (s.project) localStorage.setItem(PROJECT_KEY, JSON.stringify(s.project));
        else localStorage.removeItem(PROJECT_KEY);
      }
    } catch {
      // cota do localStorage excedida: segue só em memória
    }
  });
}
