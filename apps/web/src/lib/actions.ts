"use client";

import {
  addAssetToProject,
  addContextAsset,
  agentTier,
  createProject,
  creditCost,
  mainClips,
  newId,
  PLANS,
  silencesFromAudio,
  SKILLS,
  skillPrompt,
  timelineWords,
  sourceRangesToTimeline,
  templateOperations,
  templatePrompt,
  type Asset,
  type BrandKit,
  type OperationInput,
  type PlanId,
  type SkillId,
  type EditTemplate,
  type Project,
  type Transcript,
} from "@videoeditor/core";
import { analyzeVideo, wordEnergy, type VideoAnalysis } from "./analysis";
import { clearBroll } from "./broll";
import { clearMedia, decodeMono, encodeSpeech, mediaBlob, probeVideo, SPEECH_RATE, storeMedia } from "./media";
import { TOUR_KEY, useEditor, type EditPlan, type SavedBrand, type SessionUser } from "./store";

// Análise visual por asset: roda em segundo plano logo após o envio do vídeo.
const analyses = new Map<string, Promise<VideoAnalysis | null>>();

/**
 * Mede onde o apresentador está no quadro e separa alguns quadros para o
 * agente ver o vídeo. Roda no navegador; o resultado entra no projeto sem
 * criar ponto de desfazer.
 */
