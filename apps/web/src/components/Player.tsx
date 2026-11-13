"use client";

import { useEffect, useRef, useState } from "react";
import { applyOperations, cutFadeGain, findClip, isFullscreen, localTimeAt, mainClipAt, mainClips, projectDuration, rateAt, sourceEnd, sourceTimeAt, type MediaClip, type OperationInput, type Project } from "@videoeditor/core";
import { captionGroups, COMPONENTS, needsPersonAt, plainText, renderFrame, validateComponent, validateSfx, type CaptionBox, type EditRegion } from "@videoeditor/renderer";
import { brollFrame, syncBroll } from "@/lib/broll";
import { loadProjectFonts } from "@/lib/fonts";
import { mediaUrl } from "@/lib/media";
import { getPath, reEmphasize, setPath } from "@/lib/params";
import { maskKey, personMask } from "@/lib/segmentation";
import { createMusicPlayer } from "@/lib/music";
import { createSfxPlayer } from "@/lib/sfx";
import { voiceCompressor, voiceGainNow } from "@/lib/voice";
import { useEditor } from "@/lib/store";
import { Icon } from "./ui";

export const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

// O que está desenhado no quadro atual, para clicar, arrastar e editar direto no vídeo.
const hit = { regions: [] as EditRegion[], caption: null as CaptionBox | null };

type InlineEdit =
  | { kind: "param"; clipId: string; key: string; value: string; rect: { x: number; y: number; w: number; h: number } }
  | { kind: "caption"; wordIds: string[]; value: string; rect: { x: number; y: number; w: number; h: number } };

/**
 * Preview em tempo real: dois <video> ocultos fornecem os quadros de origem e
 * o canvas é redesenhado a cada frame por `renderFrame` a partir do estado.
 * Nenhum pixel é renderizado no servidor.
 *
 * Cortes sem piscar: enquanto um vídeo toca o clip atual, o outro já está
 * parado no primeiro quadro do próximo clip. Na emenda os dois trocam de
 * papel — não há busca (seek) no meio da fala, então não há quadro preto nem
 * engasgo no áudio. Quando a troca não está pronta (salto manual), o último
 * quadro bom fica na tela até o novo chegar.
 */
