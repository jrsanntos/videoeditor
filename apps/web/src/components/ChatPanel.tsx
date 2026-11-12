"use client";

import { useEffect, useRef, useState } from "react";
import { agentTier, creditCost, formatCredits, PRICING, projectDuration, SKILLS, type SkillId } from "@videoeditor/core";
import { askAgent, runSkill } from "@/lib/actions";
import { useEditor, type EditPlan } from "@/lib/store";
import { formatTime } from "./Player";
import { Icon } from "./ui";

const SUGGESTIONS = ["Revise os erros de gravação e corte os takes ruins", "Aplique zoom nos momentos de ênfase", "Destaque os números que eu citar"];

const SKILL_ICON: Record<SkillId, React.ReactNode> = {
  viral: <Icon.bolt size={15} />,
  autoridade: <Icon.shield size={15} />,
  vsl: <Icon.chart size={15} />,
  limpeza: <Icon.wand size={15} />,
};

const ROLE: Record<string, string> = { gancho: "Gancho", contexto: "Contexto", desenvolvimento: "Desenvolvimento", virada: "Virada", prova: "Prova", climax: "Clímax", cta: "Chamada para ação" };
const ENERGY: Record<string, string> = { alta: "bg-rose-400", media: "bg-amber-300", baixa: "bg-sky-300" };

