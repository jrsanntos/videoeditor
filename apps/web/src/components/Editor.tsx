"use client";

import { useEffect, useRef, useState } from "react";
import { formatCredits, PLANS, PRICING, projectDuration, type PlanId } from "@videoeditor/core";
import { closeProject, importVideo, logout, refreshMe, resumePending, startEmptyProject } from "@/lib/actions";
import { downloadBlob, exportInBrowser, exportOTIO } from "@/lib/export";
import { loadMedia } from "@/lib/media";
import { hydrateEditor, useEditor } from "@/lib/store";
import { ChatPanel } from "./ChatPanel";
import { Inspector } from "./Inspector";
import { Player, togglePlay } from "./Player";
import { Sidebar } from "./Sidebar";
import { addMarkerAtPlayhead, deleteSelection, splitAtPlayhead, Timeline } from "./Timeline";
import { Assistant } from "./Assistant";
import { Tour } from "./Tour";
import { Icon, Logo, ResizeHandle } from "./ui";

export function Editor() {
  const project = useEditor((s) => s.project);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = hydrateEditor();
    void refreshMe();
    const p = useEditor.getState().project;
    void (async () => {
      if (p) {
        const missing = await loadMedia(Object.keys(p.assets));
        // O JSON da edição sobrevive, mas sem o arquivo bruto de um clip da timeline não há o que exibir.
        const used = new Set(p.tracks.flatMap((t) => t.clips).flatMap((c) => (c.type === "media" || c.type === "broll" ? [c.assetId] : [])));
        if (missing.some((id) => used.has(id))) useEditor.getState().setProject(null);
      }
      setReady(true);
      // Vídeo enviado na página inicial antes do cadastro: entra agora, já com a conta.
      await resumePending();
    })();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      const s = useEditor.getState();
      if (!s.project) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") togglePlay();
      else if (mod && e.key.toLowerCase() === "z") (e.shiftKey ? s.redo : s.undo)();
      else if (mod && e.key.toLowerCase() === "y") s.redo();
      else if (!mod && e.key.toLowerCase() === "s") splitAtPlayhead();
      else if (!mod && e.key.toLowerCase() === "m") addMarkerAtPlayhead();
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelection(e.shiftKey);
      else if (e.key === "Escape") (s.setRange(null), s.select(null), s.tour !== null && s.setTour(null));
      else if (e.key === "ArrowLeft") s.seek(s.time - (e.shiftKey ? 1 : 1 / s.project.fps));
      else if (e.key === "ArrowRight") s.seek(s.time + (e.shiftKey ? 1 : 1 / s.project.fps));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready)
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="shimmer h-1 w-40 rounded-full" />
      </div>
    );
  if (!project) return <UploadScreen />;
  const { resize, resetLayout } = useEditor.getState();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <ResizeHandle axis="x" label="Largura do painel de ferramentas" onDrag={(d) => resize("left", d)} onReset={() => resetLayout("left")} />
        <main className="flex min-w-0 flex-1">
          <Inspector />
          <div className="flex min-w-0 flex-1 flex-col">
            <Player />
          </div>
        </main>
        <ResizeHandle axis="x" label="Largura do Diretor de IA" onDrag={(d) => resize("right", -d)} onReset={() => resetLayout("right")} />
        <ChatPanel />
      </div>
      <Timeline />
      <Notice />
      <Assistant />
      <Tour />
      <SmallScreen />
    </div>
  );
}

