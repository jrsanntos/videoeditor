"use client";

import {
  addAssetToProject,
  createProject,
  creditCost,
  mainClips,
  newId,
  silencesFromAudio,
  sourceRangesToTimeline,
  templateOperations,
  templatePrompt,
  type Asset,
  type EditTemplate,
  type Project,
  type Transcript,
} from "@videoeditor/core";
import { clearMedia, decodeMono, encodeWav, probeVideo, SPEECH_RATE, storeMedia } from "./media";
import { useEditor, type SessionUser } from "./store";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Ingestão: lê metadados localmente e cria o projeto. Nada sobe para o servidor. */
export async function importVideo(file: File) {
  const { setBusy, setProject, setNotice } = useEditor.getState();
  setBusy("Lendo o vídeo…");
  try {
    const meta = await probeVideo(file);
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
      width: even(meta.width),
      height: even(meta.height),
    });
    useEditor.setState({ chat: [], time: 0, range: null });
    setProject(addAssetToProject(project, asset));
  } catch (e) {
    setNotice((e as Error).message);
  } finally {
    setBusy(null);
  }
}

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

/** Envia só o áudio leve (16 kHz mono) para transcrição com timestamps por palavra. */
export async function transcribe() {
  const { project, credits, setBusy, setNotice, setProject, setCredits } = useEditor.getState();
  if (!project) return;
  const assetId = primaryAssetId(project);
  const asset = assetId ? project.assets[assetId] : null;
  if (!assetId || !asset) return;
  const cost = creditCost({ type: "ingest", durationSec: asset.duration });
  if (credits < cost) return setNotice(`Créditos insuficientes: a transcrição custa ${cost} créditos.`);
  setBusy("Extraindo o áudio…");
  try {
    const wav = encodeWav(await decodeMono(assetId), SPEECH_RATE);
    setBusy("Transcrevendo…");
    const body = new FormData();
    body.append("file", wav, "audio.wav");
    body.append("duration", String(asset.duration));
    const res = await fetch("/api/transcribe", { method: "POST", body });
    const data = (await res.json()) as { transcript?: Transcript; balance?: number; error?: string };
    if (typeof data.balance === "number") setCredits(data.balance);
    if (!res.ok || !data.transcript) throw new Error(data.error ?? "Falha na transcrição.");
    const current = useEditor.getState().project;
    if (!current?.assets[assetId]) return;
    const next = structuredClone(current);
    next.assets[assetId]!.transcript = data.transcript;
    next.captions.enabled = true;
    setProject(next, { history: true });
    setNotice(`Transcrição pronta: ${data.transcript.words.length} palavras. Legendas ativadas.`);
  } catch (e) {
    setNotice((e as Error).message);
  } finally {
    setBusy(null);
  }
}

/** Sessão e saldo atuais. Sem sessão, volta para o login. */
export async function refreshMe() {
  const res = await fetch("/api/me");
  if (res.status === 401) {
    window.location.href = "/login";
    return;
  }
  const data = (await res.json()) as { user?: SessionUser; credits?: number };
  if (data.user) useEditor.setState({ user: data.user, credits: data.credits ?? 0 });
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

/**
 * Aplica um modelo de edição: a parte determinística (legendas) roda aqui,
 * de graça; zooms, motion e cortes vão para o agente como receita.
 */
export async function applyTemplate(template: EditTemplate) {
  const s = useEditor.getState();
  if (!s.project) return;
  const ops = templateOperations(template, s.project);
  if (ops.length) s.apply(ops);
  await askAgent(templatePrompt(template), `Aplicar o modelo "${template.name}"`);
}

/** Pedido ao agente. Com um trecho selecionado, só os metadados dele são enviados. */
export async function askAgent(message: string, label?: string) {
  const s = useEditor.getState();
  if (!s.project || !message.trim()) return;
  const history = s.chat.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, text: m.text }));
  s.pushChat({ role: "user", text: label ?? message });
  s.setBusy("O agente está editando…");
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: s.project, selection: s.range, message, history }),
    });
    const data = (await res.json()) as {
      message?: string;
      project?: Project;
      log?: string[];
      credits?: number;
      balance?: number;
      error?: string;
    };
    if (typeof data.balance === "number") s.setCredits(data.balance);
    if (!res.ok || !data.message) throw new Error(data.error ?? "O agente não respondeu.");
    if (data.project && data.log?.length) s.setProject(data.project, { history: true });
    s.pushChat({ role: "assistant", text: data.message, log: data.log, credits: data.credits });
  } catch (e) {
    s.pushChat({ role: "assistant", text: (e as Error).message, error: true });
  } finally {
    s.setBusy(null);
  }
}

export async function closeProject() {
  await clearMedia();
  useEditor.setState({ chat: [], time: 0, range: null, playing: false });
  useEditor.getState().setProject(null);
}
