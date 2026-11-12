"use client";

import { useEffect, useState } from "react";
import { creditCost, FONT_PAIRS, FORMATS, mainClips, PLANS, type AspectRatio, type BrandKit, type EditTemplate, type FontPairId } from "@videoeditor/core";
import { COMPONENTS } from "@videoeditor/renderer";
import { applyTemplate, autoClean, deleteBrand, removeSilencesLocally, saveBrand, toggleCaptions } from "@/lib/actions";
import { useEditor } from "@/lib/store";
import { Icon, ToggleRow } from "./ui";

const section = "border-b border-line px-4 py-4";
const heading = "mb-3 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500";
const btn =
  "w-full rounded-lg border border-line bg-ink-850 px-3 py-2 text-left text-xs text-zinc-200 transition hover:border-line-strong hover:bg-ink-800 disabled:opacity-40";
const field = "w-full rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition focus:border-brand-400";

/** Ícone e uma linha de explicação para cada componente do menu. */
const MOTION_HINT: Record<string, string> = {
  depth_hook_title: "Título gigante atrás de você",
  kinetic_pivot_card: "Frase que vira conclusão",
  step_progress: "Etapas subindo em escada",
  acronym_list: "Lista ao lado, item a item",
  executive_lower_third: "Seu nome e cargo",
  stat_counter: "Número com contador",
};

export function Sidebar() {
  const project = useEditor((s) => s.project)!;
  const busy = useEditor((s) => s.busy);
  const apply = useEditor((s) => s.apply);
  const width = useEditor((s) => s.layout.left);
  const asset = project.assets[mainClips(project)[0]?.assetId ?? ""];
  const hasTranscript = Boolean(asset?.transcript?.words.length);
  const ingestCost = asset ? creditCost({ type: "ingest", durationSec: asset.duration }) : 0;
  const caps = project.captions;
  const credits = (n: number) => `${n} ${n === 1 ? "crédito" : "créditos"}`;

  const addComponent = (id: string) => {
    const def = COMPONENTS[id]!;
    const { time } = useEditor.getState();
    // A tarja usa o nome e a credencial do Brand Kit quando eles existem.
    const usesBrand = (id === "lower_third" || id === "executive_lower_third") && project.brand.displayName;
    const before = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    if (apply([{ op: "add_component", component: id, start: time, duration: def.defaultDuration, params: usesBrand ? {} : (def.example as Record<string, unknown>) }])) return;
    // Já abre o editor do componente recém-criado.
    const created = useEditor.getState().project!.tracks.flatMap((t) => t.clips).find((c) => !before.has(c.id));
    if (created) {
      useEditor.getState().select(created.id);
      // Avança o cursor até depois da animação de entrada: o componente já aparece no vídeo.
      useEditor.getState().seek(created.start + Math.min(1.2, created.duration / 2));
    }
  };

  return (
    <aside className="flex shrink-0 flex-col overflow-y-auto bg-ink-900" style={{ width }}>
      <div className={section}>
        <h3 className={heading}>
          <Icon.bolt size={12} /> Automações
        </h3>
        <div className="space-y-2">
          <button
            className="btn-brand group w-full rounded-xl px-3.5 py-3 text-left disabled:opacity-50"
            disabled={!!busy}
            onClick={() => {
              const s = useEditor.getState();
              if (s.tour === 0) s.setTour(1);
              void autoClean();
            }}
            data-tour="clean"
            data-testid="auto-clean"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Icon.wand size={16} /> Limpeza automática
            </span>
            <span className="mt-1 block text-[11.5px] leading-snug text-white/85">Remove erros de gravação e retira pausas, deixando profissional e limpo.</span>
            {!hasTranscript && <span className="mt-1.5 inline-block rounded-md bg-black/25 px-1.5 py-0.5 text-[10.5px] text-white/90">inclui a transcrição · {credits(ingestCost)}</span>}
          </button>
          <button className={btn} disabled={!!busy} onClick={removeSilencesLocally} data-testid="remove-silences">
            <span className="flex items-center gap-2 font-medium">
              <Icon.scissors size={14} className="text-zinc-400" /> Remover silêncios
            </span>
            <span className="mt-1 block text-[11px] leading-snug text-zinc-500">Corta o vídeo nas pausas de fala, facilitando a edição manual. Grátis.</span>
          </button>
        </div>
      </div>

      <div className={section}>
        <h3 className={heading}>
          <Icon.captions size={12} /> Legendas
        </h3>
        <ToggleRow
          label="Legendas no vídeo"
          hint={hasTranscript ? "Aparecem na timeline: clique numa para editar, mover ou remover." : `Transcreve a fala ao ligar · ${credits(ingestCost)}`}
          checked={caps.enabled}
          disabled={!!busy}
          onChange={(v) => void toggleCaptions(v)}
          testid="captions-toggle"
        />
        {caps.enabled && hasTranscript && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select className={field} value={caps.style.preset} aria-label="Estilo da legenda" onChange={(e) => apply([{ op: "set_captions", style: { preset: e.target.value as "bold" } }])}>
              <option value="karaoke">Karaokê</option>
              <option value="bold">Negrito</option>
              <option value="clean">Limpa</option>
            </select>
            <select className={field} value={caps.style.y !== undefined ? "custom" : caps.style.position} aria-label="Posição da legenda" onChange={(e) => e.target.value !== "custom" && apply([{ op: "set_captions", style: { position: e.target.value as "top" } }])}>
              <option value="bottom">Embaixo</option>
              <option value="center">Centro</option>
              <option value="top">Topo</option>
              {caps.style.y !== undefined && <option value="custom">Posição livre</option>}
            </select>
            <label className="col-span-2 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
              Palavras por vez
              <input type="range" min={1} max={8} value={caps.style.maxWords} className="w-32" onChange={(e) => apply([{ op: "set_captions", style: { maxWords: Number(e.target.value) } }])} />
              <span className="w-3 font-mono text-zinc-300">{caps.style.maxWords}</span>
            </label>
          </div>
        )}
      </div>

      <div className={section}>
        <h3 className={heading}>
          <Icon.layers size={12} /> Motion design
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(COMPONENTS)
            .filter((c) => c.agent !== false)
            .map((c) => (
              <button key={c.id} title={c.description} onClick={() => addComponent(c.id)} className="rounded-xl border border-line bg-ink-850 px-2.5 py-2 text-left transition hover:border-emerald-400/50 hover:bg-ink-800">
                <span className="block text-[11.5px] font-medium leading-tight text-zinc-100">{c.name}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">{MOTION_HINT[c.id] ?? ""}</span>
              </button>
            ))}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">Mais componentes</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.values(COMPONENTS)
              .filter((c) => c.agent === false)
              .map((c) => (
                <button key={c.id} title={c.description} onClick={() => addComponent(c.id)} className="rounded-lg border border-line bg-ink-850 px-2 py-1.5 text-left text-[11px] text-zinc-300 transition hover:border-emerald-400/50">
                  {c.name}
                </button>
              ))}
          </div>
        </details>
        <button
          className={`${btn} mt-2 flex items-center gap-2`}
          onClick={() => {
            const { time } = useEditor.getState();
            apply([{ op: "add_zoom", start: time, duration: 3 }]);
          }}
        >
          <Icon.zoomIn size={14} className="text-amber-300" /> Zoom no cursor
        </button>
        <p className="mt-2 text-[10.5px] leading-snug text-zinc-600">Entram onde está o cursor da timeline. Clique no bloco criado para editar.</p>
      </div>

      <Frame />

      <Brand />

      <Templates />
    </aside>
  );
}