function UploadScreen() {
  const busy = useEditor((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [reference, setReference] = useState("");
  const pick = (file?: File | null) => file && void importVideo(file, { referenceUrl: reference });
  const steps = [
    { icon: <Icon.wand size={16} />, title: "Limpeza automática", text: "Erros de gravação, muletas e pausas saem em um clique." },
    { icon: <Icon.sparkles size={16} />, title: "Diretor de IA", text: "Analisa o vídeo, planeja o ritmo e monta a edição." },
    { icon: <Icon.download size={16} />, title: "Ajuste e exporte", text: "Edite na timeline de graça e exporte no navegador." },
  ];

  return (
    <div className="stage-bg relative flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-5">
        <a href="/" aria-label="Página inicial">
          <Logo />
        </a>
        <UserMenu />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
        <div className="max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Envie o vídeo bruto. <span className="text-gradient">A IA dirige a edição.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-400">Cortes, zooms, legendas e motion design montados a partir da sua fala. Você ajusta o que quiser na timeline, sem gastar créditos.</p>
        </div>
        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files[0]);
          }}
          disabled={!!busy}
          className={`group flex h-60 w-full max-w-2xl flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed transition ${
            over ? "border-brand-400 bg-brand-500/15" : "border-line-strong bg-white/[0.02] hover:border-brand-400/70 hover:bg-brand-500/[0.06]"
          }`}
        >
          <span className="btn-brand flex h-14 w-14 items-center justify-center rounded-2xl transition group-hover:scale-105">
            <Icon.film size={24} />
          </span>
          <span className="text-lg font-medium text-zinc-100">{busy ?? "Arraste um vídeo ou clique para escolher"}</span>
          <span className="text-sm text-zinc-500">MP4, MOV ou WebM · o arquivo fica no seu navegador</span>
        </button>
        <input ref={input} type="file" accept="video/*" className="hidden" data-testid="file-input" onChange={(e) => pick(e.target.files?.[0])} />
        <div className="-mt-3 flex items-center gap-3 text-[13px] text-zinc-500">
          <span className="h-px w-10 bg-line-strong" />
          ou
          <span className="h-px w-10 bg-line-strong" />
        </div>
        <button
          type="button"
          className="-mt-3 flex items-center gap-2 rounded-xl border border-line-strong bg-white/[0.04] px-5 py-2.5 text-[14px] font-medium text-zinc-100 transition hover:border-brand-400/60 hover:bg-white/[0.08]"
          onClick={() => void startEmptyProject()}
          disabled={!!busy}
          data-testid="skip-upload"
        >
          <Icon.scissors size={15} /> Abrir o editor sem vídeo
        </button>
        <label className="-mt-2 block w-full max-w-2xl text-left">
          <span className="text-[12px] text-zinc-400">
            Link do YouTube de inspiração <span className="text-zinc-600">(opcional)</span> — a IA lê título, capítulos, legendas e a capa para seguir o estilo. Para medir o ritmo de cortes de verdade, envie o arquivo da referência na aba Mídia.
          </span>
          <input
            type="url"
            inputMode="url"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            data-testid="reference-url"
            className="mt-1.5 w-full rounded-xl border border-line bg-ink-900/70 px-3.5 py-2.5 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
          />
        </label>
        <ol className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="panel rounded-2xl p-4">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-zinc-100">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">{s.icon}</span>
                {i + 1}. {s.title}
              </span>
              <p className="mt-2 text-[12px] leading-snug text-zinc-500">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
      <Notice />
    </div>
  );
}

function TopBar() {
  const project = useEditor((s) => s.project)!;
  const credits = useEditor((s) => s.credits);
  const unlimited = useEditor((s) => s.unlimited);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-ink-900 px-4">
      <a href="/" aria-label="Página inicial" className="shrink-0">
        <Logo size={24} />
      </a>
      <span className="h-5 w-px bg-line" />
      <span className="truncate text-[13px] text-zinc-400">{project.name}</span>
      <span className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">{project.aspectRatio}</span>
      <div className="ml-auto flex items-center gap-2.5">
        <a href="/planos" className="flex items-center gap-1.5 rounded-full border border-line bg-ink-850 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-line-strong" title="Saldo de créditos da sua conta. Clique para ver planos e comprar créditos.">
          <Icon.bolt size={13} className="text-amber-300" />
          <b className="font-semibold text-white" data-testid="credits">
            {unlimited ? "Ilimitado" : formatCredits(credits)}
          </b>
          {unlimited ? "· admin" : "créditos"}
        </a>
        <button
          className="rounded-lg px-2.5 py-1.5 text-[13px] text-zinc-300 transition hover:bg-white/8 hover:text-white"
          onClick={() => {
            if (confirm("Fechar este projeto? O vídeo e a edição salvos neste navegador serão removidos.")) void closeProject();
          }}
        >
          Novo projeto
        </button>
        <Shortcuts />
        <ExportMenu />
        <UserMenu />
      </div>
    </header>
  );
}