export function analyzeAsset(assetId: string): Promise<VideoAnalysis | null> {
  let p = analyses.get(assetId);
  if (!p) {
    p = (async () => {
      const blob = mediaBlob(assetId);
      if (!blob) return null;
      try {
        const result = await analyzeVideo(blob, assetId);
        const current = useEditor.getState().project;
        if (result.subject.length && current?.assets[assetId] && !current.assets[assetId]!.subject) {
          const next = structuredClone(current);
          next.assets[assetId]!.subject = result.subject;
          useEditor.setState({ project: next });
        }
        return result;
      } catch (e) {
        console.warn("análise do vídeo indisponível", e);
        return null;
      }
    })();
    analyses.set(assetId, p);
  }
  return p;
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Ingestão: lê metadados localmente e cria o projeto. Nada sobe para o servidor. */
export async function importVideo(file: File) {
  const { setBusy, setProject, setNotice } = useEditor.getState();
  setBusy("Lendo o vídeo…");
  try {
    const meta = await probeVideo(file);
    const plan = PLANS[(useEditor.getState().user?.plan ?? "free") as PlanId] ?? PLANS.free;
    if (meta.duration > plan.maxUploadMinutes * 60 + 1)
      throw new Error(`Seu plano aceita vídeos de até ${plan.maxUploadMinutes} minutos (este tem ${Math.ceil(meta.duration / 60)}). Corte o vídeo ou veja os planos.`);
    const asset: Asset = {
      id: newId("asset"),
      kind: "video",
      name: file.name,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      hasAudio: true,
    };
    await clearMedia();
    clearBroll();
    thumbs.clear();
    await storeMedia(asset.id, file);
    const project = createProject({
      name: file.name.replace(/\.[^.]+$/, ""),
      // Vertical 9:16 é o padrão; o vídeo de origem preenche o quadro e pode ser reenquadrado.
      aspectRatio: "9:16",
      brand: useEditor.getState().brands[0]?.brand,
    });
    useEditor.setState({ chat: [], time: 0, range: null });
    setProject(addAssetToProject(project, asset));
    void analyzeAsset(asset.id);
    // Primeiro vídeo: o guia aponta por onde começar.
    let seen = false;
    try {
      seen = localStorage.getItem(TOUR_KEY) === "1";
    } catch {
      // sem armazenamento: mostra o guia
    }
    if (!seen) useEditor.getState().setTour(0);
  } catch (e) {
    setNotice((e as Error).message);
  } finally {
    setBusy(null);
  }
}

const hasTranscript = (project: Project) => Object.values(project.assets).some((a) => a.transcript?.words.length);

function primaryAssetId(project: Project): string | null {
  return mainClips(project)[0]?.assetId ?? Object.keys(project.assets)[0] ?? null;
}

/** Remove silêncios analisando o áudio no próprio navegador: 0 créditos, 0 nuvem. */
export async function removeSilencesLocally() {
  const { project, setBusy, setNotice, apply } = useEditor.getState();
  if (!project) return;
  const assetId = primaryAssetId(project);
  if (!assetId) return;
  setBusy("Analisando o áudio no seu navegador…");
  try {
    const samples = await decodeMono(assetId);
    const ranges = sourceRangesToTimeline(
      useEditor.getState().project!,
      assetId,
      silencesFromAudio(samples, SPEECH_RATE, { minSilence: 0.5, padding: 0.12 }),
    );
    if (!ranges.length) setNotice("Nenhum silêncio com mais de 0,5s encontrado.");
    else if (!apply([{ op: "remove_ranges", ranges }])) {
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      setNotice(`${ranges.length} silêncios removidos (${total.toFixed(1)}s a menos). Ctrl+Z desfaz.`);
    }
  } catch (e) {
    setNotice((e as Error).message);
  } finally {
    setBusy(null);
  }
}

/**
 * Envia só o áudio leve (16 kHz mono) para transcrição com timestamps por
 * palavra e mede a energia da voz em cada uma. Devolve true se deu certo.
 */
export async function transcribe(opts: { captions?: boolean } = {}): Promise<boolean> {
  const { project, credits, setBusy, setNotice, setProject, setCredits } = useEditor.getState();
  if (!project) return false;
  const assetId = primaryAssetId(project);
  const asset = assetId ? project.assets[assetId] : null;
  if (!assetId || !asset) return false;
  const cost = creditCost({ type: "ingest", durationSec: asset.duration });
  if (credits < cost && !useEditor.getState().unlimited) {
    setNotice(`Créditos insuficientes: a transcrição custa ${cost} ${cost === 1 ? "crédito" : "créditos"}.`);
    return false;
  }
  setBusy("Extraindo o áudio…");
  try {
    const samples = await decodeMono(assetId);
    const audio = await encodeSpeech(samples, SPEECH_RATE);
    setBusy("Transcrevendo…");
    const body = new FormData();
    body.append("file", audio.blob, audio.filename);
    body.append("duration", String(asset.duration));
    const res = await fetch("/api/transcribe", { method: "POST", body });
    const data = (await res.json()) as { transcript?: Transcript; balance?: number; error?: string };
    if (typeof data.balance === "number") setCredits(data.balance);
    if (!res.ok || !data.transcript) throw new Error(data.error ?? "Falha na transcrição.");
    const current = useEditor.getState().project;
    if (!current?.assets[assetId]) return false;
    const next = structuredClone(current);
    next.assets[assetId]!.transcript = { ...data.transcript, words: wordEnergy(samples, SPEECH_RATE, data.transcript.words) };
    if (opts.captions !== false) next.captions.enabled = true;
    setProject(next, { history: true });
    setNotice(`Transcrição pronta: ${data.transcript.words.length} palavras.${opts.captions !== false ? " Legendas na timeline." : ""}`);
    return true;
  } catch (e) {
    setNotice((e as Error).message);
    return false;
  } finally {
    setBusy(null);
  }
}

/**
 * Garante a transcrição antes de qualquer ação que dependa dela: se ainda não
 * existe, transcreve na hora — o usuário não precisa fazer dois passos.
 */
export async function ensureTranscript(opts: { captions?: boolean } = {}): Promise<boolean> {
  const { project } = useEditor.getState();
  if (!project) return false;
  if (hasTranscript(project)) return true;
  return transcribe(opts);
}

/** Liga/desliga as legendas; ao ligar sem transcrição, transcreve primeiro. */
export async function toggleCaptions(enabled: boolean) {
  const s = useEditor.getState();
  if (!s.project) return;
  if (enabled && !hasTranscript(s.project)) {
    // A própria transcrição já liga as legendas.
    await transcribe({ captions: true });
    return;
  }
  s.apply([{ op: "set_captions", enabled }]);
}

/**
 * Limpeza automática: transcreve (se preciso), tira os erros de gravação e as
 * pausas. Um clique, um ponto de desfazer para os cortes.
 */
export async function autoClean() {
  if (!(await ensureTranscript())) return;
  const s = useEditor.getState();
  const before = s.project;
  if (!before) return;
  const wordsBefore = timelineWords(before).length;
  const lengthBefore = mainClips(before).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const error = s.apply([{ op: "remove_retakes" }, { op: "remove_silences", minSilence: 0.45, padding: 0.1 }]);
  if (error) return s.setNotice(error);
  const after = useEditor.getState().project!;
  const saved = lengthBefore - mainClips(after).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const retakes = wordsBefore - timelineWords(after).length;
  s.setNotice(
    saved < 0.05
      ? "O vídeo já estava limpo: nenhum erro de gravação nem pausa longa."
      : `Limpeza pronta: ${saved.toFixed(1)}s a menos${retakes ? `, ${retakes} palavras de takes errados removidas` : ""}. Ctrl+Z desfaz.`,
  );
}

/** Sessão e saldo atuais. Sem sessão, volta para o login. */
export async function refreshMe() {
  const res = await fetch("/api/me");
  if (res.status === 401) {
    window.location.href = "/login";
    return;
  }
  const data = (await res.json()) as { user?: SessionUser; credits?: number; unlimited?: boolean; brands?: SavedBrand[]; brandLimit?: number };
  if (data.user) useEditor.setState({ user: data.user, credits: data.credits ?? 0, unlimited: !!data.unlimited, brands: data.brands ?? [], brandLimit: data.brandLimit ?? 1 });
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
}

/**
 * Aplica um modelo de edição: a parte determinística (legendas) roda aqui,
 * de graça; zooms, motion e cortes vão para o agente como receita.
 */
export async function applyTemplate(template: EditTemplate) {
  const s = useEditor.getState();
  if (!s.project) return;
  const ops = templateOperations(template, s.project);
  if (!(await ensureTranscript())) return;
  const ops2 = templateOperations(template, useEditor.getState().project!);
  if (ops2.length) useEditor.getState().apply(ops2);
  void ops;
  await askAgent(templatePrompt(template), `Aplicar o modelo "${template.name}"`);
}

type AgentEvent =
  | { type: "status"; text: string }
  | { type: "plan"; plan: EditPlan }
  | { type: "ops"; project: Project; log: string[] }
  | { type: "done"; message: string; project: Project; log: string[]; credits: number; balance: number; reviewToken?: string }
  | { type: "error"; error: string };

/**
 * Pedido ao agente. A resposta chega em etapas (um JSON por linha): cada grupo
 * de operações aplicado no servidor atualiza a timeline na hora. Com um trecho
 * selecionado, só os metadados dele são enviados.
 */
export async function askAgent(message: string, label?: string, opts: { skill?: SkillId } = {}) {
  const s = useEditor.getState();
  if (!s.project || !message.trim()) return;
  const history = s.chat.filter((m) => !m.error && !m.plan).slice(-8).map((m) => ({ role: m.role, text: m.text }));
  s.pushChat({ role: "user", text: label ?? message });
  // O agente edita a partir da fala: sem transcrição, ela é feita antes do pedido.
  if (!(await ensureTranscript())) {
    s.pushChat({ role: "assistant", text: useEditor.getState().notice ?? "Não foi possível transcrever o vídeo.", error: true });
    return;
  }
  const project = useEditor.getState().project!;
  const range = useEditor.getState().range;
  const full = agentTier(message, !!range) === "full";
  s.setBusy(full ? "Analisando o vídeo…" : "O agente está lendo o vídeo…");
  // Edição completa: o agente recebe quadros do vídeo e o enquadramento medido.
  const assetId = primaryAssetId(project);
  const analysis = full && assetId ? await withTimeout(analyzeAsset(assetId), 12_000) : null;
  let applied = false;
  const log: string[] = [];
  let reviewToken: string | undefined;
  try {
    await streamAgent({ project: useEditor.getState().project, selection: range, message, history, skill: opts.skill, frames: analysis?.frames ?? [] }, (e) => {
      if (e.type === "status") s.setBusy(e.text);
      else if (e.type === "plan") s.pushChat({ role: "assistant", text: e.plan.diagnostico, plan: e.plan });
      else if (e.type === "ops") {
        // A primeira etapa cria o ponto de desfazer; as seguintes só atualizam: um Ctrl+Z desfaz o pedido inteiro.
        s.setProject(e.project, { history: applied ? "keep" : true });
        applied = true;
        log.push(...e.log);
        s.setBusy(`${e.log[e.log.length - 1] ?? "Edição aplicada"}. Continuando…`);
      } else if (e.type === "done") {
        s.setCredits(e.balance);
        reviewToken = e.reviewToken;
        s.pushChat({ role: "assistant", text: e.message, log: e.log, credits: e.credits });
      } else {
        void refreshMe();
        s.pushChat({ role: "assistant", text: applied ? `${e.error} As etapas já aplicadas foram mantidas (Ctrl+Z desfaz).` : e.error, log: log.length ? log : undefined, error: true });
      }
    });
    if (reviewToken && applied) await visualReview(reviewToken);
  } catch (e) {
    s.pushChat({ role: "assistant", text: (e as Error).message, error: true });
  } finally {
    s.setBusy(null);
  }
}

/** Envia um pedido ao agente e entrega os eventos (um JSON por linha) conforme chegam. */
async function streamAgent(body: unknown, onEvent: (e: AgentEvent) => void) {
  const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "O agente não respondeu.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += value ?? "";
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as AgentEvent;
      if (event.type === "done" || event.type === "error") finished = true;
      onEvent(event);
    }
    if (done) break;
  }
  if (!finished) throw new Error("A conexão com o agente caiu antes do fim.");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Capturas do vídeo já editado, tiradas do próprio preview: o cursor passa
 * pelos momentos em que há componente ou mídia de contexto na tela. É o que
 * o agente recebe para conferir, com os olhos, o que montou.
 */