export function Player() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const fontsKey = useEditor((s) => {
    const p = s.project;
    if (!p) return "";
    const ids: string[] = [p.brand.fontPair];
    for (const t of p.tracks) for (const c of t.clips) if (c.type === "component" && c.style?.fontPair) ids.push(c.style.fontPair);
    return ids.join("|");
  });
  const [edit, setEdit] = useState<InlineEdit | null>(null);

  // O canvas só usa a fonte depois de carregada; o laço de desenho pega a troca no quadro seguinte.
  useEffect(() => {
    const p = useEditor.getState().project;
    if (p) void loadProjectFonts(p);
  }, [fontsKey]);

  useEffect(() => {
    let raf = 0;
    let activeClipId: string | null = null;
    let engineTime = -1;
    let lastWall = performance.now();
    let cur = 0;
    const sfx = createSfxPlayer();
    const music = createMusicPlayer();
    // Voz no volume profissional também no preview: os dois vídeos passam por um ganho e um compressor.
    // Se o navegador não deixar montar o grafo de áudio, o som segue direto do vídeo, como antes.
    let audio: { ctx: AudioContext; gain: GainNode } | null = null;
    let audioFailed = false;
    const ensureAudio = () => {
      if (audio || audioFailed || !videoA.current || !videoB.current) return;
      try {
        const ctx = new AudioContext();
        const gain = ctx.createGain();
        const comp = voiceCompressor(ctx);
        gain.connect(comp).connect(ctx.destination);
        ctx.createMediaElementSource(videoA.current).connect(gain);
        ctx.createMediaElementSource(videoB.current).connect(gain);
        audio = { ctx, gain };
      } catch (e) {
        console.warn("acabamento de voz indisponível no preview", e);
        audioFailed = true;
      }
    };
    // Último quadro bom, mostrado enquanto um salto não termina.
    const hold = document.createElement("canvas");
    let holdValid = false;

    const ensureSrc = (video: HTMLVideoElement, assetId: string) => {
      const url = mediaUrl(assetId);
      if (url && video.dataset.asset !== assetId) {
        video.src = url;
        video.dataset.asset = assetId;
        video.dataset.clip = "";
        return true;
      }
      return false;
    };
    const snapshot = (video: HTMLVideoElement) => {
      if (video.readyState < 2 || !video.videoWidth) return;
      if (hold.width !== video.videoWidth || hold.height !== video.videoHeight) {
        hold.width = video.videoWidth;
        hold.height = video.videoHeight;
      }
      hold.getContext("2d")?.drawImage(video, 0, 0);
      holdValid = true;
    };

    const tick = (now: number) => {
      const s = useEditor.getState();
      const p = s.project;
      const vids = [videoA.current, videoB.current];
      const canvas = canvasRef.current;
      if (p && vids[0] && vids[1] && canvas) {
        let video = vids[cur]!;
        let standby = vids[1 - cur]!;
        if (canvas.width !== p.width || canvas.height !== p.height) {
          canvas.width = p.width;
          canvas.height = p.height;
        }
        const duration = projectDuration(p);
        let t = Math.min(s.time, duration);
        // Tempo alterado fora do motor (clique, edição) → ressincroniza o vídeo.
        if (t !== engineTime) activeClipId = null;

        const clip = mainClipAt(p, t) ?? (t >= duration && duration > 0 ? mainClipAt(p, duration - 0.001) : null);
        if (clip) {
          if (ensureSrc(video, clip.assetId)) activeClipId = null;
          const local = Math.min(t - clip.start, clip.duration - 0.001);
          // Com rampa de velocidade, o tempo de origem segue a curva do clip.
          const target = sourceTimeAt(clip, local);
          const rate = Math.min(4, Math.max(0.25, rateAt(clip, local)));
          for (const el of [video, standby]) {
            // Sem preservar o pitch: o som acompanha a câmera lenta, igual à exportação.
            if ("preservesPitch" in el && el.preservesPitch) el.preservesPitch = false;
          }
          if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
          if (s.playing) {
            if (clip.id !== activeClipId) {
              activeClipId = clip.id;
              const ready = standby.dataset.clip === clip.id && standby.dataset.asset === clip.assetId && standby.readyState >= 2 && !standby.seeking && Math.abs(standby.currentTime - target) < 0.12;
              if (ready) {
                // Emenda: o vídeo que já esperava no ponto certo assume, sem busca.
                snapshot(video);
                video.pause();
                cur = 1 - cur;
                [video, standby] = [standby, video];
              } else if (Math.abs(video.currentTime - target) > 0.05) {
                snapshot(video);
                video.currentTime = target;
              }
              standby.dataset.clip = "";
            } else if (!video.seeking && video.readyState >= 2) {
              video.volume = Math.min(1, clip.volume);
              ensureAudio();
              if (audio) {
                if (audio.ctx.state === "suspended") void audio.ctx.resume();
                // Micro-fade de 30 ms nas duas bordas de cada corte, também no preview.
                audio.gain.gain.value = (p.finish.voice ? voiceGainNow(clip.assetId) : 1) * cutFadeGain(local, clip.duration);
              }
              if (video.paused) void video.play().catch(() => useEditor.getState().setPlaying(false));
              // O relógio da timeline segue o relógio do vídeo (áudio sempre em sincronia).
              t = Math.min(clip.start + localTimeAt(clip, video.currentTime), clip.start + clip.duration);
            }
            // Deixa o outro vídeo parado no começo do próximo clip, pronto para a emenda.
            const next = nextClip(p, clip);
            if (next && standby.dataset.clip !== next.id && (next.assetId !== clip.assetId || Math.abs(next.sourceStart - sourceEnd(clip)) > 0.04 || next.start - (clip.start + clip.duration) > 0.04)) {
              ensureSrc(standby, next.assetId);
              if (!standby.paused) standby.pause();
              standby.currentTime = next.sourceStart;
              standby.dataset.clip = next.id;
            }
          } else {
            activeClipId = null;
            if (!video.paused) video.pause();
            if (!standby.paused) standby.pause();
            if (!video.seeking && Math.abs(video.currentTime - target) > 0.02) {
              snapshot(video);
              video.currentTime = target;
            }
          }
        } else {
          activeClipId = null;
          if (!video.paused) video.pause();
          if (s.playing) t += (now - lastWall) / 1000;
        }

        if (s.playing && t >= duration) {
          t = duration;
          video.pause();
          useEditor.setState({ playing: false });
        }
        // Efeitos sonoros: dispara os que caem entre o quadro anterior e este.
        if (s.playing && engineTime >= 0) sfx.advance(p, engineTime, t);
        music.sync(p, t, s.playing);
        if (t !== s.time) useEditor.setState({ time: t });
        engineTime = t;

        syncBroll(p, t, s.playing);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          hit.regions = [];
          hit.caption = null;
          const live = video.readyState >= 2 && !video.seeking;
          // No fim exato da timeline não há clip (o fim é exclusivo): desenha o último quadro,
          // em vez de uma tela preta com a última legenda parada.
          const drawT = duration > 0 ? Math.min(t, duration - 0.5 / p.fps) : t;
          renderFrame(
            ctx,
            p,
            drawT,
            (c) => {
              if (video.dataset.asset !== c.assetId) return null;
              if (live || (video.readyState >= 2 && !holdValid)) return { image: video, width: video.videoWidth, height: video.videoHeight };
              return holdValid ? { image: hold, width: hold.width, height: hold.height } : null;
            },
            {
              guides: s.guides,
              getBrollFrame: (c) => brollFrame(p, c),
              editClipId: s.selectedClipId,
              onRegion: (r) => hit.regions.push(r),
              onCaption: (b) => (hit.caption = b),
              editCaptionId: s.selectedCaption?.[0],
              // Segmenta só enquanto um título com profundidade está na tela.
              getPersonMask:
                live && needsPersonAt(p, t)
                  ? (c, frame) => personMask(maskKey(c.assetId, video.currentTime, p.fps), frame.image, frame.width, frame.height)
                  : undefined,
            },
          );
        }
      }
      lastWall = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      sfx.close();
      music.close();
      void audio?.ctx.close();
    };
  }, []);

  /** Posição do ponteiro em pixels do quadro do projeto. */
  const toFrame = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height, k: canvas.width / r.width };
  };
  const inside = (b: { x: number; y: number; w: number; h: number }, x: number, y: number, pad = 14) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

  const onPointerDown = (e: React.PointerEvent) => {
    if (edit) return;
    const s = useEditor.getState();
    const base = s.project;
    if (!base) return;
    const p0 = toFrame(e);
    const region = [...hit.regions].reverse().find((r) => inside(r, p0.x, p0.y));
    const caption = !region && hit.caption && inside(hit.caption, p0.x, p0.y, 4) ? hit.caption : null;
    const selected = s.selectedClipId ? findClip(base, s.selectedClipId)?.clip : null;
    // Com um componente selecionado, arrastar em qualquer ponto do vídeo move o componente.
    const clipId = region?.clipId ?? (selected?.type === "component" && !isFullscreen(selected) && !caption ? selected.id : null);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let moved = false;
    let ops: OperationInput[] | null = null;
    if (clipId && clipId !== s.selectedClipId) s.select(clipId);
    if (caption) s.selectCaption(caption.wordIds);

    const move = (ev: PointerEvent) => {
      const p1 = toFrame(ev);
      const dx = (p1.x - p0.x) / base.width;
      const dy = (p1.y - p0.y) / base.height;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      moved = true;
      if (clipId) {
        const clip = findClip(base, clipId)?.clip;
        if (!clip || clip.type !== "component") return;
        const posKey = region ? COMPONENTS[clip.component]?.positions?.[region.key] : undefined;
        if (posKey) {
          // Este texto tem posição própria (ex.: cada título do gancho).
          const cur = (clip.params[posKey] as { x?: number; y?: number } | undefined) ?? {};
          ops = [{ op: "update_clip", clipId, params: { [posKey]: { x: clamp((cur.x ?? 0) + dx), y: clamp((cur.y ?? 0) + dy) } } }];
        } else if (!isFullscreen(clip)) {
          const sc = clip.style?.scale ?? 1;
          ops = [{ op: "update_clip", clipId, style: { dx: clamp((clip.style?.dx ?? 0) + dx), dy: clamp((clip.style?.dy ?? 0) + dy), scale: sc } }];
        }
      } else if (caption) {
        const cy = (caption.y + caption.h / 2) / base.height + dy;
        ops = [{ op: "set_captions", style: { y: Math.min(0.95, Math.max(0.05, Math.round(cy * 1000) / 1000)) } }];
      }
      if (ops) {
        try {
          // Prévia ao vivo, sem entrar no histórico; o ponto de desfazer é criado ao soltar.
          useEditor.setState({ project: applyOperations(base, ops, { validateComponent, validateSfx }).project });
        } catch {
          ops = null;
        }
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (moved && ops) {
        const keep = { selectedClipId: useEditor.getState().selectedClipId, selectedCaption: useEditor.getState().selectedCaption };
        useEditor.setState({ project: base });
        useEditor.getState().apply(ops);
        useEditor.setState(keep);
      } else if (!moved && !region && !caption) {
        // Clique no vídeo, fora de qualquer texto: solta a seleção ou dá play.
        if (s.selectedClipId || s.selectedCaption) s.select(null);
        else togglePlay();
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  /** Duplo clique num texto: reescreve ali mesmo, em cima do vídeo. */
  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useEditor.getState();
    const p = s.project;
    if (!p) return;
    const pt = toFrame(e);
    const cssRect = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x / pt.k, y: b.y / pt.k, w: b.w / pt.k, h: b.h / pt.k });
    const region = [...hit.regions].reverse().find((r) => inside(r, pt.x, pt.y));
    if (region) {
      const clip = findClip(p, region.clipId)?.clip;
      if (clip?.type !== "component") return;
      const raw = getPath(clip.params, region.key);
      const fallback = region.key === "name" ? p.brand.displayName : region.key === "credential" ? p.brand.credential : "";
      s.setPlaying(false);
      setEdit({ kind: "param", clipId: clip.id, key: region.key, value: plainText(typeof raw === "string" ? raw : fallback), rect: cssRect(region) });
    } else if (hit.caption && inside(hit.caption, pt.x, pt.y, 4)) {
      const group = captionGroups(p).find((g) => g.wordIds[0] === hit.caption!.wordIds[0]);
      s.setPlaying(false);
      setEdit({ kind: "caption", wordIds: hit.caption.wordIds, value: group?.text ?? "", rect: cssRect(hit.caption) });
    }
  };

  const commitEdit = (value: string) => {
    const current = edit;
    setEdit(null);
    if (!current) return;
    const s = useEditor.getState();
    const text = value.trim();
    if (current.kind === "caption") {
      if (text) s.apply([{ op: "edit_caption", wordIds: current.wordIds, text }]);
      s.selectCaption(current.wordIds);
      return;
    }
    const clip = s.project ? findClip(s.project, current.clipId)?.clip : null;
    if (clip?.type !== "component" || !text) return;
    const before = getPath(clip.params, current.key);
    const next = reEmphasize(typeof before === "string" ? before : "", text);
    if (next === before) return;
    s.apply([{ op: "update_clip", clipId: clip.id, params: setPath(clip.params, current.key, next) }]);
    s.select(clip.id);
  };

  return (
    <div className="stage-bg flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div className="relative flex max-h-full max-w-full" style={{ height: "100%" }}>
          <canvas
            ref={canvasRef}
            data-testid="preview"
            className="max-h-full max-w-full touch-none self-center rounded-xl bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10"
            onPointerDown={onPointerDown}
            onDoubleClick={onDoubleClick}
          />
          {edit && <InlineEditor edit={edit} canvas={canvasRef.current} onCommit={commitEdit} onCancel={() => setEdit(null)} />}
        </div>
      </div>
      <video ref={videoA} playsInline preload="auto" className="pointer-events-none fixed h-px w-px opacity-0" />
      <video ref={videoB} playsInline preload="auto" className="pointer-events-none fixed h-px w-px opacity-0" />
      <Transport />
    </div>
  );
}

