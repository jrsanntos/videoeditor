"use client";

import { useEffect, useRef, useState } from "react";
import { agentTier, creditCost, formatCredits, PRICING, projectDuration, SKILLS, TIER_NAMES, type AgentTier, type SkillId } from "@videoeditor/core";
import { acceptMediaSuggestion, askAgent, classifyRequest, confirmPlan, discardPlan, dismissMediaSuggestion, revisePlan, runSkill } from "@/lib/actions";
import { useEditor, type ChatMessage, type EditPlan } from "@/lib/store";
import { formatTime } from "./Player";
import { Icon } from "./ui";

const SUGGESTIONS = ["Revise os erros de gravação e corte os takes ruins", "Aplique zoom nos momentos de ênfase", "Destaque os números que eu citar"];

const SKILL_ICON: Record<SkillId, React.ReactNode> = {
  viral: <Icon.bolt size={15} />,
  autoridade: <Icon.shield size={15} />,
  acao: <Icon.film size={15} />,
  limpeza: <Icon.wand size={15} />,
};

const ACT: Record<EditPlan["capitulos"][number]["ato"], string> = { gancho: "Gancho", desenvolvimento: "Desenvolvimento", climax: "Clímax", fecho: "Fecho" };
const ACTS = Object.keys(ACT) as (keyof typeof ACT)[];
const SPEED: Record<string, string> = { camera_lenta: "câmera lenta", acelerado: "acelerado", mista: "rampas de velocidade" };
const ENERGY: Record<string, string> = { alta: "bg-rose-400", media: "bg-amber-300", baixa: "bg-sky-300" };

export function ChatPanel({ fluid = false }: { fluid?: boolean } = {}) {
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
  const sweepCost = creditCost({ type: "agent", tier: "sweep", durationSec: duration });
  // Enquanto a pessoa digita, o servidor classifica o pedido pela intenção e devolve um passe com o nível.
  // Até a resposta chegar vale a regra local; o envio leva o passe, e o preço cobrado é o mostrado.
  const [classified, setClassified] = useState<{ text: string; selection: boolean; tier: AgentTier; token: string } | null>(null);
  const trimmed = text.trim();
  const current = classified && classified.text === trimmed && classified.selection === !!range ? classified : null;
  const tier: AgentTier = current?.tier ?? agentTier(trimmed, !!range);
  const cost = creditCost({ type: "agent", tier, durationSec: duration });
  useEffect(() => {
    if (!trimmed || range) return;
    const ctl = new AbortController();
    const id = setTimeout(() => {
      void classifyRequest(trimmed, false, duration, ctl.signal).then((r) => r && setClassified({ text: trimmed, selection: false, ...r }));
    }, 450);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [trimmed, range, duration]);
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
    const pass = current && current.text === message.trim() ? current : null;
    void askAgent(message.trim(), undefined, pass ? { tier: pass.tier, tierToken: pass.token } : {});
  };

  return (
    <aside className={`flex shrink-0 flex-col bg-ink-900 ${fluid ? "h-full w-full" : ""}`} style={fluid ? undefined : { width }} data-testid="chat">
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
              <button key={s} onClick={() => send(s)} disabled={!!busy} className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-line-strong hover:bg-ink-850 disabled:opacity-40">
                {s}
                <span className="shrink-0 text-[10.5px] text-amber-300/80">{formatCredits(creditCost({ type: "agent", tier: agentTier(s, false), durationSec: duration }))} cr.</span>
              </button>
            ))}
            <p className="pt-2 text-[11px] leading-relaxed text-zinc-600">
              Edição completa: {formatCredits(fullCost)} créditos neste vídeo — o Diretor analisa fala, movimento e som e propõe um plano por atos; você confirma; o Editor monta e o Crítico revisa. Uma tarefa no vídeo todo (revisar erros, zoom nas ênfases):{" "}
              {formatCredits(sweepCost)} créditos. Ajuste pontual: {PRICING.adjust} crédito. O preço aparece no botão antes de enviar e só é cobrado quando a timeline muda.
            </p>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.plan ? (
              <PlanCard message={m} />
            ) : m.media ? (
              <MediaCard message={m} />
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
          {text.trim() ? `${TIER_NAMES[tier]} · ${formatCredits(cost)} ${cost === 1 ? "crédito" : "créditos"}` : "Enviar"}
        </button>
      </form>
    </aside>
  );
}

/**
 * O Diretor como consultor: "aqui ficaria bom mostrar uma imagem de…".
 * Nada é gerado nem cobrado sem o sim do usuário, sugestão por sugestão.
 */
function MediaCard({ message }: { message: ChatMessage }) {
  const media = message.media!;
  const busy = useEditor((s) => s.busy);
  const credits = useEditor((s) => s.credits);
  const unlimited = useEditor((s) => s.unlimited);
  const cost = media.tipo === "video" ? creditCost({ type: "generative", clips: 1 }) : creditCost({ type: "generative_image", images: 1 });
  const enough = unlimited || credits >= cost;
  const what = media.tipo === "video" ? "vídeo" : "imagem";
  return (
    <div className="w-full rounded-2xl border border-line bg-ink-850 p-3.5" data-testid="media-suggestion">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-300">
        <Icon.sparkles size={12} /> Sugestão do Diretor · {what} gerada por IA
      </p>
      <p className="mt-2 text-[13px] leading-snug text-zinc-100">{media.motivo}</p>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">O que seria gerado</summary>
        <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">{media.descricao}</p>
      </details>
      {media.note && <p className={`mt-2 text-[11.5px] ${media.status === "done" ? "text-emerald-300" : media.status === "busy" ? "text-zinc-300" : "text-amber-200"}`}>{media.note}</p>}
      {(media.status === "idle" || media.status === "busy") && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => void acceptMediaSuggestion(message.id)} disabled={media.status === "busy" || !!busy || !enough} className="btn-brand flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" data-testid="media-accept">
            <Icon.sparkles size={13} /> {media.status === "busy" ? "Gerando…" : `Gerar e inserir · ${formatCredits(cost)} créditos`}
          </button>
          {media.status === "idle" && (
            <button onClick={() => dismissMediaSuggestion(message.id)} className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200" data-testid="media-dismiss">
              Agora não
            </button>
          )}
          {!enough && <span className="text-[11px] text-amber-200">Créditos insuficientes.</span>}
        </div>
      )}
    </div>
  );
}

