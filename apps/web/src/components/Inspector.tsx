"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { findClip, FONT_PAIRS, hasSpeed, isFullscreen, rateAverage, sourceSpan, timelineWords, type BrollClip, type Clip, type ComponentClip, type FontPairId, type ImpactClip, type MediaClip, type OperationInput, type SfxClip, type ZoomClip } from "@videoeditor/core";
import { captionGroups, COMPONENTS, SFX_CATALOG, type ComponentDef } from "@videoeditor/renderer";
import { fromTokens, toTokens } from "@/lib/params";
import { useEditor } from "@/lib/store";
import { formatTime } from "./Player";
import { Icon, iconBtn, Switch } from "./ui";

const field = "w-full rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-brand-400";
const label = "mb-1 block text-[11px] font-medium text-zinc-400";
const group = "space-y-3 border-b border-line px-4 py-4";
const groupTitle = "flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500";

/** Tradução dos valores de escolha que aparecem nos componentes. */
const CHOICES: Record<string, string> = {
  left: "Esquerda",
  right: "Direita",
  list: "Lista numerada",
  acronym: "Sigla",
  stairs: "Escada",
  line: "Linha",
};

type Update = Omit<Extract<OperationInput, { op: "update_clip" }>, "op" | "clipId">;

/**
 * Editor do que está selecionado na timeline — um componente de motion, um
 * zoom, um clip de vídeo ou uma legenda. Abre em caixa própria ao lado do
 * vídeo: campos em português, destaque de palavras por clique, cores, fonte,
 * tamanho e posição. O texto também pode ser arrastado e reescrito no vídeo.
 */
export function Inspector() {
  const project = useEditor((s) => s.project);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const selectedCaption = useEditor((s) => s.selectedCaption);
  if (!project) return null;
  const clip = selectedClipId ? findClip(project, selectedClipId)?.clip : null;
  const caption = selectedCaption ? captionGroups(project).find((g) => g.wordIds[0] === selectedCaption[0]) : null;
  if (!clip && !caption) return null;

  const close = () => useEditor.getState().select(null);
  const title = caption
    ? "Legenda"
    : clip!.type === "media"
      ? "Clip de vídeo"
      : clip!.type === "zoom"
        ? "Movimento de câmera"
        : clip!.type === "broll"
          ? "Mídia de contexto"
          : clip!.type === "sfx"
            ? "Efeito sonoro"
            : clip!.type === "impact"
              ? "Impacto de câmera"
              : (COMPONENTS[clip!.component]?.name ?? "Componente");
  const kind = caption ? "captions" : clip!.type;
  const accent = { captions: "text-sky-300 bg-sky-400/15", media: "text-brand-300 bg-brand-500/15", zoom: "text-amber-300 bg-amber-400/15", component: "text-emerald-300 bg-emerald-400/15", broll: "text-rose-300 bg-rose-400/15", sfx: "text-cyan-300 bg-cyan-400/15", impact: "text-orange-300 bg-orange-400/15" }[kind];
  const KindIcon = { captions: Icon.captions, media: Icon.film, zoom: Icon.zoomIn, component: Icon.layers, broll: Icon.film, sfx: Icon.mic, impact: Icon.bolt }[kind];

  return (
    <aside className="pop-in m-3 mr-0 flex w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-line-strong bg-ink-850 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]" data-testid="inspector">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
          <KindIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
          <p className="text-[11px] text-zinc-500">
            {caption ? `${formatTime(caption.start)} – ${formatTime(caption.end)}` : `${formatTime(clip!.start)} · ${clip!.duration.toFixed(1)}s`}
          </p>
        </div>
        <button className={iconBtn} onClick={close} aria-label="Fechar editor" title="Fechar (Esc)">
          <Icon.x size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {caption ? <CaptionEditor key={caption.wordIds[0]} wordIds={caption.wordIds} text={caption.text} hidden={caption.hidden} shift={caption.shift} doubtful={caption.doubtful} /> : <ClipEditor key={clip!.id} clip={clip!} />}
      </div>
    </aside>
  );
}

