"use client";

import {
  addAssetToProject,
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
  if (credits < cost) {
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
  const data = (await res.json()) as { user?: SessionUser; credits?: number; brands?: SavedBrand[]; brandLimit?: number };
  if (data.user) useEditor.setState({ user: data.user, credits: data.credits ?? 0, brands: data.brands ?? [], brandLimit: data.brandLimit ?? 1 });
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
  | { type: "done"; message: string; project: Project; log: string[]; credits: number; balance: number }
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
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: useEditor.getState().project, selection: range, message, history, skill: opts.skill, frames: analysis?.frames ?? [] }),
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "O agente não respondeu.");
    }
    const onEvent = (e: AgentEvent) => {
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
        s.pushChat({ role: "assistant", text: e.message, log: e.log, credits: e.credits });
      } else {
        void refreshMe();
        s.pushChat({ role: "assistant", text: applied ? `${e.error} As etapas já aplicadas foram mantidas (Ctrl+Z desfaz).` : e.error, log: log.length ? log : undefined, error: true });
      }
    };
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
  } catch (e) {
    s.pushChat({ role: "assistant", text: (e as Error).message, error: true });
  } finally {
    s.setBusy(null);
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
  useEditor.setState({ chat: [], time: 0, range: null, playing: false });
  useEditor.getState().setProject(null);
}