/**
 * O plano do Diretor: o vídeo em quatro atos, com o acabamento escolhido.
 * Enquanto está pendente, pede a confirmação rápida antes de qualquer edição
 * (e de qualquer crédito); o usuário pode aprovar, pedir um ajuste ou descartar.
 */
function PlanCard({ message }: { message: ChatMessage }) {
  const plan = message.plan!;
  const busy = useEditor((s) => s.busy);
  const [note, setNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const pending = !!message.pending;
  // Fora de ordem no plano? Agrupa por ato, mantendo a ordem dos trechos dentro de cada um.
  const acts = ACTS.map((ato) => ({ ato, items: plan.capitulos.filter((c) => c.ato === ato) })).filter((a) => a.items.length);
  return (
    <div className={`w-full rounded-2xl border p-3.5 ${pending ? "border-brand-400/60 bg-brand-500/[0.1] ring-4 ring-brand-500/10" : "border-brand-500/25 bg-brand-500/[0.06]"}`} data-testid="plan">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-300">
        <Icon.sparkles size={12} /> Plano do Diretor{pending ? " · aguardando você" : ""}
      </p>
      <p className="mt-2 text-[13px] font-medium leading-snug text-white">{plan.resumo}</p>
      <p className="mt-1.5 flex flex-wrap gap-1.5 text-[10.5px] text-zinc-300">
        {plan.estilo.look !== "none" && <span className="rounded-md bg-white/8 px-1.5 py-0.5">cor: {plan.estilo.look.replace(/_/g, " ")}</span>}
        {plan.estilo.musica !== "none" && <span className="rounded-md bg-white/8 px-1.5 py-0.5">trilha: {plan.estilo.musica}</span>}
        {plan.estilo.legenda && <span className="rounded-md bg-white/8 px-1.5 py-0.5">legenda: {plan.estilo.legenda.replace(/_/g, " ")}</span>}
      </p>
      <details className="mt-2" open={!pending}>
        <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200">Diagnóstico e detalhes</summary>
        <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-200">{plan.diagnostico}</p>
      {plan.cortes && plan.cortes.toLowerCase() !== "nenhum" && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-zinc-400">
          <b className="font-medium text-zinc-300">Cortes:</b> {plan.cortes}
        </p>
      )}
      </details>
      <div className="mt-3 space-y-2.5">
        {acts.map(({ ato, items }) => (
          <div key={ato} data-testid={`act-${ato}`}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400">{ACT[ato]}</p>
            <ol className="mt-1 space-y-1.5 border-l border-line pl-3">
              {items.map((c, i) => (
                <li key={i} className="relative text-[11.5px] leading-snug">
                  <span className={`absolute -left-[16px] top-1 h-1.5 w-1.5 rounded-full ${ENERGY[c.energia] ?? "bg-zinc-400"}`} title={`energia ${c.energia}`} />
                  <span className="font-semibold text-zinc-100">{c.titulo}</span>
                  <span className="text-zinc-500">
                    {" "}
                    · {[c.zooms ? `${c.zooms} zoom${c.zooms === 1 ? "" : "s"}` : "", c.componentes ? `${c.componentes} motion` : "", c.sons ? `${c.sons} som${c.sons === 1 ? "" : "s"}` : "", SPEED[c.velocidade] ?? ""].filter(Boolean).join(", ") || "tela limpa"}
                  </span>
                  <span className="mt-0.5 block text-zinc-400">{c.tratamento}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      {pending && (
        <div className="mt-3 border-t border-line pt-3">
          {adjusting ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void revisePlan(message.id, note);
              }}
            >
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que mudar? Ex.: menos texto, mais câmera lenta" className="w-full rounded-lg border border-line bg-ink-900 px-2.5 py-2 text-xs text-zinc-100 outline-none focus:border-brand-400" data-testid="plan-note" />
              <div className="mt-2 flex gap-2">
                <button type="submit" disabled={!note.trim() || !!busy} className="btn-brand flex-1 rounded-lg px-3 py-2 text-xs font-semibold">
                  Refazer o plano
                </button>
                <button type="button" onClick={() => setAdjusting(false)} className="rounded-lg border border-line px-3 py-2 text-xs text-zinc-300">
                  Voltar
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void confirmPlan(message.id)} disabled={!!busy} className="btn-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold" data-testid="plan-confirm">
                <Icon.check size={14} /> Confirmar e editar
              </button>
              <button onClick={() => setAdjusting(true)} disabled={!!busy} className="rounded-lg border border-line-strong px-3 py-2 text-xs text-zinc-200 hover:bg-white/5" data-testid="plan-adjust">
                Ajustar
              </button>
              <button onClick={() => discardPlan(message.id)} className="rounded-lg px-2 py-2 text-xs text-zinc-500 hover:text-zinc-200" aria-label="Descartar o plano" title="Descartar">
                <Icon.x size={14} />
              </button>
            </div>
          )}
          <p className="mt-2 text-[10.5px] text-zinc-500">Nada foi alterado nem cobrado ainda. A edição só começa quando você confirmar.</p>
        </div>
      )}
    </div>
  );
}