function ClipEditor({ clip }: { clip: Clip }) {
  const apply = useEditor((s) => s.apply);
  const update = (patch: Update) => {
    if (!apply([{ op: "update_clip", clipId: clip.id, ...patch }])) useEditor.getState().select(clip.id);
  };
  return (
    <>
      {clip.type === "component" && <ComponentEditor clip={clip} update={update} />}
      {clip.type === "zoom" && <ZoomEditor clip={clip} update={update} />}
      {clip.type === "broll" && <BrollEditor clip={clip} update={update} />}
      {clip.type === "media" && <MediaEditor clip={clip} update={update} />}
      {clip.type === "sfx" && <SfxEditor clip={clip} update={update} />}
      {clip.type === "impact" && <ImpactEditor clip={clip} update={update} />}
      {clip.type !== "media" && clip.type !== "sfx" && (
        <div className={group}>
          <h3 className={groupTitle}>
            <Icon.clock size={12} /> Tempo
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Começa em (s)" value={clip.start} min={0} max={36000} step={0.1} onCommit={(start) => update({ start })} />
            <Num label="Duração (s)" value={clip.duration} min={0.2} max={600} step={0.1} onCommit={(duration) => update({ duration })} />
          </div>
        </div>
      )}
      <div className="p-4">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/25 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/10"
          onClick={() => {
            if (!apply([{ op: "delete_clip", clipId: clip.id }])) useEditor.getState().select(null);
          }}
        >
          <Icon.trash size={14} /> {clip.type === "media" ? "Apagar e fechar o buraco (ripple)" : clip.type === "zoom" ? "Apagar zoom" : clip.type === "broll" ? "Tirar do vídeo" : clip.type === "sfx" ? "Apagar som" : clip.type === "impact" ? "Apagar impacto" : "Apagar componente"}
        </button>
        {clip.type === "media" && (
          <button
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/5"
            data-testid="lift-delete"
            title="Shift+Delete"
            onClick={() => {
              if (!apply([{ op: "delete_clip", clipId: clip.id, ripple: false }])) useEditor.getState().select(null);
            }}
          >
            Apagar e deixar a lacuna
          </button>
        )}
      </div>
    </>
  );
}

// ---------- Componentes de motion ----------

type JsonSchema = {
  type?: string;
  enum?: string[];
  description?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
};

const schemaCache = new Map<string, JsonSchema>();
function schemaOf(def: ComponentDef): JsonSchema {
  let s = schemaCache.get(def.id);
  if (!s) {
    s = z.toJSONSchema(def.schema, { io: "input" }) as JsonSchema;
    schemaCache.set(def.id, s);
  }
  return s;
}

const isRich = (s: JsonSchema) => s.type === "string" && /asteriscos/.test(s.description ?? "");
/** Campos que não são editados por formulário: posição (arrasta-se no vídeo) e instantes internos. */
const hiddenField = (key: string) => key.endsWith("Pos") || key === "accent" || key === "background";

