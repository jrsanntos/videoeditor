"use client";

import { useEffect, useState } from "react";
import { autoClean } from "@/lib/actions";
import { useEditor } from "@/lib/store";
import { Icon } from "./ui";

type Step = { target: string; title: string; text: string; action?: { label: string; run: () => void }; side: "right" | "left" | "below" };

const STEPS: Step[] = [
  {
    target: "clean",
    title: "Comece pela Limpeza automática",
    text: "Um clique transcreve a fala, remove os erros de gravação e retira as pausas. O vídeo fica enxuto e profissional antes de qualquer efeito — e todo o resto da edição parte daqui.",
    action: { label: "Limpar meu vídeo", run: () => void autoClean() },
    side: "right",
  },
  {
    target: "director",
    title: "Agora chame o Diretor de IA",
    text: "Escolha um estilo: a IA assiste ao vídeo inteiro, monta um plano de ritmo (gancho, desenvolvimento, fecho) e aplica zooms, legendas e motion. Você também pode pedir qualquer ajuste por escrito.",
    side: "left",
  },
  {
    target: "export",
    title: "Ajuste à mão e exporte",
    text: "Clique em qualquer bloco da timeline para editar; arraste os textos direto no vídeo. Quando gostar, exporte no navegador, sem gastar créditos.",
    side: "below",
  },
];

/**
 * Guia inicial: escurece a tela, ilumina o próximo passo e explica ao lado o
 * que ele faz. Aparece no primeiro vídeo enviado; Esc ou "Pular" fecha de vez.
 */
export function Tour() {
  const step = useEditor((s) => s.tour);
  const busy = useEditor((s) => s.busy);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const current = step === null ? null : STEPS[step];

  useEffect(() => {
    if (!current) return;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && Math.abs(prev.x - r.x) < 0.5 && Math.abs(prev.y - r.y) < 0.5 && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5 ? prev : r));
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [current]);

  // Enquanto uma ação roda (transcrição, agente) o guia sai da frente.
  if (!current || step === null || !rect || busy) return null;
  const { setTour } = useEditor.getState();
  const last = step === STEPS.length - 1;
  const pad = 6;
  const cardW = 320;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = current.side === "right" ? rect.right + 18 : current.side === "left" ? rect.left - cardW - 18 : Math.min(vw - cardW - 16, Math.max(16, rect.right - cardW));
  const top = current.side === "below" ? rect.bottom + 16 : Math.min(vh - 260, Math.max(16, rect.top - 8));

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" role="dialog" aria-label="Guia inicial" data-testid="tour">
      {/* Só escurece: o botão iluminado continua clicável de verdade. */}
      <div className="tour-ring absolute rounded-2xl" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="pop-in pointer-events-auto absolute rounded-2xl border border-brand-400/40 bg-ink-800 p-5 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.9)]" style={{ left: Math.max(16, left), top, width: cardW }}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-300">
            <Icon.sparkles size={12} /> Passo {step + 1} de {STEPS.length}
          </span>
          <button className="text-zinc-500 transition hover:text-white" onClick={() => setTour(null)} aria-label="Fechar o guia">
            <Icon.x size={15} />
          </button>
        </div>
        <h3 className="mt-2 text-[15px] font-semibold text-white">{current.title}</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">{current.text}</p>
        <div className="mt-4 flex items-center gap-2">
          {current.action && (
            <button
              className="btn-brand rounded-lg px-3 py-2 text-xs font-semibold"
              data-testid="tour-action"
              onClick={() => {
                setTour(step + 1);
                current.action!.run();
              }}
            >
              {current.action.label}
            </button>
          )}
          <button className={`rounded-lg px-3 py-2 text-xs font-medium ${current.action ? "text-zinc-300 hover:bg-white/8" : "btn-brand font-semibold"}`} onClick={() => setTour(last ? null : step + 1)} data-testid="tour-next">
            {last ? "Entendi" : current.action ? "Depois" : "Próximo"}
          </button>
          {!last && (
            <button className="ml-auto text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline" onClick={() => setTour(null)}>
              Pular guia
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
