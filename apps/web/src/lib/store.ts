"use client";

import { create } from "zustand";
import {
  applyOperations,
  projectDuration,
  ProjectSchema,
  type OperationInput,
  type Project,
  type TimeRange,
} from "@videoeditor/core";
import { validateComponent } from "@videoeditor/renderer";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  log?: string[];
  credits?: number;
  error?: boolean;
};

type State = {
  project: Project | null;
  past: Project[];
  future: Project[];
  time: number;
  playing: boolean;
  selectedClipId: string | null;
  range: TimeRange | null;
  pxPerSec: number;
  /** Carteira de demonstração (local). Será substituída pelo ledger do backend. */
  credits: number;
  chat: ChatMessage[];
  busy: string | null;
  notice: string | null;

  setProject: (p: Project | null, opts?: { history?: boolean }) => void;
  /** Aplica operações (edição manual = 0 créditos). Retorna mensagem de erro ou null. */
  apply: (ops: OperationInput[]) => string | null;
  undo: () => void;
  redo: () => void;
  seek: (t: number) => void;
  setPlaying: (p: boolean) => void;
  select: (clipId: string | null) => void;
  setRange: (r: TimeRange | null) => void;
  setPxPerSec: (n: number) => void;
  spend: (n: number) => void;
  pushChat: (m: Omit<ChatMessage, "id">) => void;
  setBusy: (b: string | null) => void;
  setNotice: (n: string | null) => void;
};

const HISTORY_LIMIT = 100;
const PROJECT_KEY = "ve:project";
const CREDITS_KEY = "ve:credits";

export const useEditor = create<State>((set, get) => ({
  project: null,
  past: [],
  future: [],
  time: 0,
  playing: false,
  selectedClipId: null,
  range: null,
  pxPerSec: 60,
  credits: 30,
  chat: [],
  busy: null,
  notice: null,

  setProject: (project, opts) =>
    set((s) => {
      const duration = project ? projectDuration(project) : 0;
      return {
        project,
        past: opts?.history && s.project ? [...s.past.slice(-HISTORY_LIMIT), s.project] : opts?.history ? s.past : [],
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
  spend: (n) => set((s) => ({ credits: Math.max(0, s.credits - n) })),
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
    const credits = Number(localStorage.getItem(CREDITS_KEY));
    if (localStorage.getItem(CREDITS_KEY) !== null && Number.isFinite(credits)) useEditor.setState({ credits });
  } catch {
    // estado salvo corrompido: começa do zero
  }
  let lastProject = useEditor.getState().project;
  let lastCredits = useEditor.getState().credits;
  return useEditor.subscribe((s) => {
    try {
      if (s.project !== lastProject) {
        lastProject = s.project;
        if (s.project) localStorage.setItem(PROJECT_KEY, JSON.stringify(s.project));
        else localStorage.removeItem(PROJECT_KEY);
      }
      if (s.credits !== lastCredits) {
        lastCredits = s.credits;
        localStorage.setItem(CREDITS_KEY, String(s.credits));
      }
    } catch {
      // cota do localStorage excedida: segue só em memória
    }
  });
}