async function captureShots(project: Project, max = 6): Promise<{ t: number; data: string }[]> {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="preview"]');
  if (!canvas) return [];
  const moments = project.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.type === "component" || c.type === "broll")
    .sort((a, b) => a.start - b.start)
    .map((c) => Math.round((c.start + Math.min(c.duration * 0.7, Math.max(0.3, c.duration - 0.5))) * 100) / 100);
  // Espalha pelo vídeo quando há mais momentos do que capturas.
  const picked = moments.length <= max ? moments : Array.from({ length: max }, (_, i) => moments[Math.round((i * (moments.length - 1)) / (max - 1))]!);
  const s = useEditor.getState();
  const back = s.time;
  s.setPlaying(false);
  const small = document.createElement("canvas");
  const scale = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  const out: { t: number; data: string }[] = [];
  try {
    for (const t of [...new Set(picked)]) {
      useEditor.getState().seek(t);
      // Tempo para o vídeo buscar o quadro e o preview redesenhar.
      await wait(650);
      small.width = Math.round(canvas.width * scale);
      small.height = Math.round(canvas.height * scale);
      small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
      const data = small.toDataURL("image/jpeg", 0.8).split(",")[1];
      if (data) out.push({ t, data });
    }
  } finally {
    useEditor.getState().seek(back);
  }
  return out;
}

