"use client";

import {
  actionRanges,
  addAssetToProject,
  addContextAsset,
  agentTier,
  classifyGenre,
  clipEnd,
  createEmptyProject,
  createProject,
  findRetakes,
  creditCost,
  cutPoints,
  mainClips,
  MAX_CRITIC_CYCLES,
  newId,
  PLANS,
  projectDuration,
  projectGenre,
  SILENCE_MODES,
  silencesFromAudio,
  SKILLS,
  skillOperations,
  skillPrompt,
  subjectAt,
  timelineWords,
  sourceRangesToTimeline,
  type SilenceMode,
  type StyleReferenceProfile,
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
import { cacheGet, cachePut, fileHash } from "./cache";
import { peaksFor } from "./waveform";
import { clearPending, readPending } from "./pending";
import { clearMedia, decodeMono, encodeSpeech, mediaBlob, probeVideo, SPEECH_RATE, storeMedia } from "./media";
import { TOUR_KEY, useEditor, type ChatMessage, type EditPlan, type PendingPlan, type SavedBrand, type SessionUser } from "./store";

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
      const apply = (result: Pick<VideoAnalysis, "subject" | "analysis">) => {
        const current = useEditor.getState().project;
        const asset = current?.assets[assetId];
        if (!current || !asset) return;
        const next = structuredClone(current);
        const target = next.assets[assetId]!;
        if (result.subject.length && !asset.subject) target.subject = result.subject;
        if (result.analysis && !asset.analysis) target.analysis = result.analysis;
        // Sem ponto de desfazer: medir o vídeo não é uma edição.
        useEditor.setState({ project: next });
        reclassify(assetId);
      };
      try {
        // Mesmo arquivo já analisado (em qualquer projeto): vem do cache, sem reprocessar.
        const hash = useEditor.getState().project?.assets[assetId]?.hash;
        const cached = await cacheGet(hash);
        if (cached?.analysis && cached.frames?.length) {
          const result = { subject: cached.subject ?? [], frames: cached.frames, analysis: cached.analysis };
          apply(result);
          return result;
        }
        const samples = await decodeMono(assetId).catch(() => null);
        const words = useEditor.getState().project?.assets[assetId]?.transcript?.words.length;
        const result = await analyzeVideo(blob, assetId, samples, SPEECH_RATE, words);
        apply(result);
        void cachePut(hash, { analysis: result.analysis ?? undefined, subject: result.subject, frames: result.frames });
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

/**
 * Reclassifica o gênero quando chega um dado novo (a transcrição): 9 palavras
 * em 70 s é ação, por mais que o VAD tenha ouvido "voz" no ruído da cena.
 */
function reclassify(assetId: string) {
  const current = useEditor.getState().project;
  const asset = current?.assets[assetId];
  if (!current || !asset?.analysis || !asset.transcript) return;
  const a = asset.analysis;
  const next = classifyGenre({
    duration: asset.duration,
    speechRatio: a.speechRatio,
    wordCount: asset.transcript.words.length,
    motionLevel: a.motionLevel,
    cutsPerMin: a.cuts.length / Math.max(asset.duration / 60, 1 / 60),
    hasPerson: (asset.subject?.length ?? 0) > 0,
  });
  if (next.genre === a.genre) return;
  const project = structuredClone(current);
  project.assets[assetId]!.analysis = { ...a, ...next };
  useEditor.setState({ project });
  void cachePut(asset.hash, { analysis: project.assets[assetId]!.analysis });
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Lê o arquivo e monta o asset, já com o hash e o que o cache souber dele. */
async function ingest(file: File): Promise<Asset> {
  const meta = await probeVideo(file);
  const plan = PLANS[(useEditor.getState().user?.plan ?? "free") as PlanId] ?? PLANS.free;
  if (meta.duration > plan.maxUploadMinutes * 60 + 1)
    throw new Error(`Seu plano aceita vídeos de até ${plan.maxUploadMinutes} minutos (este tem ${Math.ceil(meta.duration / 60)}). Corte o vídeo ou veja os planos.`);
  const hash = await fileHash(file);
  const cached = await cacheGet(hash);
  return {
    id: newId("asset"),
    kind: "video",
    name: file.name,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    hasAudio: true,
    role: "main",
    ...(hash ? { hash } : {}),
    // Vídeo já visto: transcrição e análise voltam do cache, sem gastar créditos nem tempo.
    ...(cached?.transcript ? { transcript: cached.transcript } : {}),
    ...(cached?.analysis ? { analysis: cached.analysis } : {}),
    ...(cached?.subject?.length ? { subject: cached.subject } : {}),
  };
}

/**
 * Ingestão: lê metadados localmente e cria o projeto. O vídeo não sobe para o
 * servidor. Com `referenceUrl` (YouTube), a referência de estilo é analisada
 * em paralelo e entra no contexto do Diretor de IA.
 */
export async function importVideo(file: File, opts: { referenceUrl?: string } = {}) {
  const { setBusy, setProject, setNotice } = useEditor.getState();
  setBusy("Lendo o vídeo…");
  try {
    const asset = await ingest(file);
    await clearMedia();
    clearBroll();
    thumbs.clear();
    analyses.clear();
    await storeMedia(asset.id, file);
    const project = createProject({
      name: file.name.replace(/\.[^.]+$/, ""),
      // Vertical 9:16 é o padrão; o vídeo de origem preenche o quadro e pode ser reenquadrado.
      aspectRatio: "9:16",
      brand: useEditor.getState().brands[0]?.brand,
    });
    useEditor.setState({ chat: [], time: 0, range: null, assistantPick: null });
    setProject(addAssetToProject(project, asset));
    if (asset.transcript) setNotice("Este vídeo já foi analisado antes: a transcrição veio do cache, sem custo.");
    void analyzeAsset(asset.id);
    if (opts.referenceUrl?.trim()) void attachStyleReference(opts.referenceUrl.trim());
    // Todo vídeo novo abre o assistente: escolher um estilo e deixar a IA editar é o caminho mais curto.
    useEditor.setState({ assistant: "choose", tour: null });
  } catch (e) {
    setNotice((e as Error).message);
  } finally {
    setBusy(null);
  }
}

/**
 * Pula o upload: abre o editor numa timeline vazia e funcional. Mídias entram
 * depois (aba Mídia ou arrastando para a timeline); composições só com texto,
 * cards, sons e banco de imagens também valem.
 */
export async function startEmptyProject() {
  await clearMedia();
  clearBroll();
  thumbs.clear();
  analyses.clear();
  useEditor.setState({ chat: [], time: 0, range: null, assistant: null });
  useEditor.getState().setProject(createEmptyProject({ brand: useEditor.getState().brands[0]?.brand }));
}

/**
 * Mais um vídeo para a trilha principal de um projeto já aberto. `at`
 * indefinido = no fim da trilha; com `at`, entra entre clipes (ripple), numa
 * lacuna ou no ponto solto, sem sobrescrever nada.
 */
export async function addMainVideo(file: File, at?: number): Promise<string | null> {
  const s = useEditor.getState();
  if (!s.project) return null;
  s.setBusy("Lendo o vídeo…");
  try {
    const asset = await ingest(file);
    await storeMedia(asset.id, file);
    const current = useEditor.getState().project!;
    const next = structuredClone(current);
    next.assets[asset.id] = asset;
    useEditor.setState({ project: next });
    const end = mainClips(next).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const error = useEditor.getState().apply([{ op: "insert_clip", assetId: asset.id, at: at ?? end }]);
    if (!error) s.setNotice(useEditor.getState().lastLog[0] ?? "Vídeo adicionado à timeline.");
    void analyzeAsset(asset.id);
    return asset.id;
  } catch (e) {
    s.setNotice((e as Error).message);
    return null;
  } finally {
    s.setBusy(null);
  }
}

/** Analisa o vídeo de referência (YouTube) e guarda o perfil de estilo no projeto. */
export async function attachStyleReference(url: string): Promise<string | null> {
  const s = useEditor.getState();
  if (!s.project) return "Nenhum projeto aberto";
  try {
    const res = await fetch("/api/style-reference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const data = (await res.json().catch(() => null)) as { profile?: StyleReferenceProfile; error?: string } | null;
    if (!res.ok || !data?.profile) throw new Error(data?.error ?? "Não foi possível analisar o vídeo de referência.");
    const current = useEditor.getState().project;
    if (!current) return null;
    // Sem ponto de desfazer: a referência é contexto para a IA, não uma edição da timeline.
    useEditor.setState({ project: { ...current, styleReference: data.profile } });
    s.setNotice(`Referência de estilo pronta: "${data.profile.title || "vídeo do YouTube"}". O Diretor de IA vai seguir esse ritmo e esse visual.`);
    return null;
  } catch (e) {
    const message = (e as Error).message;
    s.setNotice(message);
    return message;
  }
}

export function removeStyleReference() {
  const current = useEditor.getState().project;
  if (!current) return;
  const { styleReference: _, ...rest } = current;
  useEditor.setState({ project: rest as Project });
}

// Transcrição vazia também conta: um vídeo sem fala já foi "ouvido" e não precisa ser transcrito de novo.
const hasTranscript = (project: Project) => Object.values(project.assets).some((a) => a.role !== "context" && a.transcript !== undefined);

function primaryAssetId(project: Project): string | null {
  return mainClips(project)[0]?.assetId ?? Object.keys(project.assets)[0] ?? null;
}

/**
 * Remove silêncios analisando o áudio no próprio navegador: 0 créditos, 0 nuvem.
 * O limiar é calibrado pelo próprio arquivo (piso de ruído × voz ativa) e as
 * proteções valem em qualquer modo: pausas < 450 ms ficam, 150 ms antes e
 * 220 ms depois de cada fala ficam, nada de micro-cortes < 300 ms, e silêncio
 * com ação na imagem não é cortado.
 */
export async function removeSilencesLocally(mode: SilenceMode = "natural", opts: { preserveAction?: boolean } = {}) {
  const { project, setBusy, setNotice, apply } = useEditor.getState();
  if (!project) return;
  const assetId = primaryAssetId(project);
  if (!assetId) return setNotice("Adicione um vídeo à timeline primeiro.");
  const preserve = opts.preserveAction ?? true;
  if (preserve && projectGenre(project) === "action_cinematic")
    return setNotice("Este é um vídeo de ação: os silêncios fazem parte da cena e foram preservados. Desligue “Preservar ação” se quiser cortar mesmo assim.");
  setBusy("Analisando o áudio no seu navegador…");
  try {
    const samples = await decodeMono(assetId);
    const analysis = preserve ? (await withTimeout(analyzeAsset(assetId), 20_000))?.analysis : null;
    const protect = analysis ? actionRanges(analysis.motion, 0.5) : [];
    const ranges = sourceRangesToTimeline(useEditor.getState().project!, assetId, silencesFromAudio(samples, SPEECH_RATE, { mode, protect }));
    const label = SILENCE_MODES[mode].name;
    if (!ranges.length) setNotice(`${label}: nenhuma pausa para cortar${protect.length ? " (os trechos com ação foram preservados)" : ""}.`);
    else if (!apply([{ op: "remove_ranges", ranges }])) {
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      setNotice(`${label}: ${ranges.length} pausas removidas (${total.toFixed(1)}s a menos), sem cortar sílabas${protect.length ? " nem cenas de ação" : ""}. Ctrl+Z desfaz.`);
    }
  } catch (e) {
    setNotice((e as Error).message);
  } finally {
    setBusy(null);
  }
}

/** Idioma da fala para o transcritor: o do navegador, quando é um dos suportados; o produto é brasileiro, então o padrão é português. */
function transcriptionLanguage(): string {
  const nav = typeof navigator === "undefined" ? "" : navigator.language.slice(0, 2).toLowerCase();
  return ["pt", "en", "es"].includes(nav) ? nav : "pt";
}

/**
 * Envia só o áudio leve (16 kHz mono) para transcrição com timestamps por
 * palavra e mede a energia da voz em cada uma. Devolve true se deu certo.
 */
export async function transcribe(opts: { captions?: boolean } = {}): Promise<boolean> {
  // O saldo vem do servidor: se a conta ainda não carregou, espera por ela em vez de acusar falta de créditos.
  if (!useEditor.getState().user) await refreshMe();
  const { project, credits, setBusy, setNotice, setProject, setCredits } = useEditor.getState();
  if (!project) return false;
  const assetId = primaryAssetId(project);
  const asset = assetId ? project.assets[assetId] : null;
  if (!assetId || !asset) {
    setNotice("Adicione um vídeo à timeline primeiro (aba Mídia, ou arraste um arquivo para a trilha de vídeo).");
    return false;
  }
  // O mesmo arquivo já foi transcrito antes (cache por SHA-256): reaproveita, sem créditos.
  const cached = await cacheGet(asset.hash);
  if (cached?.transcript) {
    const next = structuredClone(project);
    next.assets[assetId]!.transcript = cached.transcript;
    if (opts.captions !== false && cached.transcript.words.length) next.captions.enabled = true;
    setProject(next, { history: true });
    reclassify(assetId);
    setNotice("Transcrição recuperada do cache: este vídeo já tinha sido transcrito. Nenhum crédito gasto.");
    return true;
  }
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
    body.append("language", transcriptionLanguage());
    body.append("vocabulary", JSON.stringify(useEditor.getState().project?.brand.vocabulary ?? []));
    const res = await fetch("/api/transcribe", { method: "POST", body });
    const data = (await res.json()) as { transcript?: Transcript; balance?: number; error?: string };
    if (typeof data.balance === "number") setCredits(data.balance);
    if (!res.ok || !data.transcript) throw new Error(data.error ?? "Falha na transcrição.");
    const current = useEditor.getState().project;
    if (!current?.assets[assetId]) return false;
    const next = structuredClone(current);
    const transcript = { ...data.transcript, words: wordEnergy(samples, SPEECH_RATE, data.transcript.words) };
    next.assets[assetId]!.transcript = transcript;
    const spoken = transcript.words.length > 0;
    if (opts.captions !== false && spoken) next.captions.enabled = true;
    setProject(next, { history: true });
    void cachePut(asset.hash, { transcript });
    reclassify(assetId);
    setNotice(spoken ? `Transcrição pronta: ${transcript.words.length} palavras.${opts.captions !== false ? " Legendas na timeline." : ""}` : "Este vídeo não tem fala: a edição vai seguir a imagem e o som da cena.");
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
  const error = s.apply([{ op: "remove_retakes" }, { op: "remove_fillers", level: "all" }, { op: "remove_silences", mode: "aggressive" }]);
  if (error) return s.setNotice(error);
  const after = useEditor.getState().project!;
  const saved = lengthBefore - mainClips(after).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const removed = wordsBefore - timelineWords(after).length;
  // O que a limpeza automática não corta sozinha (repetição que pode ser ênfase, autocorreção): fica a sugestão.
  const doubtful = findRetakes(timelineWords(after)).filter((r) => r.confidence === "media").length;
  const review = doubtful ? ` ${doubtful} trecho(s) duvidoso(s) ficaram para você ou a IA decidir — peça “Revise os erros de gravação” no Diretor de IA.` : "";
  s.setNotice(
    saved < 0.05
      ? `O vídeo já estava limpo: nenhum erro de gravação, muleta nem pausa longa.${review}`
      : `Limpeza pronta: ${saved.toFixed(1)}s a menos${removed ? `, ${removed} palavras de erros e muletas removidas` : ""}. Ctrl+Z desfaz.${review}`,
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
  // Modelo pronto da casa: é uma skill completa (acabamento, orçamento de ritmo e direção).
  if (template.skill) return runSkill(template.skill);
  if (!(await ensureTranscript())) return;
  const ops = templateOperations(template, useEditor.getState().project!);
  if (ops.length) useEditor.getState().apply(ops);
  await askAgent(templatePrompt(template), `Aplicar o modelo "${template.name}"`);
}

type AgentEvent =
  | { type: "status"; text: string }
  | { type: "plan"; plan: EditPlan; planToken?: string }
  | { type: "ops"; project: Project; log: string[] }
  | { type: "done"; message: string; project: Project; log: string[]; credits: number; balance: number; reviewToken?: string; awaitingConfirmation?: boolean }
  | { type: "error"; error: string };

/**
 * Pedido ao agente. A resposta chega em etapas (um JSON por linha): cada grupo
 * de operações aplicado no servidor atualiza a timeline na hora. Com um trecho
 * selecionado, só os metadados dele são enviados.
 *
 * Edição completa passa por três papéis: o Diretor devolve um plano por atos,
 * que aparece no chat para confirmação rápida (`confirm: false` pula a
 * pergunta, como no assistente de um clique); o Editor executa; o Crítico
 * avalia o resultado em até 3 ciclos de autocorreção.
 */
export async function askAgent(message: string, label?: string, opts: { skill?: SkillId; confirm?: boolean } = {}) {
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
  // Edição completa: o agente recebe quadros do vídeo, o enquadramento e a análise de movimento e som.
  const assetId = primaryAssetId(project);
  const analysis = full && assetId ? await withTimeout(analyzeAsset(assetId), 25_000) : null;
  const frames = analysis?.frames ?? [];
  if (full && opts.confirm !== false) {
    // Fase 1 — Diretor: só o plano. Nada é editado nem cobrado até o usuário confirmar.
    try {
      await streamAgent({ project: useEditor.getState().project, message, history, skill: opts.skill, frames, phase: "plan" }, (e) => {
        if (e.type === "status") s.setBusy(e.text);
        else if (e.type === "plan" && e.planToken) s.pushChat({ role: "assistant", text: e.plan.resumo, plan: e.plan, pending: { token: e.planToken, message, skill: opts.skill, frames } });
        else if (e.type === "done" && !e.awaitingConfirmation) s.pushChat({ role: "assistant", text: e.message });
        else if (e.type === "error") s.pushChat({ role: "assistant", text: e.error, error: true });
      });
    } catch (e) {
      s.pushChat({ role: "assistant", text: (e as Error).message, error: true });
    } finally {
      s.setBusy(null);
    }
    return;
  }
  await executeAgent({ message, history, skill: opts.skill, frames, selection: range, phase: "auto" });
}

/** O usuário aprovou o plano no chat: o Editor executa e o Crítico confere. */
export async function confirmPlan(messageId: string) {
  const s = useEditor.getState();
  const pending = s.chat.find((m) => m.id === messageId)?.pending;
  if (!pending || s.busy) return;
  s.resolvePlan(messageId);
  s.pushChat({ role: "user", text: "Pode editar assim." });
  await executeAgent({ message: pending.message, history: [], skill: pending.skill as SkillId | undefined, frames: pending.frames, selection: null, phase: "execute", planToken: pending.token });
}

/** O usuário quer outro plano: descarta este e pede de novo, com a observação dele. */
export async function revisePlan(messageId: string, note: string) {
  const s = useEditor.getState();
  const pending = s.chat.find((m) => m.id === messageId)?.pending;
  if (!pending || s.busy) return;
  s.resolvePlan(messageId);
  if (!note.trim()) return;
  await askAgent(`${pending.message}\n\nAjuste pedido pelo usuário depois de ver o primeiro plano: ${note.trim()}`, `Ajustar o plano: ${note.trim()}`, { skill: pending.skill as SkillId | undefined });
}

export function discardPlan(messageId: string) {
  useEditor.getState().resolvePlan(messageId);
}

export const pendingPlanOf = (m: ChatMessage): PendingPlan | undefined => m.pending;

async function executeAgent(req: { message: string; history: { role: string; text: string }[]; skill?: SkillId; frames: { t: number; data: string }[]; selection: { start: number; end: number } | null; phase: "auto" | "execute"; planToken?: string }) {
  const s = useEditor.getState();
  let applied = false;
  const log: string[] = [];
  let reviewToken: string | undefined;
  s.setBusy("O Editor está montando a edição…");
  try {
    await streamAgent({ project: useEditor.getState().project, ...req }, (e) => {
      if (e.type === "status") s.setBusy(e.text);
      else if (e.type === "plan") s.pushChat({ role: "assistant", text: e.plan.resumo, plan: e.plan });
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

/** Captura o preview nos instantes pedidos, em tamanho reduzido. Devolve o cursor ao lugar no fim. */
async function capturePreview(times: number[], maxSide: number): Promise<{ t: number; canvas: HTMLCanvasElement }[]> {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="preview"]');
  if (!canvas) return [];
  const s = useEditor.getState();
  const back = s.time;
  s.setPlaying(false);
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const out: { t: number; canvas: HTMLCanvasElement }[] = [];
  try {
    for (const t of [...new Set(times)]) {
      useEditor.getState().seek(t);
      // Tempo para o vídeo buscar o quadro e o preview redesenhar.
      await wait(520);
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(canvas.width * scale));
      small.height = Math.max(1, Math.round(canvas.height * scale));
      small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
      out.push({ t, canvas: small });
    }
  } finally {
    useEditor.getState().seek(back);
  }
  return out;
}

const spread = <T,>(list: T[], max: number): T[] => (list.length <= max ? list : Array.from({ length: max }, (_, i) => list[Math.round((i * (list.length - 1)) / (max - 1))]!));
const jpeg = (canvas: HTMLCanvasElement, q = 0.8) => canvas.toDataURL("image/jpeg", q).split(",")[1] ?? "";

/**
 * Capturas do vídeo já editado, tiradas do próprio preview: o cursor passa
 * pelos momentos em que há componente ou mídia de contexto na tela. É o que
 * o Crítico recebe para conferir, com os olhos, o que foi montado.
 */
async function captureShots(project: Project, max = 6): Promise<{ t: number; data: string }[]> {
  const moments = project.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.type === "component" || c.type === "broll")
    .sort((a, b) => a.start - b.start)
    .map((c) => Math.round((c.start + Math.min(c.duration * 0.7, Math.max(0.3, c.duration - 0.5))) * 100) / 100);
  // Sem nada por cima (ex.: vídeo de ação só com rampas e cor): olha o começo, o meio e o fim.
  const duration = projectDuration(project);
  const times = moments.length ? spread(moments, max) : [0.4, duration / 2, Math.max(0, duration - 0.6)].map((t) => Math.round(t * 100) / 100);
  return (await capturePreview(times, 480)).map((c) => ({ t: c.t, data: jpeg(c.canvas) })).filter((c) => c.data);
}

/**
 * Tira leve de diagnóstico (timeline_view): miniaturas nos pontos de corte,
 * com a caixa do sujeito detectado por cima, e a forma de onda do áudio
 * embaixo com os cortes marcados. Uma imagem só, barata de enviar.
 */
export async function diagnosticStrip(project: Project, max = 6): Promise<string | null> {
  const duration = projectDuration(project);
  if (duration <= 0) return null;
  const cuts = cutPoints(project).filter((t) => t < duration - 0.1);
  const times = spread([0.15, ...cuts.map((t) => Math.min(duration - 0.05, t + 0.08))], max).map((t) => Math.round(t * 100) / 100);
  const thumbs = await capturePreview(times, 220);
  if (!thumbs.length) return null;
  const th = thumbs[0]!.canvas.height;
  const tw = thumbs[0]!.canvas.width;
  const gap = 6;
  const waveH = 70;
  const strip = document.createElement("canvas");
  strip.width = thumbs.length * (tw + gap) + gap;
  strip.height = th + waveH + 46;
  const ctx = strip.getContext("2d")!;
  ctx.fillStyle = "#0b0b10";
  ctx.fillRect(0, 0, strip.width, strip.height);
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textBaseline = "top";
  thumbs.forEach((thumb, i) => {
    const x = gap + i * (tw + gap);
    ctx.drawImage(thumb.canvas, x, 22);
    ctx.fillStyle = "#e4e4e7";
    ctx.fillText(`${thumb.t.toFixed(1)}s`, x + 2, 4);
    // Caixa do sujeito e centro do rosto, como a segmentação mediu (enquadramento de base).
    const s = subjectAt(project, thumb.t);
    if (s) {
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + s.x * tw, 22 + s.y * th, s.w * tw, s.h * th);
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(x + s.faceX * tw, 22 + s.faceY * th, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // Forma de onda da timeline inteira (segue os cortes), com os pontos de corte em vermelho.
  const y0 = th + 30;
  const w = strip.width - gap * 2;
  ctx.fillStyle = "#18181b";
  ctx.fillRect(gap, y0, w, waveH);
  ctx.fillStyle = "#a78bfa";
  for (const clip of mainClips(project)) {
    const peaks = peaksFor(clip.assetId);
    if (!peaks) continue;
    const x1 = gap + (clip.start / duration) * w;
    const x2 = gap + (clipEnd(clip) / duration) * w;
    for (let x = Math.floor(x1); x < x2; x++) {
      const src = clip.sourceStart + ((x - x1) / Math.max(1, x2 - x1)) * clip.duration;
      const peak = peaks[Math.min(peaks.length - 1, Math.floor(src * 100))] ?? 0;
      const bar = Math.max(1, peak * (waveH - 6));
      ctx.fillRect(x, y0 + (waveH - bar) / 2, 1, bar);
    }
  }
  ctx.fillStyle = "#f43f5e";
  for (const t of cuts) ctx.fillRect(gap + (t / duration) * w, y0, 1.5, waveH);
  return jpeg(strip, 0.78) || null;
}

/**
 * Crítico visual depois de uma edição completa: olha a tira de diagnóstico e
 * as capturas do resultado, e corrige. Cada correção gera uma nova avaliação,
 * até 3 ciclos. Faz parte da edição (sem custo extra) e entra no mesmo ponto
 * de desfazer.
 */
async function visualReview(firstToken: string) {
  const s = useEditor.getState();
  let token: string | undefined = firstToken;
  const fixes: string[] = [];
  let lastMessage = "";
  for (let cycle = 1; token && cycle <= MAX_CRITIC_CYCLES; cycle++) {
    const project = useEditor.getState().project;
    if (!project) return;
    s.setBusy(`O Crítico está conferindo como ficou na tela (${cycle} de ${MAX_CRITIC_CYCLES})…`);
    const strip = await diagnosticStrip(project);
    const shots = await captureShots(project);
    if (!shots.length) break;
    const current: string = token;
    token = undefined;
    try {
      await streamAgent({ project: useEditor.getState().project, message: "Autoavaliação visual da edição.", review: { token: current, shots, ...(strip ? { strip } : {}) } }, (e) => {
        if (e.type === "status") s.setBusy(e.text);
        else if (e.type === "ops") s.setProject(e.project, { history: "keep" });
        else if (e.type === "done") {
          token = e.reviewToken;
          if (e.log.length) {
            fixes.push(...e.log);
            lastMessage = e.message;
          }
        }
      });
    } catch (e) {
      // A edição já está entregue; uma falha na revisão não é erro para o usuário.
      console.warn("revisão visual indisponível", e);
      break;
    }
  }
  if (fixes.length) s.pushChat({ role: "assistant", text: `Revi o vídeo pronto, quadro a quadro. ${lastMessage}`, log: fixes });
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

/** Quem prefere editar à mão: fecha o assistente e, na primeira vez, mostra o guia das ferramentas. */
export function editManually() {
  useEditor.setState({ assistant: null });
  let seen = false;
  try {
    seen = localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    // sem armazenamento: mostra o guia
  }
  if (!seen) useEditor.getState().setTour(0);
}

/** Créditos que a edição automática deste projeto vai gastar (transcrição, se ainda não houver, + edição completa). */
export function autoEditCost(project: Project): number {
  const asset = project.assets[mainClips(project)[0]?.assetId ?? ""];
  const transcribed = Boolean(asset?.transcript?.words.length);
  const ingestCost = transcribed || !asset ? 0 : creditCost({ type: "ingest", durationSec: asset.duration });
  return ingestCost + creditCost({ type: "agent", tier: "full", durationSec: projectDuration(project) });
}

/**
 * Retoma o vídeo enviado na página inicial antes do cadastro: importa e, se
 * um estilo foi escolhido, já começa a edição automática com os créditos da
 * conta. Sem créditos suficientes, o assistente abre com o estilo marcado.
 * Devolve true se havia um vídeo pendente.
 */
export async function resumePending(): Promise<boolean> {
  const pending = await readPending();
  if (!pending) return false;
  // Sai da fila antes de importar: um vídeo que falha (longo demais para o plano) não volta em loop.
  await clearPending();
  await refreshMe();
  const before = useEditor.getState().project;
  await importVideo(pending.file);
  const s = useEditor.getState();
  if (!s.project || s.project === before) return true;
  if (!pending.style) {
    editManually();
    return true;
  }
  useEditor.setState({ assistantPick: pending.style });
  if (s.unlimited || s.credits >= autoEditCost(s.project)) void autoEdit(pending.style);
  return true;
}

/**
 * Edição automática em um clique, pelo assistente: transcreve, limpa, edita
 * no estilo escolhido e revisa. No fim, o cartão "vídeo pronto".
 */
export async function autoEdit(id: SkillId) {
  useEditor.setState({ assistant: "working" });
  const before = useEditor.getState().chat.length;
  // Um clique: o plano do Diretor aparece no chat, mas a edição segue sem esperar confirmação.
  await runSkill(id, { confirm: false });
  const s = useEditor.getState();
  const reply = s.chat.slice(before).filter((m) => m.role === "assistant" && !m.plan);
  const ok = reply.length > 0 && !reply[reply.length - 1]!.error;
  // Se algo falhou, o motivo já está no aviso ou no chat: o assistente só sai da frente.
  useEditor.setState({ assistant: ok ? "done" : null });
}

/** Só a limpeza, pelo assistente. */
export async function autoCleanOnly() {
  useEditor.setState({ assistant: null });
  await autoClean();
}

/**
 * Modelo de edição: a limpeza e o acabamento determinísticos (legenda, cor,
 * trilha) rodam aqui, de graça; a direção (cortes finos, velocidade, câmera,
 * motion, sons) vai para o Diretor de IA.
 */
export async function runSkill(id: SkillId, opts: { confirm?: boolean } = {}) {
  const s = useEditor.getState();
  if (!s.project) return;
  if (!(await ensureTranscript())) return;
  const skill = SKILLS[id];
  // Só o que faz sentido para ESTE vídeo: sem fala não há limpeza de fala; a marca do usuário não é trocada.
  const ops: OperationInput[] = skillOperations(skill, useEditor.getState().project!);
  const error = ops.length ? useEditor.getState().apply(ops) : null;
  if (error) return s.setNotice(error);
  await askAgent(skillPrompt(skill), `Editar o vídeo no modelo ${skill.name}`, { skill: id, confirm: opts.confirm });
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
  analyses.clear();
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

/** Põe a mídia na trilha de cima (overlay), a partir do cursor ou de `at`, e já abre o editor dela. */
export function insertBroll(assetId: string, at?: number) {
  const s = useEditor.getState();
  if (!s.project) return;
  const before = new Set(s.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  if (s.apply([{ op: "add_broll", assetId, start: at ?? s.time }])) return;
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

/**
 * Solta uma mídia do projeto na trilha principal: entre dois clipes abre
 * espaço (ripple), numa lacuna encaixa (aparando se não couber). Nada é sobrescrito.
 */
export function insertOnMain(assetId: string, at: number, mode: "auto" | "insert" | "overwrite" = "auto") {
  const s = useEditor.getState();
  if (!s.project) return;
  if (s.apply([{ op: "insert_clip", assetId, at, mode }])) return;
  const log = useEditor.getState().lastLog[0];
  if (log) s.setNotice(log.replace(/\s*\(clip_[^)]+\)/, ""));
}