type PublishedTemplate = { id: string; data: EditTemplate; thumbnail: string | null };

/** Modelos de edição publicados pelo admin, extraídos de vídeos de exemplo. */
function Templates() {
  const busy = useEditor((s) => s.busy);
  const [templates, setTemplates] = useState<PublishedTemplate[] | null>(null);
  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates: PublishedTemplate[] }) => setTemplates(d.templates))
      .catch(() => setTemplates([]));
  }, []);
  if (!templates?.length) return null;
  return (
    <div className={section} data-testid="templates">
      <h3 className={heading}>Modelos de edição</h3>
      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="overflow-hidden rounded-md border border-line bg-ink-900">
            {t.thumbnail && <img src={t.thumbnail} alt="" className="aspect-video w-full object-cover opacity-80" />}
            <div className="p-2">
              <div className="text-xs font-medium text-zinc-100">{t.data.name}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{t.data.description}</p>
              <button
                className="mt-2 w-full rounded btn-brand px-2 py-1.5 text-[11px] font-medium disabled:opacity-40"
                disabled={!!busy}
                title="Aplica o estilo com o Diretor de IA"
                onClick={() => void applyTemplate(t.data)}
              >
                Aplicar modelo
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SWATCHES: { key: "primaryColor" | "secondaryColor" | "backgroundColor" | "textColor"; label: string }[] = [
  { key: "primaryColor", label: "Destaque" },
  { key: "secondaryColor", label: "Apoio" },
  { key: "backgroundColor", label: "Fundo" },
  { key: "textColor", label: "Texto" },
];

/** Formato do quadro, reenquadramento do vídeo de origem, áreas seguras e efeitos sonoros. */
function Frame() {
  const project = useEditor((s) => s.project)!;
  const guides = useEditor((s) => s.guides);
  const apply = useEditor((s) => s.apply);
  const asset = project.assets[mainClips(project)[0]?.assetId ?? ""];
  // Só há o que reenquadrar quando a origem é mais larga (ou mais alta) que o quadro.
  const srcRatio = asset?.width && asset.height ? asset.width / asset.height : null;
  const frameRatio = project.width / project.height;
  const cropsX = srcRatio !== null && srcRatio > frameRatio + 0.01;
  const cropsY = srcRatio !== null && srcRatio < frameRatio - 0.01;

  return (
    <div className={section} data-testid="frame">
      <h3 className={heading}>
        <Icon.frame size={12} /> Quadro
      </h3>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(FORMATS) as AspectRatio[]).map((ratio) => (
            <button
              key={ratio}
              title={FORMATS[ratio].name}
              aria-pressed={project.aspectRatio === ratio}
              className={`rounded-lg border px-2 py-2 text-xs transition ${project.aspectRatio === ratio ? "border-brand-400 bg-brand-500/15 font-medium text-white" : "border-line bg-ink-850 text-zinc-300 hover:border-line-strong"}`}
              onClick={() => apply([{ op: "set_format", aspectRatio: ratio }])}
            >
              {ratio === "9:16" ? "Vertical 9:16" : "Horizontal 16:9"}
            </button>
          ))}
        </div>
        {(cropsX || cropsY) && (
          <label className="block text-xs text-zinc-400">
            Enquadramento ({cropsX ? "esquerda ↔ direita" : "cima ↔ baixo"})
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              className="mt-1 w-full"
              defaultValue={cropsX ? project.framing.x : project.framing.y}
              key={`${project.aspectRatio}-${cropsX}`}
              onPointerUp={(e) => apply([{ op: "set_format", framing: cropsX ? { x: Number(e.currentTarget.value) } : { y: Number(e.currentTarget.value) } }])}
              onKeyUp={(e) => apply([{ op: "set_format", framing: cropsX ? { x: Number(e.currentTarget.value) } : { y: Number(e.currentTarget.value) } }])}
              aria-label="Enquadramento do vídeo no quadro"
            />
          </label>
        )}
        <ToggleRow label="Áreas seguras" hint={project.aspectRatio === "9:16" ? "Onde ficam os botões de Reels, TikTok e Shorts." : undefined} checked={guides} onChange={(v) => useEditor.setState({ guides: v })} />
        <ToggleRow label="Efeitos sonoros automáticos" hint="Sons discretos nos zooms e nas entradas de texto." checked={project.sfx.enabled} onChange={(v) => apply([{ op: "set_format", sfx: { enabled: v } }])} />
      </div>
    </div>
  );
}