/**
 * Revisão visual depois de uma edição completa: o agente olha as capturas do
 * resultado e corrige texto ilegível, cortado ou sobreposto. Faz parte da
 * edição (sem custo extra) e entra no mesmo ponto de desfazer.
 */
async function visualReview(token: string) {
  const s = useEditor.getState();
  const project = s.project;
  if (!project) return;
  s.setBusy("Conferindo como ficou na tela…");
  const shots = await captureShots(project);
  if (!shots.length) return;
  try {
    await streamAgent({ project: useEditor.getState().project, message: "Revisão visual da edição.", review: { token, shots } }, (e) => {
      if (e.type === "status") s.setBusy(e.text);
      else if (e.type === "ops") s.setProject(e.project, { history: "keep" });
      else if (e.type === "done" && e.log.length) s.pushChat({ role: "assistant", text: `Revi o vídeo pronto, quadro a quadro. ${e.message}`, log: e.log });
    });
  } catch (e) {
    // A edição já está entregue; uma falha na revisão não é erro para o usuário.
    console.warn("revisão visual indisponível", e);
  }
}

/** Tira os erros de gravação de alta confiança, no navegador: 0 créditos. */
export function removeRetakesLocally() {
  const { project, apply, setNotice } = useEditor.getState();
  if (!project) return;
  if (!hasTranscript(project)) return setNotice("Use a Limpeza automática: os erros de gravação são achados pela fala.");
  const before = timelineWords(project).length;
  const error = apply([{ op: "remove_retakes" }]);
  if (error) return setNotice(error);
  const removed = before - timelineWords(useEditor.getState().project!).length;
  setNotice(removed ? `Erros de gravação removidos (${removed} palavras repetidas ou erradas). Ctrl+Z desfaz.` : "Nenhum erro de gravação evidente encontrado. Peça ao agente uma revisão mais fina.");
}

