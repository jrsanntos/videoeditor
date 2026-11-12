"use client";

import { useEffect, useRef, useState } from "react";
import { PRICING, projectDuration } from "@videoeditor/core";
import { closeProject, importVideo, logout, refreshMe } from "@/lib/actions";
import { downloadBlob, exportInBrowser } from "@/lib/export";
import { loadMedia } from "@/lib/media";
import { hydrateEditor, useEditor } from "@/lib/store";
import { ChatPanel } from "./ChatPanel";
import { Player, togglePlay } from "./Player";
import { Sidebar } from "./Sidebar";
import { deleteSelection, splitAtPlayhead, Timeline } from "./Timeline";

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
        // O JSON da edição sobrevive, mas sem o arquivo bruto não há o que exibir.
        if (missing.length) useEditor.getState().setProject(null);
      }
      setReady(true);
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
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelection();
      else if (e.key === "Escape") (s.setRange(null), s.select(null));
      else if (e.key === "ArrowLeft") s.seek(s.time - (e.shiftKey ? 1 : 1 / s.project.fps));
      else if (e.key === "ArrowRight") s.seek(s.time + (e.shiftKey ? 1 : 1 / s.project.fps));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <div className="flex h-screen items-center justify-center text-sm text-zinc-600">Carregando…</div>;
  if (!project) return <UploadScreen />;

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col bg-zinc-900/40">
          <Player />
        </main>
        <ChatPanel />
      </div>
      <Timeline />
      <Notice />
    </div>
  );
}

function UploadScreen() {
  const busy = useEditor((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (file?: File | null) => file && void importVideo(file);

  return (
    <div className="relative flex h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="absolute right-4 top-3">
        <UserMenu />
      </div>
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white">Envie o vídeo bruto. Diga o que quer.</h1>
        <p className="mt-3 text-zinc-400">
          A IA corta silêncios e erros, aplica zooms, legendas e motion graphics. Você ajusta o que quiser na timeline, sem
          gastar créditos.
        </p>
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
        className={`flex h-56 w-full max-w-xl flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition ${
          over ? "border-indigo-400 bg-indigo-500/10" : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500"
        }`}
      >
        <span className="text-lg font-medium text-zinc-100">{busy ?? "Arraste um vídeo ou clique para escolher"}</span>
        <span className="text-sm text-zinc-500">MP4, MOV ou WebM · o arquivo fica no seu navegador</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        data-testid="file-input"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Notice />
    </div>
  );
}

function TopBar() {
  const project = useEditor((s) => s.project)!;
  const credits = useEditor((s) => s.credits);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { undo, redo } = useEditor.getState();
  const btn = "rounded-md px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4">
      <span className="text-sm font-semibold text-white">videoeditor</span>
      <span className="truncate text-sm text-zinc-500">{project.name}</span>
      <div className="ml-2 flex">
        <button className={btn} onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
          ↶
        </button>
        <button className={btn} onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
          ↷
        </button>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <a href="/planos" className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-600" title="Saldo de créditos da sua conta. Clique para ver planos e comprar créditos.">
          <b className="text-amber-300" data-testid="credits">{credits}</b> créditos
        </a>
        <button
          className={btn}
          onClick={() => {
            if (confirm("Fechar este projeto? O vídeo e a edição salvos neste navegador serão removidos.")) void closeProject();
          }}
        >
          Novo
        </button>
        <ExportMenu />
        <UserMenu />
      </div>
    </header>
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
        className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        aria-label="Conta"
        title={user.email}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-sm shadow-2xl">
          <div className="px-3 py-2">
            <div className="truncate font-medium text-zinc-100">{user.name}</div>
            <div className="truncate text-xs text-zinc-500">{user.email}</div>
            <div className="mt-1 text-xs text-zinc-400">Plano {user.planName ?? user.plan}</div>
          </div>
          <a href="/planos" className="block rounded-lg px-3 py-2 text-zinc-200 hover:bg-zinc-800">
            Planos e créditos
          </a>
          {user.role === "admin" && (
            <a href="/admin" className="block rounded-lg px-3 py-2 text-zinc-200 hover:bg-zinc-800">
              Painel de administração
            </a>
          )}
          <button onClick={() => void logout()} className="block w-full rounded-lg px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800">
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

  const run = async () => {
    const { project, setNotice, setPlaying } = useEditor.getState();
    if (!project) return;
    setOpen(false);
    setPlaying(false);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const { blob, extension } = await exportInBrowser(project, setProgress, abort.current.signal);
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
        className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
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
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Exportar
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl">
          <button onClick={run} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-800" data-testid="export-browser">
            <span className="block text-sm text-zinc-100">Renderizar no navegador</span>
            <span className="block text-xs text-emerald-400">Grátis · usa o hardware do seu computador</span>
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
      className="fixed bottom-72 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-xl"
      data-testid="notice"
    >
      {notice}
    </div>
  );
}