/** O editor precisa de tela larga: em celular, avisa em vez de mostrar uma interface espremida. */
function SmallScreen() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-ink-950/95 p-8 text-center backdrop-blur min-[900px]:hidden">
      <Logo />
      <h2 className="text-xl font-semibold text-white">O editor funciona melhor no computador</h2>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-400">A timeline e os painéis precisam de uma tela maior. Abra o videoeditor num notebook ou desktop para editar; seu vídeo fica salvo neste navegador.</p>
      <button className="rounded-xl border border-line-strong px-4 py-2.5 text-sm text-zinc-200" onClick={() => setDismissed(true)}>
        Continuar mesmo assim
      </button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Espaço", "Reproduzir / pausar"],
  ["S", "Dividir no cursor"],
  ["M", "Marcador no cursor"],
  ["Delete", "Cortar o trecho ou apagar fechando o buraco (ripple)"],
  ["Shift + Delete", "Apagar o clip e deixar a lacuna"],
  ["Alt + arrastar", "Mover um clip de vídeo por qualquer ponto"],
  ["Ctrl + Z", "Desfazer"],
  ["Ctrl + Shift + Z", "Refazer"],
  ["← →", "Um quadro para trás / para frente"],
  ["Shift + ← →", "Um segundo para trás / para frente"],
  ["Esc", "Soltar a seleção"],
];