/**
 * Skill: a limpeza determinística roda aqui, de graça; a direção de estilo
 * (cortes finos, câmera, motion) vai para o agente.
 */
export async function runSkill(id: SkillId) {
  const s = useEditor.getState();
  if (!s.project) return;
  if (!(await ensureTranscript())) return;
  const skill = SKILLS[id];
  // Uma operação sem efeito (ex.: nenhum silêncio) não impede as demais.
  const ops: OperationInput[] = skill.local;
  const error = useEditor.getState().apply(ops);
  if (error) return s.setNotice(error);
  await askAgent(skillPrompt(skill), `Editar com a skill ${skill.name}`, { skill: id });
}

/**
 * Salva um Brand Kit na conta (cria quando `id` é null, respeitando o limite
 * do plano) e aplica ao projeto aberto. Devolve mensagem de erro ou null.
 */
export async function saveBrand(id: string | null, name: string, brand: BrandKit): Promise<{ error: string | null; id?: string }> {
  const res = await fetch(id ? `/api/brand/${id}` : "/api/brand", {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, brand }),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { saved?: SavedBrand; error?: string } | null;
  if (!res?.ok || !data?.saved) return { error: data?.error ?? "Não foi possível salvar. Tente de novo." };
  const saved = data.saved;
  useEditor.setState((s) => ({ brands: id ? s.brands.map((b) => (b.id === id ? saved : b)) : [...s.brands, saved] }));
  const { project, apply } = useEditor.getState();
  return { error: project ? apply([{ op: "set_brand", brand: saved.brand }]) : null, id: saved.id };
}

export async function deleteBrand(id: string): Promise<string | null> {
  const res = await fetch(`/api/brand/${id}`, { method: "DELETE" }).catch(() => null);
  if (!res?.ok) return "Não foi possível apagar. Tente de novo.";
  useEditor.setState((s) => ({ brands: s.brands.filter((b) => b.id !== id) }));
  return null;
}

export async function closeProject() {
  await clearMedia();
  clearBroll();
  thumbs.clear();
  useEditor.setState({ chat: [], time: 0, range: null, playing: false });
  useEditor.getState().setProject(null);
}

// ---------- Mídia de contexto (b-roll) ----------

export type StockItem = {
  id: string;
  provider: "pexels" | "pixabay";
  kind: "video" | "image";
  thumb: string;
  url: string;
  width: number;
  height: number;
  duration: number;
  author: string;
  page: string;
};

/** Miniaturas das mídias de contexto (só em memória; refeitas ao reabrir o projeto). */
const thumbs = new Map<string, string>();
export const contextThumb = (assetId: string) => thumbs.get(assetId) ?? null;

async function videoThumb(blob: Blob): Promise<string | null> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("ilegível"));
    });
    await new Promise<void>((resolve) => {
      v.onseeked = () => resolve();
      v.currentTime = Math.min(0.6, v.duration / 2);
    });
    const canvas = document.createElement("canvas");
    const scale = 240 / Math.max(v.videoWidth, v.videoHeight);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Garante a miniatura de uma mídia de contexto já guardada (ex.: depois de recarregar a página). */
export async function ensureContextThumb(assetId: string, kind: Asset["kind"]): Promise<string | null> {
  if (thumbs.has(assetId)) return thumbs.get(assetId)!;
  const blob = mediaBlob(assetId);
  if (!blob) return null;
  const thumb = kind === "image" ? URL.createObjectURL(blob) : await videoThumb(blob);
  if (thumb) thumbs.set(assetId, thumb);
  return thumb;
}

const MAX_CONTEXT_MB = 300;

/**
 * Guarda um vídeo ou imagem de contexto no projeto (o arquivo fica no
 * navegador, como o vídeo principal). Devolve o id do asset, ou null.
 */
