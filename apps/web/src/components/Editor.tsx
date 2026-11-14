"use client";

import { useEffect, useRef, useState } from "react";
import { formatCredits, PLANS, PRICING, projectDuration, type PlanId } from "@videoeditor/core";
import { checkMedia, closeProject, deleteSavedProject, importVideo, listProjects, logout, openProject, refreshMe, relinkMedia, resumePending, startEmptyProject, type ProjectSummary } from "@/lib/actions";
import { downloadBlob, exportInBrowser, exportOTIO } from "@/lib/export";
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
  const missing = useEditor((s) => s.missingMedia);
  const [ready, setReady] = useState(false);
  const [small, setSmall] = useSmallScreen();

  useEffect(() => {
    const unsubscribe = hydrateEditor();
    void refreshMe();
    const p = useEditor.getState().project;
    void (async () => {
      // Arquivo bruto que não está neste navegador: a edição continua aqui e o editor pede para religá-lo.
      if (p) await checkMedia(p);
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
  if (missing.length) return <RelinkScreen />;
  if (small) return <MobileEditor onFull={() => setSmall(false)} />;
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
        <ProjectList />
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

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const when = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Projetos salvos na conta: abrir de onde parou, em qualquer aparelho. */
function ProjectList() {
  const busy = useEditor((s) => s.busy);
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    void listProjects().then((l) => setList(l ?? []));
  }, []);
  if (!list?.length) return null;
  return (
    <section className="w-full max-w-2xl" aria-label="Seus projetos" data-testid="project-list">
      <h2 className="text-[13px] font-semibold text-zinc-200">Seus projetos</h2>
      <p className="mt-0.5 text-[12px] text-zinc-500">A edição fica salva na sua conta. O arquivo de vídeo fica no navegador em que você enviou.</p>
      <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {list.map((p) => (
          <li key={p.id} className="panel flex items-center gap-3 rounded-xl px-3.5 py-2.5">
            <button className="min-w-0 flex-1 text-left disabled:opacity-50" disabled={!!busy} onClick={() => void openProject(p.id)} data-testid="project-open">
              <span className="block truncate text-[13.5px] font-medium text-zinc-100">{p.name}</span>
              <span className="block text-[11.5px] text-zinc-500">
                {clock(p.duration)} · editado em {when(p.updatedAt)}
              </span>
            </button>
            <button
              className="shrink-0 rounded-lg px-2 py-1.5 text-[12px] text-zinc-500 transition hover:bg-white/8 hover:text-rose-300"
              disabled={!!busy}
              aria-label={`Apagar o projeto ${p.name}`}
              onClick={async () => {
                if (!confirm(`Apagar o projeto "${p.name}"? A edição salva na conta e o vídeo guardado neste navegador serão removidos. Isso não pode ser desfeito.`)) return;
                const error = await deleteSavedProject(p.id);
                if (error) useEditor.getState().setNotice(error);
                else setList((l) => (l ?? []).filter((x) => x.id !== p.id));
              }}
            >
              Apagar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Projeto aberto num navegador que não tem os arquivos de vídeo (outro
 * aparelho, ou dados do navegador apagados): a edição está inteira, e basta
 * escolher de novo os mesmos arquivos.
 */
function RelinkScreen() {
  const project = useEditor((s) => s.project)!;
  const missing = useEditor((s) => s.missingMedia);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  return (
    <div className="stage-bg flex min-h-screen flex-col" data-testid="relink">
      <header className="flex h-14 items-center justify-between px-5">
        <a href="/" aria-label="Página inicial">
          <Logo />
        </a>
        <UserMenu />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="max-w-xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Escolha de novo o vídeo deste projeto</h1>
          <p className="mx-auto mt-3 text-[14.5px] leading-relaxed text-zinc-400">
            A edição de <b className="font-semibold text-zinc-200">{project.name}</b> está salva na sua conta, mas o arquivo de vídeo não está neste navegador (ele não sobe para o servidor). Escolha o mesmo arquivo e tudo volta como estava.
          </p>
        </div>
        <ul className="w-full max-w-xl space-y-2">
          {missing.map((id) => {
            const asset = project.assets[id];
            if (!asset) return null;
            return (
              <li key={id} className="panel flex items-center gap-3 rounded-xl px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-zinc-100">{asset.name}</span>
                  <span className="block text-[11.5px] text-zinc-500">{asset.kind === "image" ? "imagem" : clock(asset.duration)}</span>
                </span>
                <label className={`btn-brand shrink-0 cursor-pointer rounded-lg px-3.5 py-2 text-[13px] font-semibold ${working ? "pointer-events-none opacity-60" : ""}`}>
                  {working === id ? "Conferindo…" : "Escolher arquivo"}
                  <input
                    type="file"
                    accept={asset.kind === "image" ? "image/*" : asset.kind === "audio" ? "audio/*,video/*" : "video/*"}
                    className="hidden"
                    data-testid="relink-input"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setError(null);
                      setWorking(id);
                      setError(await relinkMedia(id, file));
                      setWorking(null);
                    }}
                  />
                </label>
              </li>
            );
          })}
        </ul>
        {error && (
          <p className="max-w-xl rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-[13.5px] text-rose-200" role="alert">
            {error}
          </p>
        )}
        <button className="text-[13px] text-zinc-400 underline-offset-4 hover:text-white hover:underline" onClick={() => void closeProject()}>
          Voltar para os meus projetos
        </button>
      </div>
      <Notice />
    </div>
  );
}

const SYNC_LABEL = { idle: "", saving: "Salvando…", saved: "Salvo na conta", error: "Sem conexão: salvo só neste navegador" } as const;

function TopBar() {
  const project = useEditor((s) => s.project)!;
  const credits = useEditor((s) => s.credits);
  const unlimited = useEditor((s) => s.unlimited);
  const sync = useEditor((s) => s.sync);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-ink-900 px-4">
      <a href="/" aria-label="Página inicial" className="shrink-0">
        <Logo size={24} />
      </a>
      <span className="h-5 w-px bg-line" />
      <span className="truncate text-[13px] text-zinc-400">{project.name}</span>
      <span className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">{project.aspectRatio}</span>
      {sync !== "idle" && (
        <span className={`hidden shrink-0 text-[11.5px] md:inline ${sync === "error" ? "text-amber-300" : "text-zinc-500"}`} role="status" data-testid="sync">
          {SYNC_LABEL[sync]}
        </span>
      )}
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
          title="Fecha este projeto (ele fica salvo na sua conta) e mostra os seus projetos"
          onClick={() => void closeProject()}
          data-testid="projects"
        >
          Projetos
        </button>
        <Shortcuts />
        <ExportMenu />
        <UserMenu />
      </div>
    </header>
  );
}

const FULL_EDITOR_KEY = "videoeditor-full-editor";

/** Tela de celular (até 899 px): o editor abre no modo simples, a não ser que a pessoa peça o completo. */
function useSmallScreen(): [boolean, (v: boolean) => void] {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    let forced = false;
    try {
      forced = localStorage.getItem(FULL_EDITOR_KEY) === "1";
    } catch {
      // sem armazenamento: segue a tela
    }
    const update = () => setSmall(mq.matches && !forced);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const set = (v: boolean) => {
    try {
      if (!v) localStorage.setItem(FULL_EDITOR_KEY, "1");
      else localStorage.removeItem(FULL_EDITOR_KEY);
    } catch {
      // sem armazenamento: vale só nesta visita
    }
    setSmall(v);
  };
  return [small, set];
}

/**
 * Modo simples para celular: enviar, deixar a IA editar, assistir, pedir
 * ajustes por texto e exportar. A timeline e os painéis ficam no editor
 * completo (para tela grande), a um toque de distância.
 */
function MobileEditor({ onFull }: { onFull: () => void }) {
  const project = useEditor((s) => s.project)!;
  const credits = useEditor((s) => s.credits);
  const unlimited = useEditor((s) => s.unlimited);
  const busy = useEditor((s) => s.busy);
  const canUndo = useEditor((s) => s.past.length > 0);
  const [sheet, setSheet] = useState(false);
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-ink-950" data-testid="mobile-editor">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-ink-900 px-3">
        <a href="/" aria-label="Página inicial" className="shrink-0">
          <Logo size={22} />
        </a>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-400">{project.name}</span>
        <button className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] text-zinc-300" onClick={() => void closeProject()}>
          Projetos
        </button>
        <a href="/planos" className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-ink-850 px-2.5 py-1 text-[11.5px] text-zinc-300">
          <Icon.bolt size={12} className="text-amber-300" />
          <b className="font-semibold text-white">{unlimited ? "∞" : formatCredits(credits)}</b>
        </a>
        <ExportMenu />
      </header>
      <div className="flex min-h-0 flex-1">
        <Player />
      </div>
      {busy && <p className="shrink-0 truncate border-t border-line bg-ink-900 px-4 py-2 text-[12px] text-brand-300">{busy}</p>}
      <nav className="grid shrink-0 grid-cols-3 gap-2 border-t border-line bg-ink-900 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button className="flex flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] text-zinc-300 disabled:opacity-40" disabled={!canUndo || !!busy} onClick={() => useEditor.getState().undo()}>
          <Icon.undo size={18} /> Desfazer
        </button>
        <button className="btn-brand flex flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] font-semibold" onClick={() => setSheet(true)} data-testid="mobile-ai">
          <Icon.sparkles size={18} /> Pedir à IA
        </button>
        <button className="flex flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] text-zinc-300" onClick={onFull} title="Timeline e painéis completos (melhor em tela grande)">
          <Icon.scissors size={18} /> Editor completo
        </button>
      </nav>
      {sheet && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-ink-950/70 backdrop-blur-sm" role="dialog" aria-label="Diretor de IA" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="pop-in relative h-[78dvh] overflow-hidden rounded-t-3xl border-t border-line-strong bg-ink-900">
            <button className="absolute right-3 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/8" onClick={() => setSheet(false)} aria-label="Fechar">
              <Icon.x size={16} />
            </button>
            <ChatPanel fluid />
          </div>
        </div>
      )}
      <Notice />
      <Assistant />
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