export function ChatPanel() {
  const chat = useEditor((s) => s.chat);
  const busy = useEditor((s) => s.busy);
  const range = useEditor((s) => s.range);
  const width = useEditor((s) => s.layout.right);
  const aiFocus = useEditor((s) => s.aiFocus);
  const tour = useEditor((s) => s.tour);
  const [text, setText] = useState("");
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 0));
  // O mesmo cálculo do servidor: o preço mostrado é o cobrado.
  const fullCost = creditCost({ type: "agent", tier: "full", durationSec: duration });
  const tier = agentTier(text, !!range);
  const cost = tier === "full" ? fullCost : PRICING.adjust;
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Em navegadores recentes scrollIntoView devolve uma Promise; o efeito não pode retorná-la.
    // Sem conversa ainda, o painel abre no topo, mostrando os estilos de edição.
    if (chat.length) void end.current?.scrollIntoView({ block: "end" });
  }, [chat.length, busy]);

  // Um trecho chegou da timeline ("Editar com IA"): o campo recebe o foco e pisca.
  useEffect(() => {
    if (aiFocus) input.current?.focus();
  }, [aiFocus]);

  const send = (message: string) => {
    if (!message.trim() || busy) return;
    setText("");
    void askAgent(message.trim());
  };

  return (
    <aside className="flex shrink-0 flex-col bg-ink-900" style={{ width }} data-testid="chat">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="btn-brand flex h-8 w-8 items-center justify-center rounded-lg">
          <Icon.sparkles size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Diretor de IA</h2>
          <p className="text-[11px] text-zinc-500">Assiste ao vídeo, planeja e edita a timeline.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {chat.length === 0 && (
          <div className="space-y-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Edição automática completa</p>
            <div className="grid grid-cols-2 gap-2" data-testid="skills" data-tour="director">
              {(Object.keys(SKILLS) as SkillId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    if (tour === 1) useEditor.getState().setTour(2);
                    void runSkill(id);
                  }}
                  disabled={!!busy}
                  title={SKILLS[id].audience}
                  className="group rounded-xl border border-line bg-ink-850 p-3 text-left transition hover:border-brand-400/70 hover:bg-ink-800 disabled:opacity-40"
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-zinc-100">
                    <span className="text-brand-300">{SKILL_ICON[id]}</span> {SKILLS[id].name}
                  </span>
                  <span className="mt-1 block text-[10.5px] leading-snug text-zinc-500">{SKILLS[id].tagline}</span>
                  <span className="mt-1.5 block text-[10.5px] font-medium text-amber-300">{formatCredits(fullCost)} créditos</span>
                </button>
              ))}
            </div>
            <p className="pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Ou peça o que quiser</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={!!busy} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-line-strong hover:bg-ink-850 disabled:opacity-40">
                {s}
              </button>
            ))}
            <p className="pt-2 text-[11px] leading-relaxed text-zinc-600">
              Edição completa: {formatCredits(fullCost)} créditos neste vídeo — a IA analisa a fala, a voz e o enquadramento, monta um plano de ritmo e revisa o resultado. Ajuste pontual: {PRICING.adjust} crédito. Só é cobrado quando a
              timeline muda.
            </p>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.plan ? (
              <PlanCard plan={m.plan} />
            ) : (
              <div
                className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                  m.role === "user" ? "rounded-br-md bg-brand-600 text-white" : m.error ? "border border-rose-500/30 bg-rose-500/10 text-rose-200" : "rounded-bl-md border border-line bg-ink-850 text-zinc-200"
                }`}
              >
                {m.text}
                {!!m.log?.length && (
                  <details className="mt-2 text-xs text-zinc-400">
                    <summary className="cursor-pointer">
                      {m.log.length} operações{m.credits ? ` · ${formatCredits(m.credits)} crédito${m.credits > 1 ? "s" : ""}` : ""}
                    </summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {m.log.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-zinc-400" role="status">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-brand-400" /> {busy}
          </p>
        )}
        <div ref={end} />
      </div>

      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        {range && (
          <div key={`chip-${aiFocus}`} className={`mb-2 inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/15 px-2 py-1 text-[11px] font-medium text-brand-300 ${aiFocus ? "ai-receive" : ""}`} data-testid="chat-range">
            <Icon.scissors size={12} /> Só o trecho {formatTime(range.start)}–{formatTime(range.end)}
            <button type="button" className="ml-0.5 text-brand-300/70 hover:text-white" onClick={() => useEditor.getState().setRange(null)} aria-label="Tirar o trecho do pedido">
              <Icon.x size={12} />
            </button>
          </div>
        )}
        <textarea
          ref={input}
          key={`input-${aiFocus}`}
          autoFocus={aiFocus > 0}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          rows={3}
          data-testid="chat-input"
          placeholder={range ? "O que fazer neste trecho? Ex.: dê um zoom e destaque a frase" : "Ex.: edite o vídeo inteiro no estilo viral"}
          className={`w-full resize-none rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-brand-400 ${aiFocus && range ? "ai-receive" : ""}`}
        />
        <button type="submit" disabled={!text.trim() || !!busy} className="btn-brand mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold">
          <Icon.send size={14} />
          {text.trim() ? `${tier === "full" ? "Edição completa" : "Ajuste"} · ${formatCredits(cost)} ${cost === 1 ? "crédito" : "créditos"}` : "Enviar"}
        </button>
      </form>
    </aside>
  );
}

/** O plano do agente: o que ele entendeu do vídeo e o mapa de ritmo que vai executar. */
function PlanCard({ plan }: { plan: EditPlan }) {
  return (
    <div className="w-full rounded-2xl border border-brand-500/25 bg-brand-500/[0.06] p-3.5" data-testid="plan">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-300">
        <Icon.sparkles size={12} /> Plano de edição
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-200">{plan.diagnostico}</p>
      {plan.cortes && plan.cortes.toLowerCase() !== "nenhum" && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-zinc-400">
          <b className="font-medium text-zinc-300">Cortes:</b> {plan.cortes}
        </p>
      )}
      <ol className="mt-3 space-y-2 border-l border-line pl-3">
        {plan.capitulos.map((c, i) => (
          <li key={i} className="relative text-[11.5px] leading-snug">
            <span className={`absolute -left-[16px] top-1 h-1.5 w-1.5 rounded-full ${ENERGY[c.energia] ?? "bg-zinc-400"}`} title={`energia ${c.energia}`} />
            <span className="font-semibold text-zinc-100">{ROLE[c.papel] ?? c.papel}</span>
            <span className="text-zinc-500">
              {" "}
              · {c.zooms} zoom{c.zooms === 1 ? "" : "s"}, {c.componentes} motion
            </span>
            <span className="mt-0.5 block text-zinc-400">{c.tratamento}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