export async function addContextMedia(file: Blob, name: string, extra: Pick<Asset, "credit" | "description"> = {}): Promise<string | null> {
  const s = useEditor.getState();
  if (!s.project) return null;
  try {
    if (file.size > MAX_CONTEXT_MB * 1024 * 1024) throw new Error(`"${name}" passa de ${MAX_CONTEXT_MB} MB. Use um trecho menor.`);
    const image = file.type.startsWith("image/");
    let meta: { duration: number; width: number; height: number };
    if (image) {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (!bmp) throw new Error(`Não foi possível ler a imagem "${name}".`);
      meta = { duration: 5, width: bmp.width, height: bmp.height };
      bmp.close();
    } else meta = await probeVideo(file);
    const asset: Asset = { id: newId("ctx"), kind: image ? "image" : "video", name, duration: meta.duration, width: meta.width, height: meta.height, hasAudio: false, role: "context", ...extra };
    await storeMedia(asset.id, file);
    await ensureContextThumb(asset.id, asset.kind);
    const current = useEditor.getState().project;
    if (!current) return null;
    // Sem ponto de desfazer: enviar um arquivo não é uma edição da timeline.
    useEditor.setState({ project: addContextAsset(current, asset) });
    return asset.id;
  } catch (e) {
    s.setNotice((e as Error).message);
    return null;
  }
}

/** Arquivos escolhidos pelo usuário (vários de uma vez). */
export async function uploadContextFiles(files: FileList | File[]) {
  const { setBusy, setNotice } = useEditor.getState();
  const list = [...files].filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));
  if (!list.length) return setNotice("Envie arquivos de vídeo ou imagem.");
  setBusy(`Preparando ${list.length === 1 ? "a mídia" : `${list.length} mídias`}…`);
  let added = 0;
  for (const f of list) if (await addContextMedia(f, f.name.replace(/\.[^.]+$/, ""))) added++;
  setBusy(null);
  if (added) setNotice(`${added === 1 ? "Mídia adicionada" : `${added} mídias adicionadas`}. Clique em “Inserir” para pôr no vídeo, ou peça ao Diretor de IA.`);
}

/** Põe a mídia na timeline, a partir do cursor, e já abre o editor dela. */
export function insertBroll(assetId: string) {
  const s = useEditor.getState();
  if (!s.project) return;
  const before = new Set(s.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  if (s.apply([{ op: "add_broll", assetId, start: s.time }])) return;
  const created = useEditor.getState().project!.tracks.flatMap((t) => t.clips).find((c) => !before.has(c.id));
  if (created) {
    useEditor.getState().select(created.id);
    useEditor.getState().seek(created.start + Math.min(0.8, created.duration / 2));
  }
}

/** Tira a mídia do projeto, com os trechos em que ela aparece. Ctrl+Z traz de volta. */
export function removeContextAsset(assetId: string) {
  const s = useEditor.getState();
  if (!s.project) return;
  const next = structuredClone(s.project);
  delete next.assets[assetId];
  for (const t of next.tracks) t.clips = t.clips.filter((c) => c.type !== "broll" || c.assetId !== assetId);
  next.tracks = next.tracks.filter((t) => t.kind !== "broll" || t.clips.length > 0);
  s.setProject(next, { history: true });
}

export function describeContextAsset(assetId: string, description: string) {
  const current = useEditor.getState().project;
  if (!current?.assets[assetId]) return;
  const next = structuredClone(current);
  next.assets[assetId]!.description = description.trim() || undefined;
  useEditor.setState({ project: next });
}

export async function searchStock(q: string, kind: "video" | "image", orientation: "portrait" | "landscape"): Promise<{ items: StockItem[]; providers?: { pexels: boolean; pixabay: boolean }; error?: string }> {
  const res = await fetch(`/api/stock/search?${new URLSearchParams({ q, kind, orientation })}`).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { items?: StockItem[]; providers?: { pexels: boolean; pixabay: boolean }; error?: string } | null;
  if (!res?.ok) return { items: [], error: data?.error ?? "Não foi possível buscar agora. Tente de novo." };
  return { items: data?.items ?? [], providers: data?.providers };
}

/** Baixa um item do banco gratuito para o navegador e insere no cursor. */
export async function importStockItem(item: StockItem, label: string) {
  const { setBusy, setNotice } = useEditor.getState();
  setBusy("Baixando a mídia…");
  try {
    const res = await fetch(`/api/stock/download?url=${encodeURIComponent(item.url)}`);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "Não foi possível baixar esta mídia.");
    }
    const provider = item.provider === "pexels" ? "Pexels" : "Pixabay";
    const id = await addContextMedia(await res.blob(), label, { credit: { provider, author: item.author || undefined, url: item.page }, description: label });
    if (id) insertBroll(id);
  } catch (e) {
    setNotice((e as Error).message);
  } finally {
    setBusy(null);
  }
}