/** Atalhos e gestos do editor, num cartão de ajuda. */
function Shortcuts() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-semibold text-zinc-400 transition hover:bg-white/8 hover:text-white" aria-label="Atalhos e dicas" title="Atalhos e dicas" data-testid="shortcuts">
        ?
      </button>
      {open && (
        <div className="pop-in absolute right-0 top-10 z-50 w-80 rounded-xl border border-line-strong bg-ink-800 p-4 text-[12.5px] shadow-2xl">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Atalhos</p>
          <dl className="space-y-1.5">
            {SHORTCUTS.map(([key, what]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <dd className="text-zinc-300">{what}</dd>
                <dt className="shrink-0 rounded-md border border-line-strong bg-ink-900 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-200">{key}</dt>
              </div>
            ))}
          </dl>
          <p className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Com o mouse</p>
          <ul className="space-y-1.5 text-zinc-300">
            <li>Clique na timeline: marca um instante e oferece “Dividir aqui”.</li>
            <li>Arraste na timeline: seleciona um trecho para cortar ou mandar à IA.</li>
            <li>Barra do nome de um clip de vídeo: arraste para mover; pode deixar lacunas ou soltar entre dois clips.</li>
            <li>Mídia da aba Mídia: arraste para a trilha de vídeo (insere e empurra) ou para cima (sobrepõe).</li>
            <li>Clique num bloco: abre o editor dele ao lado do vídeo.</li>
            <li>No vídeo: arraste um texto para mover; duplo clique para reescrever.</li>
            <li>Bordas entre os painéis: arraste para redimensionar.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const user = useEditor((s) => s.user);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-sky-brand text-sm font-semibold text-white ring-2 ring-white/10 transition hover:ring-white/30"
        aria-label="Conta"
        title={user.email}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-60 pop-in rounded-xl border border-line-strong bg-ink-800 p-2 text-sm shadow-2xl">
          <div className="px-3 py-2">
            <div className="truncate font-medium text-zinc-100">{user.name}</div>
            <div className="truncate text-xs text-zinc-500">{user.email}</div>
            <div className="mt-1 text-xs text-zinc-400">Plano {user.planName ?? user.plan}</div>
          </div>
          <a href="/planos" className="block rounded-lg px-3 py-2 text-zinc-200 hover:bg-white/8">
            Planos e créditos
          </a>
          {user.role === "admin" && (
            <a href="/admin" className="block rounded-lg px-3 py-2 text-zinc-200 hover:bg-white/8">
              Painel de administração
            </a>
          )}
          <button onClick={() => void logout()} className="block w-full rounded-lg px-3 py-2 text-left text-zinc-200 hover:bg-white/8">
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 0));
  const cloudCost = Math.max(1, Math.ceil((duration / 60) * PRICING.cloudExportPerMinute));
  const plan = useEditor((s) => PLANS[(s.user?.plan ?? "free") as PlanId] ?? PLANS.free);

  const run = async () => {
    const { project, setNotice, setPlaying } = useEditor.getState();
    if (!project) return;
    setOpen(false);
    setPlaying(false);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const { blob, extension } = await exportInBrowser(project, setProgress, abort.current.signal, {
        maxShortSide: plan.maxExportHeight,
        watermark: plan.watermark,
      });
      downloadBlob(blob, `${project.name}${extension}`);
      setNotice(`Exportado no seu navegador (${(blob.size / 1e6).toFixed(1)} MB) — 0 créditos.`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNotice((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  if (progress !== null)
    return (
      <button
        onClick={() => abort.current?.abort()}
        className="rounded-lg border border-brand-500/40 bg-brand-500/15 px-3 py-1.5 text-[13px] font-medium text-brand-300"
        title="Clique para cancelar"
        data-testid="export-progress"
      >
        Exportando {Math.round(progress * 100)}% ✕
      </button>
    );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-brand flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
        data-tour="export"
      >
        <Icon.download size={14} /> Exportar
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 pop-in rounded-xl border border-line-strong bg-ink-800 p-2 shadow-2xl">
          <button onClick={run} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/8" data-testid="export-browser">
            <span className="block text-sm text-zinc-100">Renderizar no navegador</span>
            <span className="block text-xs text-emerald-400">Grátis · usa o hardware do seu computador</span>
            {plan.watermark && <span className="mt-0.5 block text-xs text-zinc-500">Plano Free: sai em {plan.maxExportHeight}p com marca d'água</span>}
          </button>
          <button
            onClick={() => {
              const { project, setNotice } = useEditor.getState();
              if (!project) return;
              setOpen(false);
              downloadBlob(exportOTIO(project), `${project.name}.otio`);
              setNotice("Timeline exportada em OpenTimelineIO (.otio): abra no DaVinci Resolve, Premiere ou outro editor e religue a mídia.");
            }}
            className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/8"
            data-testid="export-otio"
          >
            <span className="block text-sm text-zinc-100">Timeline para outro editor (.otio)</span>
            <span className="block text-xs text-zinc-400">OpenTimelineIO: clips, lacunas, velocidades e marcadores</span>
          </button>
          <div className="rounded-lg px-3 py-2 opacity-50" aria-disabled>
            <span className="block text-sm text-zinc-100">Render turbo na nuvem</span>
            <span className="block text-xs text-amber-400">{cloudCost} créditos · em breve</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Notice() {
  const notice = useEditor((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => useEditor.getState().setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  if (!notice) return null;
  return (
    <div
      role="status"
      className="pop-in fixed left-1/2 top-16 z-[60] max-w-lg -translate-x-1/2 rounded-xl border border-line-strong bg-ink-800/95 px-4 py-2.5 text-[13px] text-zinc-100 shadow-2xl backdrop-blur"
      data-testid="notice"
    >
      {notice}
    </div>
  );
}
