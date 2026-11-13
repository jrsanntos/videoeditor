"use client";

import { useEffect, useRef, useState } from "react";
import { clipEnd, contextAssets, mainClips, type Asset } from "@videoeditor/core";
import { addMainVideo, attachStyleReference, attachStyleReferenceFile, contextThumb, describeContextAsset, ensureContextThumb, insertBroll, insertOnMain, removeContextAsset, removeStyleReference, searchStock, uploadContextFiles, importStockItem, type StockItem } from "@/lib/actions";
import { ASSET_DND } from "./Timeline";
import { useEditor } from "@/lib/store";
import { Icon } from "./icons";

const heading = "mb-3 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500";
const field = "w-full rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-brand-400";

/**
 * Mídia de contexto (b-roll): vídeos e imagens que cobrem trechos da fala.
 * Vêm do computador do usuário ou de bancos gratuitos (Pexels e Pixabay).
 */
export function MediaPanel() {
  const project = useEditor((s) => s.project)!;
  const busy = useEditor((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const assets = contextAssets(project);
  const mainInput = useRef<HTMLInputElement>(null);
  const mains = Object.values(project.assets).filter((a) => a.role !== "context" && a.kind === "video");

  return (
    <div>
      <div className="border-b border-line px-4 py-4" data-testid="main-media">
        <h3 className={heading}>
          <Icon.film size={12} /> Vídeos da timeline
        </h3>
        <button onClick={() => mainInput.current?.click()} disabled={!!busy} data-testid="main-upload" className="flex w-full items-center gap-2.5 rounded-xl border border-line-strong px-3 py-2.5 text-left transition hover:border-brand-400/70 hover:bg-brand-500/[0.06] disabled:opacity-50">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
            <Icon.plus size={16} />
          </span>
          <span>
            <span className="block text-[12.5px] font-medium text-zinc-100">Adicionar vídeo à timeline</span>
            <span className="block text-[11px] leading-snug text-zinc-500">Entra no fim da trilha de vídeo. Depois é só arrastar para onde quiser.</span>
          </span>
        </button>
        <input ref={mainInput} type="file" accept="video/*" className="hidden" data-testid="main-input" onChange={(e) => e.target.files?.[0] && (void addMainVideo(e.target.files[0]), (e.target.value = ""))} />
        {mains.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {mains.map((a) => (
              <li
                key={a.id}
                draggable
                onDragStart={(e) => (e.dataTransfer.setData(ASSET_DND, a.id), (e.dataTransfer.effectAllowed = "copy"))}
                className="flex cursor-grab items-center gap-2 rounded-lg border border-line bg-ink-850 px-2.5 py-1.5 active:cursor-grabbing"
                title="Arraste para a timeline: na trilha de vídeo insere entre os clipes; numa trilha de cima, sobrepõe"
              >
                <Icon.move size={12} className="shrink-0 text-zinc-500" />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-200">{a.name}</span>
                <span className="font-mono text-[10px] text-zinc-500">{a.duration.toFixed(0)}s</span>
                <button className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-brand-300 hover:bg-brand-500/15" onClick={() => insertOnMain(a.id, useEditor.getState().time)} title="Insere no cursor: entre dois clipes abre espaço; numa lacuna, encaixa">
                  No cursor
                </button>
                <button className="rounded-md px-1.5 py-0.5 text-[10.5px] text-zinc-400 hover:bg-white/8" onClick={() => insertOnMain(a.id, mainClips(project).reduce((m, c) => Math.max(m, clipEnd(c)), 0))} title="Põe de novo no fim da trilha">
                  No fim
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <StyleReference />
      <div className="border-b border-line px-4 py-4">
        <h3 className={heading}>
          <Icon.film size={12} /> Seus vídeos de contexto
        </h3>
        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void uploadContextFiles(e.dataTransfer.files);
          }}
          disabled={!!busy}
          data-testid="context-upload"
          className={`flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-5 text-center transition disabled:opacity-50 ${over ? "border-brand-400 bg-brand-500/15" : "border-line-strong hover:border-brand-400/70 hover:bg-brand-500/[0.06]"}`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300">
            <Icon.plus size={18} />
          </span>
          <span className="text-[12.5px] font-medium text-zinc-100">Enviar vídeos ou imagens</span>
          <span className="text-[11px] leading-snug text-zinc-500">Cenas de apoio, prints, fotos de produto. Arraste aqui ou clique.</span>
        </button>
        <input ref={input} type="file" accept="video/*,image/*" multiple className="hidden" data-testid="context-input" onChange={(e) => e.target.files && (void uploadContextFiles(e.target.files), (e.target.value = ""))} />
        {assets.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="context-list">
            {assets.map((a) => (
              <ContextItem key={a.id} asset={a} />
            ))}
          </ul>
        )}
        {assets.length > 0 && <p className="mt-2 text-[10.5px] leading-snug text-zinc-600">Descreva o que cada mídia mostra: é assim que o Diretor de IA sabe onde usá-la.</p>}
      </div>
      <StockSearch vertical={project.aspectRatio === "9:16"} />
    </div>
  );
}

function ContextItem({ asset }: { asset: Asset }) {
  const [thumb, setThumb] = useState(contextThumb(asset.id));
  const [desc, setDesc] = useState(asset.description ?? "");
  useEffect(() => {
    if (!thumb) void ensureContextThumb(asset.id, asset.kind).then(setThumb);
  }, [asset.id, asset.kind, thumb]);
  return (
    <li
      className="cursor-grab rounded-xl border border-line bg-ink-850 p-2 active:cursor-grabbing"
      draggable
      onDragStart={(e) => (e.dataTransfer.setData(ASSET_DND, asset.id), (e.dataTransfer.effectAllowed = "copy"))}
      title="Arraste para a timeline: numa trilha de cima sobrepõe (b-roll); na trilha de vídeo, insere entre os clipes"
    >
      <div className="flex gap-2.5">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-700">
          {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
          {asset.kind === "video" && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white">{asset.duration.toFixed(0)}s</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-zinc-100" title={asset.name}>
            {asset.name}
          </div>
          {asset.credit && (
            <a href={asset.credit.url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-zinc-500 hover:text-zinc-300">
              {asset.credit.author ? `${asset.credit.author} · ` : ""}
              {asset.credit.provider}
            </a>
          )}
          <div className="mt-1.5 flex gap-1.5">
            <button className="btn-brand rounded-md px-2 py-1 text-[11px] font-semibold" onClick={() => insertBroll(asset.id)} data-testid="context-insert" title="Põe no vídeo a partir do cursor da timeline">
              Inserir no cursor
            </button>
            <button className="rounded-md px-1.5 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-300" onClick={() => removeContextAsset(asset.id)} aria-label={`Remover ${asset.name}`} title="Remover do projeto">
              <Icon.trash size={13} />
            </button>
          </div>
        </div>
      </div>
      <input className={`${field} mt-2`} placeholder="O que aparece aqui? Ex.: pessoa treinando na academia" maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (asset.description ?? "") && describeContextAsset(asset.id, desc)} />
    </li>
  );
}

/**
 * Referência de inspiração para o Diretor replicar o estilo neste vídeo:
 * um arquivo (ritmo medido de verdade) ou um link do YouTube (ritmo estimado
 * pelos metadados, legendas e capa — o vídeo não é baixado).
 */
function StyleReference() {
  const ref = useEditor((s) => s.project?.styleReference);
  const busy = useEditor((s) => s.busy);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = async () => {
    if (!url.trim() || loading) return;
    setLoading(true);
    const error = await attachStyleReference(url.trim());
    setLoading(false);
    if (!error) setUrl("");
  };
  return (
    <div className="border-b border-line px-4 py-4" data-testid="style-reference">
      <h3 className={heading}>
        <Icon.sparkles size={12} /> Inspiração (opcional)
      </h3>
      {ref ? (
        <div className="rounded-xl border border-brand-500/30 bg-brand-500/[0.07] p-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {ref.url.startsWith("arquivo:") ? (
                <span className="block truncate text-[12px] font-medium text-zinc-100" title={ref.title}>
                  {ref.title || "Arquivo de referência"}
                </span>
              ) : (
                <a href={ref.url} target="_blank" rel="noreferrer" className="block truncate text-[12px] font-medium text-zinc-100 hover:underline" title={ref.title}>
                  {ref.title || "Vídeo do YouTube"}
                </a>
              )}
              <p className="truncate text-[10.5px] text-zinc-500">{ref.channel}</p>
            </div>
            <button className="rounded-md p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300" onClick={removeStyleReference} aria-label="Remover a referência" title="Remover a referência">
              <Icon.x size={13} />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-300">
            {ref.pacing.cutsPerMin ? `${ref.url.startsWith("arquivo:") ? "" : "~"}${ref.pacing.cutsPerMin} cortes/min${ref.url.startsWith("arquivo:") ? " (medido)" : " (estimado)"}` : "ritmo"} · energia {ref.pacing.energy}
            {ref.pacing.wordsPerMin ? ` · ${ref.pacing.wordsPerMin} palavras/min` : ""}
          </p>
          {ref.palette.length > 0 && (
            <div className="mt-1.5 flex gap-1">
              {ref.palette.map((c) => (
                <span key={c} className="h-4 w-4 rounded border border-white/15" style={{ background: c }} title={c} />
              ))}
            </div>
          )}
          {ref.typography && <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-500">{ref.typography}</p>}
          <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-600">O Diretor de IA vai replicar esse ritmo e esse visual na próxima edição. Fontes: {ref.sources.join(", ") || "metadados"}.</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <p className="text-[11px] leading-snug text-zinc-400">Um vídeo cujo estilo você quer seguir. O Diretor de IA copia o ritmo e o visual, nunca o conteúdo.</p>
          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            className="hidden"
            data-testid="reference-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void attachStyleReferenceFile(f);
            }}
          />
          <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()} className="mt-2 w-full rounded-lg border border-line-strong bg-white/[0.04] px-3 py-2 text-left text-xs font-medium text-zinc-100 transition hover:bg-white/8 disabled:opacity-40">
            Enviar o vídeo de referência
            <span className="mt-0.5 block text-[10.5px] font-normal text-zinc-500">Mais preciso: medimos os cortes, as pausas e a fala no seu computador; o arquivo não sobe.</span>
          </button>
          <label className="mt-3 block text-[11px] leading-snug text-zinc-400">
            Ou um link do YouTube
            <input className={`${field} mt-1.5`} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" data-testid="reference-input" />
          </label>
          <p className="mt-1 text-[10.5px] leading-snug text-zinc-600">Pelo link lemos título, capítulos, legendas e a capa: o ritmo de cortes é uma estimativa.</p>
          <button type="submit" disabled={!url.trim() || loading} className="mt-2 w-full rounded-lg bg-white/8 px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-white/12 disabled:opacity-40">
            {loading ? "Analisando a referência…" : "Usar o link como inspiração"}
          </button>
        </form>
      )}
    </div>
  );
}

function StockSearch({ vertical }: { vertical: boolean }) {
  const busy = useEditor((s) => s.busy);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"video" | "image">("video");
  const [state, setState] = useState<{ loading: boolean; items: StockItem[]; error?: string; searched?: string }>({ loading: false, items: [] });

  const run = async (term = q, k = kind) => {
    if (term.trim().length < 2) return;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const r = await searchStock(term.trim(), k, vertical ? "portrait" : "landscape");
    setState({ loading: false, items: r.items, error: r.error, searched: term.trim() });
  };

  return (
    <div className="px-4 py-4">
      <h3 className={heading}>
        <Icon.sparkles size={12} /> Bancos gratuitos
      </h3>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input className={field} placeholder="Ex.: academia, médico, cidade à noite" value={q} onChange={(e) => setQ(e.target.value)} data-testid="stock-query" />
        <button className="btn-brand shrink-0 rounded-lg px-3 text-xs font-semibold" disabled={state.loading || q.trim().length < 2}>
          Buscar
        </button>
      </form>
      <div className="mt-2 flex gap-1 rounded-lg border border-line bg-ink-900 p-0.5">
        {(["video", "image"] as const).map((k) => (
          <button key={k} onClick={() => (setKind(k), void run(q, k))} className={`flex-1 rounded-md py-1 text-[11.5px] transition ${kind === k ? "bg-brand-500 font-medium text-white" : "text-zinc-400 hover:text-white"}`}>
            {k === "video" ? "Vídeos" : "Fotos"}
          </button>
        ))}
      </div>
      {state.loading && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`shimmer rounded-lg ${vertical ? "aspect-[9/14]" : "aspect-video"}`} />
          ))}
        </div>
      )}
      {state.error && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-snug text-amber-200" role="alert" data-testid="stock-error">
          {state.error}
        </p>
      )}
      {!state.loading && !state.error && state.searched && state.items.length === 0 && <p className="mt-3 text-[11.5px] text-zinc-500">Nada encontrado para “{state.searched}”. Tente outra palavra, de preferência em inglês.</p>}
      {!state.loading && state.items.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2" data-testid="stock-results">
          {state.items.map((item) => (
            <li key={item.id}>
              <button
                disabled={!!busy}
                onClick={() => void importStockItem(item, state.searched ?? q)}
                title={`Usar no vídeo · ${item.author ? `${item.author} · ` : ""}${item.provider === "pexels" ? "Pexels" : "Pixabay"}`}
                className={`group relative block w-full overflow-hidden rounded-lg bg-ink-700 ring-1 ring-white/10 transition hover:ring-2 hover:ring-brand-400 disabled:opacity-50 ${vertical ? "aspect-[9/14]" : "aspect-video"}`}
              >
                {item.thumb && <img src={item.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-[9.5px] text-white">
                  <span className="truncate">{item.provider === "pexels" ? "Pexels" : "Pixabay"}</span>
                  {item.kind === "video" && <span className="font-mono">{Math.round(item.duration)}s</span>}
                </span>
                <span className="absolute inset-0 flex items-center justify-center bg-brand-600/70 text-[11.5px] font-semibold text-white opacity-0 transition group-hover:opacity-100">+ Usar no vídeo</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10.5px] leading-snug text-zinc-600">
        Vídeos e fotos de{" "}
        <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="text-zinc-400 underline-offset-2 hover:underline">
          Pexels
        </a>{" "}
        e{" "}
        <a href="https://pixabay.com" target="_blank" rel="noreferrer" className="text-zinc-400 underline-offset-2 hover:underline">
          Pixabay
        </a>
        , livres para uso comercial. O crédito do autor fica guardado no projeto.
      </p>
    </div>
  );
}
