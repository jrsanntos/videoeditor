"use client";

import { useEffect, useState } from "react";
import { creditCost, findClip, mainClips, type Clip, type OperationInput } from "@videoeditor/core";
import { COMPONENTS } from "@videoeditor/renderer";
import { removeSilencesLocally, transcribe } from "@/lib/actions";
import { useEditor } from "@/lib/store";

const section = "border-b border-zinc-800 p-3";
const heading = "mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
const btn =
  "w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-xs text-zinc-200 hover:border-zinc-600 disabled:opacity-40";
const field = "w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-500";

export function Sidebar() {
  const project = useEditor((s) => s.project)!;
  const busy = useEditor((s) => s.busy);
  const apply = useEditor((s) => s.apply);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const selected = selectedClipId ? findClip(project, selectedClipId)?.clip : null;
  const asset = project.assets[mainClips(project)[0]?.assetId ?? ""];
  const hasTranscript = Boolean(asset?.transcript?.words.length);
  const ingestCost = asset ? creditCost({ type: "ingest", durationSec: asset.duration }) : 0;
  const caps = project.captions;

  const addComponent = (id: string) => {
    const def = COMPONENTS[id]!;
    const { time } = useEditor.getState();
    apply([{ op: "add_component", component: id, start: time, duration: def.defaultDuration, params: def.example as Record<string, unknown> }]);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-950">
      <div className={section}>
        <h3 className={heading}>Automações</h3>
        <div className="space-y-2">
          <button className={btn} disabled={!!busy} onClick={removeSilencesLocally}>
            Remover silêncios
            <span className="block text-[10px] text-emerald-400">no navegador · grátis</span>
          </button>
          <button className={btn} disabled={!!busy || hasTranscript} onClick={transcribe}>
            {hasTranscript ? "Vídeo transcrito ✓" : "Transcrever fala"}
            {!hasTranscript && <span className="block text-[10px] text-amber-400">{ingestCost} {ingestCost === 1 ? "crédito" : "créditos"} · libera legendas e cortes por fala</span>}
          </button>
        </div>
      </div>

      <div className={section}>
        <h3 className={heading}>Legendas</h3>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={caps.enabled}
            disabled={!hasTranscript}
            onChange={(e) => apply([{ op: "set_captions", enabled: e.target.checked }])}
          />
          {hasTranscript ? "Exibir legendas" : "Transcreva para ativar"}
        </label>
        {hasTranscript && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select
              className={field}
              value={caps.style.preset}
              onChange={(e) => apply([{ op: "set_captions", style: { preset: e.target.value as "bold" } }])}
            >
              <option value="karaoke">Karaokê</option>
              <option value="bold">Negrito</option>
              <option value="clean">Limpa</option>
            </select>
            <select
              className={field}
              value={caps.style.position}
              onChange={(e) => apply([{ op: "set_captions", style: { position: e.target.value as "top" } }])}
            >
              <option value="bottom">Embaixo</option>
              <option value="center">Centro</option>
              <option value="top">Topo</option>
            </select>
          </div>
        )}
      </div>

      <div className={section}>
        <h3 className={heading}>Motion design</h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(COMPONENTS).map((c) => (
            <button
              key={c.id}
              title={c.description}
              onClick={() => addComponent(c.id)}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-2 text-left text-[11px] text-zinc-200 hover:border-emerald-500/60"
            >
              {c.name}
            </button>
          ))}
        </div>
        <button
          className={`${btn} mt-2`}
          onClick={() => {
            const { time } = useEditor.getState();
            apply([{ op: "add_zoom", start: time, duration: 3 }]);
          }}
        >
          + Zoom no cursor
        </button>
      </div>

      {selected && <Inspector key={selected.id} clip={selected} />}
    </aside>
  );
}

function Inspector({ clip }: { clip: Clip }) {
  const apply = useEditor((s) => s.apply);
  const update = (patch: Omit<Extract<OperationInput, { op: "update_clip" }>, "op" | "clipId">) =>
    apply([{ op: "update_clip", clipId: clip.id, ...patch }]);

  return (
    <div className={section} data-testid="inspector">
      <h3 className={heading}>
        {clip.type === "media" ? "Clip de vídeo" : clip.type === "zoom" ? "Zoom" : (COMPONENTS[clip.component]?.name ?? "Componente")}
      </h3>
      <div className="space-y-2">
        {clip.type === "media" && (
          <Num label="Volume" value={clip.volume} min={0} max={2} step={0.05} onCommit={(volume) => update({ volume })} />
        )}
        {clip.type === "zoom" && (
          <>
            <Num label="Escala" value={clip.scale} min={1} max={4} step={0.05} onCommit={(scale) => update({ scale })} />
            <Num label="Foco X" value={clip.x} min={0} max={1} step={0.05} onCommit={(x) => update({ x })} />
            <Num label="Foco Y" value={clip.y} min={0} max={1} step={0.05} onCommit={(y) => update({ y })} />
            <Num label="Suavização (s)" value={clip.ease} min={0} max={2} step={0.05} onCommit={(ease) => update({ ease })} />
          </>
        )}
        {clip.type === "component" &&
          Object.entries(clip.params).map(([key, value]) => (
            <Param key={key} name={key} value={value} onCommit={(v) => update({ params: { [key]: v } })} />
          ))}
        <button
          className="w-full rounded-md border border-rose-900/60 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950"
          onClick={() => {
            if (!apply([{ op: "delete_clip", clipId: clip.id }])) useEditor.getState().select(null);
          }}
        >
          Apagar
        </button>
      </div>
    </div>
  );
}

function Num(props: { label: string; value: number; min: number; max: number; step: number; onCommit: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
      {props.label}
      <input
        type="number"
        className={`${field} w-20`}
        defaultValue={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== props.value) props.onCommit(Math.min(props.max, Math.max(props.min, n)));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

/** Editor genérico de um parâmetro de componente: texto, número ou JSON para listas. */
function Param({ name, value, onCommit }: { name: string; value: unknown; onCommit: (v: unknown) => void }) {
  const structured = typeof value === "object" && value !== null;
  const initial = structured ? JSON.stringify(value, null, 1) : String(value ?? "");
  const [text, setText] = useState(initial);
  useEffect(() => {
    setText(initial);
  }, [initial]);

  const commit = () => {
    if (text === initial) return;
    if (structured) {
      try {
        onCommit(JSON.parse(text));
      } catch {
        useEditor.getState().setNotice(`"${name}" precisa ser um JSON válido.`);
        setText(initial);
      }
    } else if (typeof value === "number") {
      const n = Number(text);
      if (Number.isFinite(n)) onCommit(n);
      else setText(initial);
    } else onCommit(text);
  };

  return (
    <label className="block text-xs text-zinc-400">
      {name}
      {structured ? (
        <textarea className={`${field} mt-1 h-24 font-mono`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      ) : (
        <input
          className={`${field} mt-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      )}
    </label>
  );
}
