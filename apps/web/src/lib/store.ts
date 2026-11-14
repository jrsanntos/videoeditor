"use client";

import { create } from "zustand";
import {
  applyOperations,
  projectDuration,
  ProjectSchema,
  type BrandKit,
  type OperationInput,
  type Project,
  type SkillId,
  type TimeRange,
} from "@videoeditor/core";
import { validateComponent, validateSfx } from "@videoeditor/renderer";

export type SavedBrand = { id: string; name: string; brand: BrandKit };

export type SessionUser = { id: string; name: string; email: string; role: "user" | "admin"; plan: string; planName?: string };

/** Plano do Diretor: o vídeo em atos (gancho, desenvolvimento, clímax, fecho). */
export type EditPlan = {
  resumo: string;
  diagnostico: string;
  cortes: string;
  estilo: { look: string; musica: string; legenda: string | null };
  capitulos: { ato: "gancho" | "desenvolvimento" | "climax" | "fecho"; titulo: string; energia: string; velocidade: string; tratamento: string; zooms: number; componentes: number; sons: number }[];
  midias?: MediaSuggestion[];
};

/** Imagem ou vídeo que o Diretor sugere gerar por IA num ponto da fala. O usuário decide. */
export type MediaSuggestion = { atWord: string; tipo: "imagem" | "video"; descricao: string; motivo: string; duracao: number };

/** Um pedido de edição completa esperando a confirmação do plano no chat. */
export type PendingPlan = { token: string; message: string; skill?: string; frames: { t: number; data: string }[] };

/** Tamanho dos painéis do editor, em pixels. */
export type Layout = { left: number; right: number; bottom: number };
export const DEFAULT_LAYOUT: Layout = { left: 344, right: 344, bottom: 300 };
const LAYOUT_LIMITS: Record<keyof Layout, [number, number]> = { left: [290, 520], right: [280, 560], bottom: [170, 620] };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Plano de edição do agente (diagnóstico + mapa de ritmo). */
  plan?: EditPlan;
  /** Plano aguardando o "sim" do usuário; some quando ele confirma, ajusta ou descarta. */
  pending?: PendingPlan;
  log?: string[];
  credits?: number;
  error?: boolean;
  /** Sugestão de mídia gerada por IA, com o estado da decisão do usuário. */
  media?: MediaSuggestion & { status: "idle" | "busy" | "done" | "dismissed"; note?: string };
};

type State = {
  /** Brand Kits salvos na conta; o primeiro é o padrão de cada projeto novo. */
  brands: SavedBrand[];
  /** Quantos Brand Kits o plano permite salvar. */
  brandLimit: number;
  project: Project | null;
  past: Project[];
  future: Project[];
  time: number;
  playing: boolean;
  selectedClipId: string | null;
  /** Legenda selecionada: os ids das palavras que a formam. */
  selectedCaption: string[] | null;
  range: TimeRange | null;
  pxPerSec: number;
  layout: Layout;
  /**
   * Assistente de edição automática, aberto a cada vídeo enviado:
   * choose = escolher o estilo; working = a IA está editando; done = vídeo pronto.
   */
  assistant: "choose" | "working" | "done" | null;
  /** Estilo já escolhido (na página inicial): o assistente abre com ele marcado. */
  assistantPick: SkillId | null;
  /** Passo atual do guia inicial; null = fechado. */
  tour: number | null;
  /** Muda a cada vez que um trecho é enviado da timeline ao Diretor de IA (dispara o efeito visual). */
  aiFocus: number;
  /** Saldo do ledger no servidor; atualizado por /api/me e pelas respostas das ações pagas. */
  credits: number;
  /** Conta de administrador: usa a plataforma sem consumir créditos. */
  unlimited: boolean;
  user: SessionUser | null;
  chat: ChatMessage[];
  busy: string | null;
  /** Mostra as áreas seguras por cima do preview (nunca entra na exportação). */
  guides: boolean;
  notice: string | null;
  /** Registro da última edição manual aplicada (ex.: "encaixado na lacuna", "ajustado à lacuna"). */
  lastLog: string[];

  /** history: true empilha o estado atual para desfazer; "keep" troca o projeto sem mexer no histórico (atualizações ao vivo do agente). */
  setProject: (p: Project | null, opts?: { history?: boolean | "keep" }) => void;
  /** Aplica operações (edição manual = 0 créditos). Retorna mensagem de erro ou null. */
  apply: (ops: OperationInput[]) => string | null;
  undo: () => void;
  redo: () => void;
  seek: (t: number) => void;
  setPlaying: (p: boolean) => void;
  select: (clipId: string | null) => void;
  selectCaption: (wordIds: string[] | null) => void;
  resize: (panel: keyof Layout, deltaPx: number) => void;
  resetLayout: (panel: keyof Layout) => void;
  setTour: (step: number | null) => void;
  /** Leva o trecho selecionado ao Diretor de IA. */
  focusAI: () => void;
  setRange: (r: TimeRange | null) => void;
  setPxPerSec: (n: number) => void;
  setCredits: (n: number) => void;
  pushChat: (m: Omit<ChatMessage, "id">) => void;
  patchChat: (id: string, patch: Partial<ChatMessage>) => void;
  /** Tira o pedido pendente de uma mensagem de plano (confirmado ou descartado). */
  resolvePlan: (id: string) => void;
  setBusy: (b: string | null) => void;
  setNotice: (n: string | null) => void;
};

