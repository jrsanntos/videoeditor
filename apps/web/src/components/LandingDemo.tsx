"use client";

import { useRef, useState } from "react";
import { DEMOS, type Demo } from "./landing-demos";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/**
 * Antes e depois com vídeos reais: o bruto como foi gravado e o resultado
 * exportado pelo próprio editor, sem retoque. Sem demonstrações cadastradas
 * (landing-demos.ts), a seção não aparece — a página nunca mostra um exemplo
 * que o produto não produziu.
 */
export function LandingDemo() {
  const [i, setI] = useState(0);
  if (!DEMOS.length) return null;
  const demo = DEMOS[i]!;
  return (
    <div>
      {DEMOS.length > 1 && (
        <div role="tablist" aria-label="Exemplos" className="mb-6 flex flex-wrap gap-2.5">
          {DEMOS.map((d, k) => (
            <button key={d.after} role="tab" aria-selected={k === i} className="lp-chip" onClick={() => setI(k)}>
              {d.label}
            </button>
          ))}
        </div>
      )}
      <Pair key={demo.after} demo={demo} />
    </div>
  );
}

function Pair({ demo }: { demo: Demo }) {
  const [view, setView] = useState<"before" | "after">("after");
  return (
    <div className="lp-panel rounded-[28px] p-5 sm:p-8" data-testid="landing-demo">
      {/* No celular, um vídeo por vez com a troca; a partir do tablet, lado a lado. */}
      <div className="mb-5 flex gap-2 sm:hidden" role="tablist" aria-label="Antes ou depois">
        {(["before", "after"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className="lp-chip flex-1 justify-center" onClick={() => setView(v)}>
            {v === "before" ? "Antes" : "Depois"}
          </button>
        ))}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
        <Clip src={demo.before} poster={demo.beforePoster} title="Antes" sub={`Gravado assim · ${fmt(demo.beforeSec)}`} className={view === "before" ? "" : "hidden sm:block"} />
        <Clip src={demo.after} poster={demo.afterPoster} title="Depois" sub={`Editado pela IA · ${fmt(demo.afterSec)}`} accent className={view === "after" ? "" : "hidden sm:block"} />
      </div>
      <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-edge pt-5 text-[14.5px] text-haze">
        {demo.facts.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-neon-mint" /> {f}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-haze/80">Resultado exportado pelo próprio editor, sem retoque. Estilo {demo.style}.</p>
    </div>
  );
}

function Clip({ src, poster, title, sub, accent, className = "" }: { src: string; poster?: string; title: string; sub: string; accent?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  return (
    <figure className={className}>
      <div className={`relative mx-auto aspect-[9/16] max-w-[360px] overflow-hidden rounded-[22px] border bg-black ${accent ? "border-neon-pink/60 shadow-[0_30px_70px_-30px_rgba(246,76,255,0.55)]" : "border-white/15"}`}>
        <video ref={ref} src={src} poster={poster} autoPlay loop muted={muted} playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
        <button
          type="button"
          onClick={() => {
            setMuted((m) => !m);
            void ref.current?.play().catch(() => {});
          }}
          className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-[12.5px] font-semibold text-white backdrop-blur transition hover:bg-black/80"
        >
          {muted ? "Ouvir" : "Silenciar"}
        </button>
      </div>
      <figcaption className="mx-auto mt-3 max-w-[360px]">
        <span className={`lp-display block text-[19px] font-semibold ${accent ? "text-neon-mint" : "text-white"}`}>{title}</span>
        <span className="text-[14px] text-haze">{sub}</span>
      </figcaption>
    </figure>
  );
}
