"use client";

import { useRef, useState } from "react";
import { EditTemplateSchema, silencesFromAudio, type EditTemplate } from "@videoeditor/core";
import { COMPONENTS } from "@videoeditor/renderer";
import { decodeBlobMono, encodeWav, probeVideo, sampleFrames, SPEECH_RATE } from "@/lib/media";
import { api, Badge, btn, btnDanger, btnPrimary, card, dateTime, ErrorBox, input, useApi } from "./ui";

type Template = {
  id: string;
  status: "draft" | "published";
  data: EditTemplate;
  sourceName: string;
  sourceDuration: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
};

const FRAMES = 12;

export function TemplatesTab() {
  const { data, error, reload } = useApi<{ templates: Template[] }>("/api/admin/templates");
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Uploader onCreated={async (t) => (await reload(), setEditing(t.id))} />
      <ErrorBox message={error} />
      <div className="grid gap-4 md:grid-cols-2">
        {data?.templates.map((t) =>
          editing === t.id ? (
            <Editor key={t.id} template={t} onDone={async () => (await reload(), setEditing(null))} />
          ) : (
            <TemplateCard key={t.id} template={t} onEdit={() => setEditing(t.id)} onChanged={reload} />
          ),
        )}
      </div>
      {data?.templates.length === 0 && <p className="text-sm text-zinc-500">Nenhum modelo ainda. Envie um vídeo de exemplo acima.</p>}
    </div>
  );
}

function Uploader({ onCreated }: { onCreated: (t: Template) => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(file: File) {
    setError(null);
    try {
      setStep("Lendo o vídeo…");
      const meta = await probeVideo(file);
      setStep("Extraindo o áudio e medindo as pausas…");
      const samples = await decodeBlobMono(file);
      const pauses = silencesFromAudio(samples, SPEECH_RATE, { minSilence: 0.4, padding: 0 });
      const lengths = pauses.map((p) => p.end - p.start);
      setStep(`Capturando ${FRAMES} quadros…`);
      const frames = await sampleFrames(file, FRAMES);
      setStep("Transcrevendo e analisando o estilo com a IA (até 1 minuto)…");
      const body = new FormData();
      body.append("audio", encodeWav(samples, SPEECH_RATE), "audio.wav");
      for (const f of frames) body.append("frames", f.image, `frame-${f.t}.jpg`);
      body.append(
        "meta",
        JSON.stringify({
          name: file.name,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          frameTimes: frames.map((f) => f.t),
          pauses: {
            count: pauses.length,
            total: lengths.reduce((s, l) => s + l, 0),
            longest: Math.max(0, ...lengths),
          },
        }),
      );
      const { template } = await api<{ template: Template }>("/api/admin/templates", { method: "POST", body });
      await onCreated(template);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-medium text-zinc-100">Novo modelo a partir de um vídeo de exemplo</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Envie um vídeo já editado no estilo que você quer oferecer. A IA analisa legendas, ritmo de cortes, zooms e gráficos e cria um modelo em
        rascunho. Revise, ajuste e publique: ele aparece para todos os usuários no editor. O vídeo não é armazenado, só 12 quadros, o áudio para
        transcrição e uma miniatura.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button className={btnPrimary} disabled={!!step} onClick={() => fileRef.current?.click()}>
          {step ? "Processando…" : "Escolher vídeo"}
        </button>
        {step && <span className="text-sm text-zinc-400">{step}</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        data-testid="template-file"
        onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])}
      />
      <div className="mt-3">
        <ErrorBox message={error} />
      </div>
    </div>
  );
}