const HISTORY_LIMIT = 100;
const PROJECT_KEY = "ve:project";
const LAYOUT_KEY = "ve:layout";
export const TOUR_KEY = "ve:tour-done";

const clampLayout = (panel: keyof Layout, v: number) => Math.round(Math.min(LAYOUT_LIMITS[panel][1], Math.max(LAYOUT_LIMITS[panel][0], v)));
const saveLayout = (layout: Layout) => {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // sem armazenamento: o tamanho vale só para esta sessão
  }
};

export const useEditor = create<State>((set, get) => ({
  brands: [],
  brandLimit: 1,
  project: null,
  past: [],
  future: [],
  time: 0,
  playing: false,
  selectedClipId: null,
  selectedCaption: null,
  range: null,
  pxPerSec: 60,
  layout: DEFAULT_LAYOUT,
  assistant: null,
  assistantPick: null,
  tour: null,
  aiFocus: 0,
  credits: 0,
  unlimited: false,
  user: null,
  chat: [],
  busy: null,
  guides: false,
  notice: null,
  lastLog: [],

  setProject: (project, opts) =>
    set((s) => {
      const duration = project ? projectDuration(project) : 0;
      return {
        project,
        past: opts?.history === true && s.project ? [...s.past.slice(-HISTORY_LIMIT), s.project] : opts?.history ? s.past : [],
        future: [],
        time: Math.min(s.time, duration),
        selectedClipId: null,
        selectedCaption: null,
        range: opts?.history ? null : s.range,
      };
    }),

  apply: (ops) => {
    const { project } = get();
    if (!project) return "Nenhum projeto aberto";
    try {
      const result = applyOperations(project, ops, { validateComponent, validateSfx });
      const next = result.project;
      set((s) => ({
        lastLog: result.log,
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
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], selectedClipId: null, selectedCaption: null, time: Math.min(s.time, projectDuration(prev)) };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next || !s.project) return s;
      return { project: next, past: [...s.past, s.project], future: s.future.slice(1), selectedClipId: null, selectedCaption: null, time: Math.min(s.time, projectDuration(next)) };
    }),

  seek: (t) => {
    const p = get().project;
    set({ time: Math.max(0, Math.min(t, p ? projectDuration(p) : 0)) });
  },
  setPlaying: (playing) => set({ playing }),
  select: (selectedClipId) => set({ selectedClipId, selectedCaption: null }),
  selectCaption: (selectedCaption) => set({ selectedCaption, selectedClipId: null }),
  resize: (panel, delta) =>
    set((s) => {
      const layout = { ...s.layout, [panel]: clampLayout(panel, s.layout[panel] + delta) };
      saveLayout(layout);
      return { layout };
    }),
  resetLayout: (panel) =>
    set((s) => {
      const layout = { ...s.layout, [panel]: DEFAULT_LAYOUT[panel] };
      saveLayout(layout);
      return { layout };
    }),
  setTour: (tour) => {
    if (tour === null) {
      try {
        localStorage.setItem(TOUR_KEY, "1");
      } catch {
        // segue sem lembrar
      }
    }
    set({ tour });
  },
  focusAI: () => set((s) => ({ aiFocus: s.aiFocus + 1 })),
  setRange: (range) => set({ range }),
  setPxPerSec: (pxPerSec) => set({ pxPerSec }),
  setCredits: (credits) => set({ credits }),
  pushChat: (m) => set((s) => ({ chat: [...s.chat, { ...m, id: crypto.randomUUID() }] })),
  patchChat: (id, patch) => set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  resolvePlan: (id) => set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, pending: undefined } : m)) })),
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
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    if (saved)
      useEditor.setState({
        layout: {
          left: clampLayout("left", Number(saved.left) || DEFAULT_LAYOUT.left),
          right: clampLayout("right", Number(saved.right) || DEFAULT_LAYOUT.right),
          bottom: clampLayout("bottom", Number(saved.bottom) || DEFAULT_LAYOUT.bottom),
        },
      });
  } catch {
    // layout salvo inválido: usa o padrão
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