/**
 * Brand Kit: definido uma vez, salvo na conta e herdado pelos próximos vídeos.
 * No plano Pro a conta guarda vários (um por cliente) e o seletor troca o do projeto.
 */
function Brand() {
  const brand = useEditor((s) => s.project!.brand);
  const brands = useEditor((s) => s.brands);
  const limit = useEditor((s) => s.brandLimit);
  const apply = useEditor((s) => s.apply);
  // Kit em edição: um salvo, ou null quando é um novo ainda não salvo.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const current = brands.find((b) => b.id === currentId) ?? null;
  const [draft, setDraft] = useState<BrandKit>(brand);
  const [name, setName] = useState("Minha marca");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Ao carregar a conta, o kit do projeto é o salvo que tem os mesmos valores (ou o primeiro).
  useEffect(() => {
    if (currentId && brands.some((b) => b.id === currentId)) return;
    const match = brands.find((b) => JSON.stringify(b.brand) === JSON.stringify(brand)) ?? brands[0];
    setCurrentId(match?.id ?? null);
    if (match) setName(match.name);
    else setOpen(true);
  }, [brands, currentId, brand]);
  useEffect(() => setDraft(brand), [brand]);

  const dirty = !current || name !== current.name || JSON.stringify(draft) !== JSON.stringify(current.brand);
  const notice = (text: string) => useEditor.getState().setNotice(text);
  const canAdd = brands.length < limit;

  return (
    <div className={section} data-testid="brand">
      <button className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h3 className={`${heading} mb-0`}>
          <Icon.palette size={12} /> Sua marca
        </h3>
        <span className="flex items-center gap-1">
          {SWATCHES.slice(0, 3).map((sw) => (
            <span key={sw.key} className="h-3 w-3 rounded-full border border-white/20" style={{ background: brand[sw.key] }} />
          ))}
        </span>
      </button>
      <div className="mt-3">
        <ToggleRow
          label="Tarja de nome e cargo"
          hint={brand.showLowerThird ? "Seu nome e registro podem aparecer no vídeo." : "Desligada: nome e cargo não aparecem no vídeo."}
          checked={brand.showLowerThird}
          onChange={(v) => apply([{ op: "set_brand", brand: { showLowerThird: v } }])}
          testid="lower-third-toggle"
        />
      </div>
      {open && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void saveBrand(current?.id ?? null, name.trim() || "Minha marca", draft).then((r) => {
              setBusy(false);
              if (r.id) setCurrentId(r.id);
              notice(r.error ?? "Marca salva. Os próximos vídeos já nascem com ela.");
            });
          }}
        >
          {!brands.length && <p className="text-[11px] leading-snug text-zinc-500">Defina uma vez: cores, fontes e sua credencial entram sozinhas em todo vídeo.</p>}
          {(brands.length > 1 || limit > 1) && (
            <label className="block text-xs text-zinc-400">
              Brand Kit ({brands.length} de {limit})
              <select
                className={`${field} mt-1`}
                value={currentId ?? "new"}
                data-testid="brand-select"
                onChange={(e) => {
                  const next = brands.find((b) => b.id === e.target.value);
                  if (next) {
                    setCurrentId(next.id);
                    setName(next.name);
                    apply([{ op: "set_brand", brand: next.brand }]);
                  } else {
                    // Kit novo: parte do atual, com nome próprio; só conta no limite ao salvar.
                    setCurrentId(null);
                    setName("");
                  }
                }}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                {(canAdd || !current) && <option value="new">+ Novo Brand Kit…</option>}
              </select>
            </label>
          )}
          {limit > 1 && (
            <label className="block text-xs text-zinc-400">
              Nome do kit (cliente)
              <input className={`${field} mt-1`} maxLength={40} required placeholder="Clínica Silva" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="block text-xs text-zinc-400">
            Nome na tarja
            <input className={`${field} mt-1`} maxLength={40} placeholder="Dra. Ana Silva" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
          </label>
          <label className="block text-xs text-zinc-400">
            Registro ou cargo
            <input className={`${field} mt-1`} maxLength={60} placeholder="CRM 12345" value={draft.credential} onChange={(e) => setDraft({ ...draft, credential: e.target.value })} />
          </label>
          <div className="grid grid-cols-4 gap-2">
            {SWATCHES.map((sw) => (
              <label key={sw.key} className="block text-center text-[10px] text-zinc-500">
                <input
                  type="color"
                  className="h-8 w-full cursor-pointer rounded border border-line bg-ink-900"
                  value={draft[sw.key]}
                  onChange={(e) => setDraft({ ...draft, [sw.key]: e.target.value.toUpperCase() })}
                  aria-label={sw.label}
                />
                {sw.label}
              </label>
            ))}
          </div>
          <label className="block text-xs text-zinc-400">
            Fontes
            <select className={`${field} mt-1`} value={draft.fontPair} onChange={(e) => setDraft({ ...draft, fontPair: e.target.value as FontPairId })}>
              {(Object.keys(FONT_PAIRS) as FontPairId[]).map((id) => (
                <option key={id} value={id}>
                  {FONT_PAIRS[id].name}
                </option>
              ))}
            </select>
          </label>
          <button className={btn} disabled={busy || !dirty}>
            {busy ? "Salvando…" : current ? "Salvar marca" : "Salvar novo Brand Kit"}
          </button>
          {current && brands.length > 1 && (
            <button
              type="button"
              className="w-full rounded-md border border-rose-900/60 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Apagar o Brand Kit "${current.name}"? Os vídeos já editados não mudam.`)) return;
                void deleteBrand(current.id).then((error) => {
                  if (error) notice(error);
                  else setCurrentId(null);
                });
              }}
            >
              Apagar este kit
            </button>
          )}
          {limit === 1 && (
            <p className="text-[11px] leading-snug text-zinc-500">
              Edita para vários clientes?{" "}
              <a href="/planos" className="text-zinc-300 underline-offset-2 hover:underline">
                O plano {PLANS.pro.name} salva até {PLANS.pro.brandKits} Brand Kits.
              </a>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