function TemplateCard({ template: t, onEdit, onChanged }: { template: Template; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function call(init: Parameters<typeof api>[1], confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/templates/${t.id}`, init);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const d = t.data;
  return (
    <div className={`${card} p-0`} data-testid="template-card">
      {t.thumbnail && <img src={t.thumbnail} alt="" className="aspect-video w-full rounded-t-xl object-cover" />}
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-zinc-100">{d.name}</h3>
          <span className="ml-auto">
            <Badge tone={t.status === "published" ? "good" : "neutral"}>{t.status === "published" ? "publicado" : "rascunho"}</Badge>
          </span>
        </div>
        <p className="text-sm text-zinc-400">{d.description}</p>
        <ul className="space-y-0.5 text-xs text-zinc-400">
          <li>Legendas: {d.captions.enabled ? `${d.captions.preset}, ${d.captions.position}` : "não"}</li>
          <li>Pausas: {d.silence.remove ? `corta acima de ${d.silence.minSilence}s (respiro ${d.silence.padding}s)` : "mantém"}</li>
          <li>Zooms: {d.zoom.perMinute > 0 ? `${d.zoom.perMinute}/min, ${d.zoom.scale}×, ${d.zoom.duration}s` : "não"}</li>
          <li>Motion: {d.motion.length ? d.motion.map((m) => COMPONENTS[m.component]?.name ?? m.component).join(", ") : "nenhum"}</li>
        </ul>
        <p className="text-xs text-zinc-500">
          De “{t.sourceName}” ({Math.round(t.sourceDuration)}s) · {dateTime(t.updatedAt)}
        </p>
        <ErrorBox message={error} />
        <div className="flex flex-wrap gap-2 pt-1">
          {t.status === "draft" ? (
            <button className={btnPrimary} disabled={busy} onClick={() => void call({ method: "PATCH", json: { status: "published" } })}>
              Publicar
            </button>
          ) : (
            <button className={btn} disabled={busy} onClick={() => void call({ method: "PATCH", json: { status: "draft" } })}>
              Despublicar
            </button>
          )}
          <button className={btn} disabled={busy} onClick={onEdit}>
            Editar
          </button>
          <button className={btnDanger} disabled={busy} onClick={() => void call({ method: "DELETE" }, `Apagar o modelo "${d.name}"?`)}>
            Apagar
          </button>
        </div>
      </div>
    </div>
  );
}

function Editor({ template, onDone }: { template: Template; onDone: () => Promise<void> }) {
  const [d, setD] = useState<EditTemplate>(template.data);
  const [motionText, setMotionText] = useState(JSON.stringify(template.data.motion, null, 1));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EditTemplate>(k: K, v: EditTemplate[K]) => setD((x) => ({ ...x, [k]: v }));
  const num = (v: string) => Number(v.replace(",", "."));

  async function save() {
    setError(null);
    let motion: EditTemplate["motion"];
    try {
      motion = JSON.parse(motionText);
    } catch {
      return setError("A lista de motion precisa ser um JSON válido.");
    }
    const parsed = EditTemplateSchema.safeParse({ ...d, motion });
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    setBusy(true);
    try {
      await api(`/api/admin/templates/${template.id}`, { method: "PATCH", json: { data: parsed.data } });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const label = "block text-xs text-zinc-400";
  return (
    <div className={`${card} space-y-3 md:col-span-2`}>
      <h3 className="text-sm font-medium text-zinc-100">Editar modelo</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>
          Nome
          <input className={`${input} mt-1 w-full`} value={d.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className={label}>
          Descrição para o usuário
          <input className={`${input} mt-1 w-full`} value={d.description} maxLength={280} onChange={(e) => set("description", e.target.value)} />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <label className={label}>
          Legendas
          <select
            className={`${input} mt-1 w-full`}
            value={d.captions.enabled ? d.captions.preset : "off"}
            onChange={(e) =>
              set("captions", e.target.value === "off" ? { ...d.captions, enabled: false } : { ...d.captions, enabled: true, preset: e.target.value as "bold" })
            }
          >
            <option value="off">Sem legendas</option>
            <option value="karaoke">Karaokê</option>
            <option value="bold">Negrito</option>
            <option value="clean">Limpa</option>
          </select>
        </label>
        <label className={label}>
          Posição
          <select className={`${input} mt-1 w-full`} value={d.captions.position} onChange={(e) => set("captions", { ...d.captions, position: e.target.value as "top" })}>
            <option value="bottom">Embaixo</option>
            <option value="center">Centro</option>
            <option value="top">Topo</option>
          </select>
        </label>
        <label className={label}>
          Cortar pausas acima de (s)
          <input
            className={`${input} mt-1 w-full`}
            type="number"
            step="0.05"
            value={d.silence.remove ? d.silence.minSilence : ""}
            placeholder="não cortar"
            onChange={(e) =>
              set("silence", e.target.value ? { ...d.silence, remove: true, minSilence: num(e.target.value) } : { ...d.silence, remove: false })
            }
          />
        </label>
        <label className={label}>
          Respiro (s)
          <input className={`${input} mt-1 w-full`} type="number" step="0.05" value={d.silence.padding} onChange={(e) => set("silence", { ...d.silence, padding: num(e.target.value) })} />
        </label>
        <label className={label}>
          Zooms por minuto
          <input className={`${input} mt-1 w-full`} type="number" step="0.5" value={d.zoom.perMinute} onChange={(e) => set("zoom", { ...d.zoom, perMinute: num(e.target.value) })} />
        </label>
        <label className={label}>
          Escala do zoom
          <input className={`${input} mt-1 w-full`} type="number" step="0.05" value={d.zoom.scale} onChange={(e) => set("zoom", { ...d.zoom, scale: num(e.target.value) })} />
        </label>
        <label className={label}>
          Duração do zoom (s)
          <input className={`${input} mt-1 w-full`} type="number" step="0.5" value={d.zoom.duration} onChange={(e) => set("zoom", { ...d.zoom, duration: num(e.target.value) })} />
        </label>
        <label className={label}>
          Foco vertical (0–1)
          <input className={`${input} mt-1 w-full`} type="number" step="0.05" value={d.zoom.focusY} onChange={(e) => set("zoom", { ...d.zoom, focusY: num(e.target.value) })} />
        </label>
      </div>
      <label className={label}>
        Ritmo
        <input className={`${input} mt-1 w-full`} value={d.pacing} maxLength={400} onChange={(e) => set("pacing", e.target.value)} />
      </label>
      <label className={label}>
        Receita para o agente
        <textarea className={`${input} mt-1 h-36 w-full`} value={d.instructions} maxLength={2000} onChange={(e) => set("instructions", e.target.value)} />
      </label>
      <label className={label}>
        Motion design (JSON: lista de {"{"}component, when{"}"}; componentes: {Object.keys(COMPONENTS).join(", ")})
        <textarea className={`${input} mt-1 h-28 w-full font-mono text-xs`} value={motionText} onChange={(e) => setMotionText(e.target.value)} />
      </label>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
          Salvar
        </button>
        <button className={btn} disabled={busy} onClick={() => void onDone()}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