const clamp = (n: number) => Math.round(Math.min(1, Math.max(-1, n)) * 1000) / 1000;

function nextClip(p: Project, clip: MediaClip): MediaClip | null {
  const clips = mainClips(p).sort((a, b) => a.start - b.start);
  const i = clips.findIndex((c) => c.id === clip.id);
  return i >= 0 ? (clips[i + 1] ?? null) : null;
}

/** Campo de texto posicionado em cima do texto que está sendo reescrito no vídeo. */
function InlineEditor({ edit, canvas, onCommit, onCancel }: { edit: InlineEdit; canvas: HTMLCanvasElement | null; onCommit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(edit.value);
  if (!canvas) return null;
  const width = Math.max(180, Math.min(canvas.clientWidth - 16, edit.rect.w + 48));
  const left = Math.max(8, Math.min(canvas.offsetLeft + edit.rect.x + edit.rect.w / 2 - width / 2, canvas.offsetLeft + canvas.clientWidth - width - 8));
  return (
    <div className="pop-in absolute z-20" style={{ left, top: canvas.offsetTop + edit.rect.y + edit.rect.h / 2 - 22, width }}>
      <input
        autoFocus
        value={value}
        data-testid="inline-edit"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") onCancel();
        }}
        className="w-full rounded-lg border border-brand-400 bg-ink-900/95 px-3 py-2.5 text-center text-sm font-medium text-white shadow-2xl outline-none ring-4 ring-brand-500/25"
      />
      <p className="mt-1 text-center text-[10px] text-zinc-300 drop-shadow">Enter confirma · Esc cancela</p>
    </div>
  );
}

export function togglePlay() {
  const s = useEditor.getState();
  if (!s.project) return;
  if (!s.playing && s.time >= projectDuration(s.project) - 0.01) s.seek(0);
  s.setPlaying(!s.playing);
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  const time = useEditor((s) => s.time);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 0));
  const hint = useEditor((s) => (s.selectedClipId || s.selectedCaption ? "Arraste no vídeo para mover · duplo clique no texto para reescrever" : null));
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 text-sm">
      <button
        onClick={togglePlay}
        aria-label={playing ? "Pausar" : "Reproduzir"}
        title="Reproduzir / pausar (Espaço)"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-950 shadow-lg transition hover:scale-105 hover:bg-zinc-100"
      >
        {playing ? <Icon.pause size={18} /> : <Icon.play size={18} className="ml-0.5" />}
      </button>
      <span className="font-mono text-[13px] tabular-nums text-zinc-200" data-testid="timecode">
        {formatTime(time)} <span className="text-zinc-600">/ {formatTime(duration)}</span>
      </span>
      {hint && (
        <span className="hidden items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[11px] text-brand-300 lg:inline-flex">
          <Icon.move size={12} /> {hint}
        </span>
      )}
    </div>
  );
}