function ComponentEditor({ clip, update }: { clip: ComponentClip; update: (p: Update) => void }) {
  const def = COMPONENTS[clip.component];
  const brand = useEditor((s) => s.project!.brand);
  if (!def) return null;
  const schema = schemaOf(def);
  const labels = def.labels ?? {};
  const set = (key: string, value: unknown) => update({ params: { [key]: value } });
  const style = clip.style;
  const fullscreen = isFullscreen(clip);
  const perText = Object.keys(def.positions ?? {}).length > 0;
  const moved = !!style && (style.dx !== 0 || style.dy !== 0 || style.scale !== 1);
  const textsMoved = Object.values(def.positions ?? {}).some((k) => clip.params[k]);

  return (
    <>
      <div className="flex items-start gap-2 border-b border-line bg-brand-500/[0.07] px-4 py-2.5 text-[11.5px] leading-snug text-brand-300">
        <Icon.move size={14} className="mt-0.5 shrink-0" />
        <span>
          {fullscreen ? "Dê duplo clique num texto do vídeo para reescrever ali mesmo." : perText ? "No vídeo: arraste cada texto para posicionar e dê duplo clique para reescrever." : "No vídeo: arraste para posicionar e dê duplo clique num texto para reescrever."}
        </span>
      </div>

      <div className={group}>
        <h3 className={groupTitle}>
          <Icon.type size={12} /> Conteúdo
        </h3>
        {Object.entries(schema.properties ?? {})
          .filter(([key]) => !hiddenField(key))
          .map(([key, prop]) => (
            <Field key={key} name={labels[key] ?? key} schema={prop} labels={labels} value={clip.params[key]} onChange={(v) => set(key, v)} placeholder={key === "name" ? brand.displayName : key === "credential" ? brand.credential : undefined} />
          ))}
      </div>

      <div className={group}>
        <h3 className={groupTitle}>
          <Icon.palette size={12} /> Aparência
        </h3>
        <div>
          <span className={label}>Fonte</span>
          <select className={field} value={style?.fontPair ?? ""} onChange={(e) => update({ style: { fontPair: e.target.value || null } })} data-testid="clip-font">
            <option value="">Da sua marca ({FONT_PAIRS[brand.fontPair].name})</option>
            {(Object.keys(FONT_PAIRS) as FontPairId[]).map((id) => (
              <option key={id} value={id}>
                {FONT_PAIRS[id].name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ColorField label="Destaque" value={style?.primaryColor} fallback={brand.primaryColor} onChange={(primaryColor) => update({ style: { primaryColor } })} />
          <ColorField label="Texto" value={style?.textColor} fallback={brand.textColor} onChange={(textColor) => update({ style: { textColor } })} />
          <ColorField label="Fundo" value={style?.backgroundColor} fallback={brand.backgroundColor} onChange={(backgroundColor) => update({ style: { backgroundColor } })} />
        </div>
        {!fullscreen && <Slider label="Tamanho" value={style?.scale ?? 1} min={0.4} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(scale) => update({ style: { scale } })} />}
        {(moved || textsMoved) && (
          <button
            className="text-[11.5px] text-zinc-400 underline-offset-2 hover:text-white hover:underline"
            onClick={() => update({ style: { dx: 0, dy: 0, scale: 1 }, params: Object.fromEntries(Object.values(def.positions ?? {}).map((k) => [k, undefined])) })}
          >
            Voltar à posição e ao tamanho originais
          </button>
        )}
      </div>
    </>
  );
}

function Field(props: { name: string; schema: JsonSchema; labels: Record<string, string>; value: unknown; onChange: (v: unknown) => void; placeholder?: string }) {
  const { schema, value, onChange } = props;
  if (schema.enum)
    return (
      <div>
        <span className={label}>{props.name}</span>
        <div className="flex gap-1 rounded-lg border border-line bg-ink-900 p-0.5">
          {schema.enum.map((opt) => (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs transition ${(value ?? schema.default) === opt ? "bg-brand-500 font-medium text-white" : "text-zinc-400 hover:text-white"}`}
            >
              {CHOICES[opt] ?? opt}
            </button>
          ))}
        </div>
      </div>
    );
  if (schema.type === "boolean")
    return (
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-zinc-200">{props.name}</span>
        <Switch checked={Boolean(value ?? schema.default)} onChange={onChange} label={props.name} />
      </div>
    );
  if (schema.type === "number" || schema.type === "integer")
    return <Num label={props.name} value={typeof value === "number" ? value : Number(schema.default ?? 0)} min={schema.minimum ?? -1e9} max={schema.maximum ?? 1e9} step={schema.type === "integer" ? 1 : 0.1} onCommit={onChange} />;
  if (schema.type === "array" && schema.items?.type === "object") return <ListField {...props} items={Array.isArray(value) ? (value as Record<string, unknown>[]) : []} />;
  if (schema.type === "array")
    return <TextList name={props.name} items={Array.isArray(value) ? (value as string[]) : []} min={schema.minItems ?? 1} max={schema.maxItems ?? 8} onChange={onChange} />;
  if (schema.type === "object") {
    // Só "momento da virada" hoje: um instante em segundos.
    const at = (value as { at?: number } | undefined)?.at;
    return <Num label={`${props.name} (s, vazio = automático)`} value={at ?? NaN} min={0} max={600} step={0.1} onCommit={(n) => onChange(Number.isFinite(n) ? { at: n } : undefined)} allowEmpty />;
  }
  if (isRich(schema)) return <RichField name={props.name} value={typeof value === "string" ? value : ""} max={schema.maxLength} onChange={onChange} />;
  return <TextField name={props.name} value={typeof value === "string" ? value : ""} max={schema.maxLength} placeholder={props.placeholder} onChange={(v) => onChange(v || undefined)} />;
}

function TextField({ name, value, max, placeholder, onChange }: { name: string; value: string; max?: number; placeholder?: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="block">
      <span className={label}>{name}</span>
      <input
        className={field}
        value={text}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onChange(text)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

/**
 * Texto com destaque visual: o usuário escreve normalmente e clica nas
 * palavras que quer em destaque (itálico serifado na cor da marca). Por baixo
 * isso vira a marcação que o renderer entende — ninguém precisa digitar asteriscos.
 */
function RichField({ name, value, max, onChange }: { name: string; value: string; max?: number; onChange: (v: string) => void }) {
  const tokens = toTokens(value);
  const plain = tokens.map((t) => t.text).join(" ");
  const [text, setText] = useState(plain);
  useEffect(() => setText(plain), [plain]);
  const accent = useEditor((s) => s.project!.brand.primaryColor);

  const commitText = () => {
    if (text.trim() === plain || !text.trim()) return setText(plain);
    const emph = new Set(tokens.filter((t) => t.emph).map((t) => t.text.toLowerCase()));
    onChange(
      fromTokens(
        text
          .replace(/\*/g, "")
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => ({ text: w, emph: emph.has(w.toLowerCase()) })),
      ),
    );
  };

  return (
    <div>
      <span className={label}>{name}</span>
      <input className={field} value={text} maxLength={max ? max - 4 : undefined} onChange={(e) => setText(e.target.value)} onBlur={commitText} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      {tokens.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="emphasis">
          <span className="mr-0.5 text-[10px] text-zinc-500">Destaque:</span>
          {tokens.map((t, i) => (
            <button
              key={`${i}-${t.text}`}
              type="button"
              aria-pressed={t.emph}
              title={t.emph ? "Tirar o destaque" : "Destacar esta palavra"}
              onClick={() => onChange(fromTokens(tokens.map((x, j) => (j === i ? { ...x, emph: !x.emph } : x))))}
              className={`rounded-md border px-1.5 py-0.5 text-[12px] transition ${t.emph ? "border-transparent font-semibold italic" : "border-line text-zinc-300 hover:border-zinc-500"}`}
              style={t.emph ? { background: `${accent}26`, color: accent, fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 14 } : undefined}
            >
              {t.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lista de itens (degraus, itens de lista, barras): um cartão por item, com adicionar e remover. */
function ListField(props: { name: string; schema: JsonSchema; labels: Record<string, string>; items: Record<string, unknown>[]; onChange: (v: unknown) => void }) {
  const { schema, items, onChange, labels } = props;
  const fields = Object.entries(schema.items?.properties ?? {}).filter(([k]) => k !== "at");
  const min = schema.minItems ?? 1;
  const max = schema.maxItems ?? 8;
  const blank = () => Object.fromEntries(fields.map(([k, p]) => [k, p.type === "number" ? 0 : "Novo item"]));
  return (
    <div>
      <span className={label}>
        {props.name} <span className="text-zinc-600">({items.length} de {max})</span>
      </span>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-line bg-ink-900/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/8 text-[10px] font-semibold text-zinc-300">{i + 1}</span>
              <button
                className="text-zinc-500 transition hover:text-rose-300 disabled:opacity-30"
                disabled={items.length <= min}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remover item ${i + 1}`}
                title={items.length <= min ? `Mínimo de ${min}` : "Remover"}
              >
                <Icon.x size={14} />
              </button>
            </div>
            <div className="space-y-2">
              {fields.map(([key, prop]) => (
                <Field key={key} name={labels[key] ?? key} schema={prop} labels={labels} value={item[key]} onChange={(v) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: v } : it)))} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-1.5 text-xs text-zinc-400 transition hover:border-brand-400 hover:text-white disabled:opacity-30"
        disabled={items.length >= max}
        onClick={() => onChange([...items, blank()])}
      >
        <Icon.plus size={13} /> Adicionar item
      </button>
    </div>
  );
}

function TextList({ name, items, min, max, onChange }: { name: string; items: string[]; min: number; max: number; onChange: (v: unknown) => void }) {
  return (
    <div>
      <span className={label}>{name}</span>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1.5">
            <input className={field} defaultValue={item} key={`${i}-${item}`} onBlur={(e) => e.target.value !== item && onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className={iconBtn} disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remover">
              <Icon.x size={14} />
            </button>
          </div>
        ))}
      </div>
      <button className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-1.5 text-xs text-zinc-400 hover:text-white disabled:opacity-30" disabled={items.length >= max} onClick={() => onChange([...items, "Novo item"])}>
        <Icon.plus size={13} /> Adicionar
      </button>
    </div>
  );
}

function ColorField({ label: name, value, fallback, onChange }: { label: string; value?: string; fallback: string; onChange: (v: string | null) => void }) {
  return (
    <div className="text-center">
      <label className="relative block h-9 cursor-pointer overflow-hidden rounded-lg border border-line" style={{ background: value ?? fallback }} title={`${name}: ${value ?? "cor da marca"}`}>
        <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={value ?? fallback} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={name} />
      </label>
      <span className="mt-1 block text-[10px] text-zinc-500">{name}</span>
      {value && (
        <button className="text-[10px] text-zinc-500 underline-offset-2 hover:text-white hover:underline" onClick={() => onChange(null)}>
          usar a da marca
        </button>
      )}
    </div>
  );
}

// ---------- Zoom ----------

const ZOOM_PRESETS: { name: string; hint: string; patch: Update }[] = [
  { name: "Punch-in", hint: "corte seco na ênfase", patch: { mode: "hold", ease: 0, scale: 1.2, panX: 0, panY: 0 } },
  { name: "Avanço lento", hint: "aproxima devagar", patch: { mode: "creep", scale: 1.15, panX: 0, panY: 0 } },
  { name: "Suave", hint: "entra e sai macio", patch: { mode: "hold", ease: 0.4, scale: 1.18, panX: 0, panY: 0 } },
  { name: "Pan à esquerda", hint: "abre espaço à direita", patch: { mode: "hold", ease: 0.35, scale: 1.3, panX: -0.12 } },
  { name: "Pan à direita", hint: "abre espaço à esquerda", patch: { mode: "hold", ease: 0.35, scale: 1.3, panX: 0.12 } },
];

function ZoomEditor({ clip, update }: { clip: ZoomClip; update: (p: Update) => void }) {
  return (
    <>
      <div className={group}>
        <h3 className={groupTitle}>Estilo de movimento</h3>
        <div className="grid grid-cols-2 gap-2">
          {ZOOM_PRESETS.map((p) => (
            <button key={p.name} onClick={() => update(p.patch)} className="rounded-xl border border-line bg-ink-900/60 px-3 py-2 text-left transition hover:border-amber-300/60">
              <span className="block text-xs font-medium text-zinc-100">{p.name}</span>
              <span className="block text-[10.5px] text-zinc-500">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={group}>
        <h3 className={groupTitle}>Ajuste fino</h3>
        <Slider label="Aproximação" value={clip.scale} min={1} max={2.5} step={0.01} format={(v) => `${v.toFixed(2)}×`} onCommit={(scale) => update({ scale })} />
        <Slider label="Foco horizontal" value={clip.x} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(x) => update({ x })} />
        <Slider label="Foco vertical" value={clip.y} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(y) => update({ y })} />
        <Slider label="Suavização" value={clip.ease} min={0} max={1.5} step={0.05} format={(v) => (v === 0 ? "corte seco" : `${v.toFixed(2)}s`)} onCommit={(ease) => update({ ease })} />
        <label className="block text-xs text-zinc-400">
          Curva do movimento
          <select className="mt-1 w-full rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 text-xs text-zinc-100" value={clip.easing} onChange={(e) => update({ easing: e.target.value as ZoomClip["easing"] })}>
            <option value="swift">Decidida (cubic-bezier)</option>
            <option value="ease_out">Suave (ease-out)</option>
            <option value="spring">Mola física (spring)</option>
          </select>
        </label>
        <p className="text-[11px] leading-relaxed text-zinc-500">{clip.follow ? "Este zoom acompanha o sujeito detectado. Mexer no foco passa a fixá-lo num ponto." : "Foco fixo num ponto do quadro."}</p>
        <Slider label="Deslocamento lateral" value={clip.panX} min={-0.5} max={0.5} step={0.01} format={(v) => (v === 0 ? "centro" : v < 0 ? `${Math.round(-v * 100)}% esq.` : `${Math.round(v * 100)}% dir.`)} onCommit={(panX) => update({ panX })} />
      </div>
    </>
  );
}

// ---------- Clip de vídeo: volume e velocidade ----------

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

function MediaEditor({ clip, update }: { clip: MediaClip; update: (p: Update) => void }) {
  const apply = useEditor((s) => s.apply);
  const speed = hasSpeed(clip) ? rateAverage(clip) : 1;
  const ramp = (rate: number) => {
    // A rampa vale para o trecho de origem deste clip; a duração na timeline acompanha.
    if (!apply([{ op: "speed_ramp", start: clip.start, duration: clip.duration, rate }])) useEditor.getState().select(null);
  };
  return (
    <>
      <div className={group}>
        <Slider label="Volume" value={clip.volume} min={0} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(volume) => update({ volume })} />
      </div>
      <div className={group} data-testid="speed-editor">
        <h3 className={groupTitle}>
          <Icon.clock size={12} /> Velocidade
        </h3>
        <div className="grid grid-cols-5 gap-1.5">
          {SPEEDS.map((v) => (
            <button
              key={v}
              aria-pressed={!clip.speedRamp && Math.abs(speed - v) < 0.01}
              onClick={() => update({ speed: v })}
              className={`rounded-lg border px-1 py-1.5 text-[11.5px] font-medium transition ${!clip.speedRamp && Math.abs(speed - v) < 0.01 ? "border-brand-400 bg-brand-500/15 text-white" : "border-line bg-ink-900/60 text-zinc-300 hover:border-line-strong"}`}
            >
              {v}×
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => ramp(0.5)} className="rounded-xl border border-line bg-ink-900/60 px-3 py-2 text-left transition hover:border-brand-400/60" data-testid="ramp-slow">
            <span className="block text-xs font-medium text-zinc-100">Rampa: câmera lenta</span>
            <span className="block text-[10.5px] text-zinc-500">entra em 1×, segura 0,5×, volta</span>
          </button>
          <button onClick={() => ramp(1.8)} className="rounded-xl border border-line bg-ink-900/60 px-3 py-2 text-left transition hover:border-brand-400/60" data-testid="ramp-fast">
            <span className="block text-xs font-medium text-zinc-100">Rampa: acelerar</span>
            <span className="block text-[10.5px] text-zinc-500">entra em 1×, segura 1,8×, volta</span>
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          {clip.speedRamp ? `Rampa ativa (${clip.speedRamp.map((p) => `${p.rate}×`).join(" → ")}): ` : ""}
          {sourceSpan(clip).toFixed(1)}s do vídeo original em {clip.duration.toFixed(1)}s na timeline. O áudio acompanha, com transição suave.
        </p>
      </div>
      <div className={group}>
        <p className="text-[11px] leading-relaxed text-zinc-500">Arraste o clip para movê-lo (pode deixar lacunas ou soltar entre dois clips). Arraste as bordas para encurtar ou recuperar material. “Dividir aqui” separa em dois.</p>
      </div>
    </>
  );
}

// ---------- Som e impacto ----------

function SfxEditor({ clip, update }: { clip: SfxClip; update: (p: Update) => void }) {
  return (
    <div className={group}>
      <label className="block text-xs text-zinc-400">
        Som
        <select className="mt-1 w-full rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 text-xs text-zinc-100" value={clip.sfx} onChange={(e) => update({ sfx: e.target.value })}>
          {Object.keys(SFX_CATALOG).map((id) => (
            <option key={id} value={id}>
              {id.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Volume" value={clip.volume} min={0} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(volume) => update({ volume })} />
      <Num label="Pico em (s)" value={clip.start} min={0} max={36000} step={0.05} onCommit={(start) => update({ start })} />
      <p className="text-[11px] leading-relaxed text-zinc-500">O pico do som cai exatamente neste instante. Arraste o bloco na timeline para sincronizar com um corte ou um impacto.</p>
    </div>
  );
}

function ImpactEditor({ clip, update }: { clip: ImpactClip; update: (p: Update) => void }) {
  const kinds = [
    { id: "both" as const, name: "Flash + tremida" },
    { id: "flash" as const, name: "Só flash" },
    { id: "shake" as const, name: "Só tremida" },
  ];
  return (
    <div className={group}>
      <div className="grid grid-cols-3 gap-1.5">
        {kinds.map((k) => (
          <button key={k.id} aria-pressed={clip.kind === k.id} onClick={() => update({ kind: k.id })} className={`rounded-lg border px-1 py-1.5 text-[11px] font-medium transition ${clip.kind === k.id ? "border-orange-300 bg-orange-400/15 text-white" : "border-line bg-ink-900/60 text-zinc-300"}`}>
            {k.name}
          </button>
        ))}
      </div>
      <Slider label="Intensidade" value={clip.intensity} min={0.1} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(intensity) => update({ intensity })} />
    </div>
  );
}

// ---------- Mídia de contexto ----------

function BrollEditor({ clip, update }: { clip: BrollClip; update: (p: Update) => void }) {
  const asset = useEditor((s) => s.project!.assets[clip.assetId]);
  const layouts = [
    { id: "full" as const, name: "Tela cheia", hint: "cobre o vídeo; sua voz continua" },
    { id: "card" as const, name: "Cartão", hint: "em cima, com você visível embaixo" },
  ];
  const room = asset && asset.kind !== "image" ? Math.max(0, asset.duration - clip.duration) : 0;
  return (
    <>
      <div className={group}>
        <h3 className={groupTitle}>Como aparece</h3>
        <div className="grid grid-cols-2 gap-2">
          {layouts.map((l) => (
            <button
              key={l.id}
              onClick={() => update({ layout: l.id })}
              aria-pressed={clip.layout === l.id}
              className={`rounded-xl border px-3 py-2 text-left transition ${clip.layout === l.id ? "border-rose-300/70 bg-rose-400/10" : "border-line bg-ink-900/60 hover:border-rose-300/40"}`}
            >
              <span className="block text-xs font-medium text-zinc-100">{l.name}</span>
              <span className="block text-[10.5px] text-zinc-500">{l.hint}</span>
            </button>
          ))}
        </div>
        {room > 0.2 && <Slider label="Começar do segundo" value={clip.sourceStart} min={0} max={room} step={0.1} format={(v) => `${v.toFixed(1)}s`} onCommit={(sourceStart) => update({ sourceStart })} />}
        <p className="text-[11px] leading-relaxed text-zinc-500">O áudio é sempre o da sua fala. Arraste as bordas do bloco na timeline para mudar quanto tempo a mídia fica na tela.</p>
        {asset?.credit && (
          <p className="text-[11px] text-zinc-500">
            Mídia de{" "}
            <a href={asset.credit.url} target="_blank" rel="noreferrer" className="text-zinc-300 underline-offset-2 hover:underline">
              {asset.credit.author ? `${asset.credit.author} · ` : ""}
              {asset.credit.provider}
            </a>
          </p>
        )}
      </div>
    </>
  );
}

// ---------- Legenda ----------

function CaptionEditor({ wordIds, text, hidden, shift, doubtful }: { wordIds: string[]; text: string; hidden: boolean; shift: number; doubtful: string[] }) {
  const apply = useEditor((s) => s.apply);
  const project = useEditor((s) => s.project);
  const unsure = doubtful.length && project ? timelineWords(project).filter((w) => doubtful.includes(w.id)).map((w) => w.text.replace(/[^\p{L}\p{N}-]/gu, "")) : [];
  const [value, setValue] = useState(text);
  useEffect(() => setValue(text), [text]);
  const run = (op: Omit<Extract<OperationInput, { op: "edit_caption" }>, "op" | "wordIds">) => {
    if (!apply([{ op: "edit_caption", wordIds, ...op }])) useEditor.getState().selectCaption(wordIds);
  };
  return (
    <>
      {unsure.length > 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-[11.5px] leading-snug text-amber-100" data-testid="caption-doubt">
          A transcrição não teve certeza de <b className="font-semibold">{unsure.map((u) => `“${u}”`).join(", ")}</b>. Ouça o trecho: se estiver certo, confirme; se não, corrija o texto abaixo.
          <button className="mt-2 block w-full rounded-md bg-amber-400/20 px-2 py-1.5 font-medium text-amber-50 transition hover:bg-amber-400/30" onClick={() => apply([{ op: "review_words", wordIds: doubtful }])} data-testid="caption-confirm">
            Está certo
          </button>
        </div>
      )}
      <div className={group}>
        <label className="block">
          <span className={label}>Texto da legenda</span>
          <textarea
            className={`${field} h-20 resize-none`}
            value={value}
            data-testid="caption-text"
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => value.trim() && value.trim() !== text && run({ text: value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <p className="text-[11px] leading-relaxed text-zinc-500">Corrige o que aparece na tela; a fala do vídeo não muda. No vídeo, arraste a legenda para cima ou para baixo e dê duplo clique para reescrever.</p>
      </div>
      <div className={group}>
        <Slider label="Adiantar / atrasar" value={shift} min={-2} max={2} step={0.05} format={(v) => (v === 0 ? "no tempo da fala" : `${v > 0 ? "+" : ""}${v.toFixed(2)}s`)} onCommit={(s) => run({ shift: s })} />
      </div>
      <div className="p-4">
        <button
          className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${hidden ? "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10" : "border-rose-500/25 text-rose-300 hover:bg-rose-500/10"}`}
          onClick={() => run({ hidden: !hidden })}
          data-testid="caption-hide"
        >
          {hidden ? <Icon.eye size={14} /> : <Icon.eyeOff size={14} />} {hidden ? "Mostrar esta legenda de novo" : "Remover esta legenda"}
        </button>
      </div>
    </>
  );
}

// ---------- Campos numéricos ----------

function Num(props: { label: string; value: number; min: number; max: number; step: number; onCommit: (n: number) => void; allowEmpty?: boolean }) {
  return (
    <label className="block">
      <span className={label}>{props.label}</span>
      <input
        type="number"
        className={field}
        key={props.value}
        defaultValue={Number.isFinite(props.value) ? props.value : ""}
        min={props.min}
        max={props.max}
        step={props.step}
        onBlur={(e) => {
          if (e.target.value === "" && props.allowEmpty) return props.onCommit(NaN);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== props.value) props.onCommit(Math.min(props.max, Math.max(props.min, n)));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

/** Controle deslizante que só grava no histórico ao soltar. */
function Slider(props: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onCommit: (n: number) => void }) {
  const [live, setLive] = useState(props.value);
  useEffect(() => setLive(props.value), [props.value]);
  const commit = () => live !== props.value && props.onCommit(live);
  return (
    <label className="block">
      <span className={`${label} flex justify-between`}>
        {props.label} <span className="font-mono text-zinc-300">{props.format(live)}</span>
      </span>
      <input type="range" className="w-full" min={props.min} max={props.max} step={props.step} value={live} onChange={(e) => setLive(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </label>
  );
}
