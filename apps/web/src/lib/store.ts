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
  /** A edição parou antes de terminar o plano (teto de custo ou de etapas): foi cobrada pela metade. */
  interrupted?: boolean;
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
  /** Salvamento do projeto na conta: saving = enviando; saved = guardado; error = só neste navegador por enquanto. */
  sync: "idle" | "saving" | "saved" | "error";
  /** Arquivos usados na timeline que não estão neste navegador (projeto aberto em outro aparelho): precisam ser religados. */
  missingMedia: string[];

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
/** De quem é o projeto guardado neste navegador: outra conta que entre aqui não o herda. */
const OWNER_KEY = "ve:project-owner";
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
  sync: "idle",
  missingMedia: [],

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
  // Projeto que só existia neste navegador (antes do salvamento na conta): sobe agora.
  if (lastProject) scheduleSave();
  return useEditor.subscribe((s) => {
    if (s.project === lastProject) return;
    lastProject = s.project;
    try {
      if (s.project) localStorage.setItem(PROJECT_KEY, JSON.stringify(s.project));
      else localStorage.removeItem(PROJECT_KEY);
    } catch {
      // cota do localStorage excedida: segue só em memória
    }
    if (s.project) scheduleSave();
  });
}

/**
 * Salvamento automático na conta. O JSON da edição sobe alguns segundos depois
 * da última mudança (arrastar um texto ou a IA montando a timeline gera dezenas
 * de estados: só o último importa). Uma falha não trava nada: o projeto segue
 * salvo neste navegador e a próxima mudança tenta de novo.
 */
const SAVE_DELAY_MS = 2500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let savedProject: Project | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY_MS);
}

/** Salva já o projeto aberto (se mudou desde o último salvamento) e espera terminar. */
export async function saveNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  // Um salvamento por vez: o seguinte leva o estado mais novo.
  if (saving) await saving;
  const { project, user } = useEditor.getState();
  if (!project || project === savedProject) return;
  // A conta ainda não carregou: sem saber de quem é o projeto, não sobe nada. Tenta de novo em seguida.
  if (!user) return scheduleSave();
  useEditor.setState({ sync: "saving" });
  saving = (async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(project) });
      if (!res.ok) throw new Error(String(res.status));
      savedProject = project;
      try {
        localStorage.setItem(OWNER_KEY, user.id);
      } catch {
        // sem armazenamento: nada a marcar
      }
      // Mudou enquanto salvava: o estado mostrado continua "salvando" até o próximo envio.
      if (useEditor.getState().project === project) useEditor.setState({ sync: "saved" });
    } catch {
      useEditor.setState({ sync: "error" });
    } finally {
      saving = null;
    }
  })();
  await saving;
}

/**
 * Chamado quando a conta carrega: se o projeto guardado neste navegador é de
 * OUTRA conta (alguém saiu e outra pessoa entrou), ele é descartado daqui, sem
 * ser mostrado nem salvo na conta errada. Continua salvo na conta de quem o fez.
 */
export function dropForeignProject(userId: string) {
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(OWNER_KEY);
  } catch {
    return;
  }
  if (!owner || owner === userId || !useEditor.getState().project) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  savedProject = null;
  useEditor.setState({ chat: [], missingMedia: [], sync: "idle", assistant: null });
  useEditor.getState().setProject(null);
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // nada a limpar
  }
}

/** Marca um projeto recém-aberto da conta como já salvo (abrir não é uma mudança). */
export function markSaved(project: Project | null) {
  savedProject = project;
  useEditor.setState({ sync: project ? "saved" : "idle" });
}
