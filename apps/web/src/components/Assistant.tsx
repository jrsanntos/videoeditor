"use client";

import { useState } from "react";
import { formatCredits, GENRE_NAMES, projectDuration, projectGenre, skillForGenre, type SkillId } from "@videoeditor/core";
import { autoCleanOnly, autoEdit, autoEditCost, editManually } from "@/lib/actions";
import { useEditor } from "@/lib/store";
import { formatTime, togglePlay } from "./Player";
import { Icon } from "./icons";

/** Os estilos em linguagem de quem não é editor: para que serve e como fica. */
const STYLES: { id: SkillId; name: string; icon: React.ReactNode; forWho: string; look: string }[] = [
  { id: "viral", name: "Retenção Viral", icon: <Icon.bolt size={18} />, forWho: "Reels, Shorts e TikTok", look: "Gancho em 2 s, legenda pop na base, micro-zooms nos cortes e trilha animada." },
  { id: "acao", name: "Ação & Cinema", icon: <Icon.film size={18} />, forWho: "Esportes, treinos, cenas com pouca fala", look: "Câmera lenta nos ápices, cor de cinema, impactos, trilha de ação. Não corta os silêncios." },
  { id: "autoridade", name: "Autoridade", icon: <Icon.shield size={18} />, forWho: "Negócios, saúde, direito, educação", look: "Tom quente e limpo, números em cartões, câmera suave e legenda editorial." },
];

const INCLUDED = ["Plano por atos para você aprovar", "Legendas na base, fora do rosto", "Zooms com motivo, no sujeito", "Cards, trilha e efeitos sonoros", "Revisão automática antes de entregar"];

/**
 * Assistente de edição automática. É o caminho de quem nunca editou um vídeo:
 * escolher um estilo, apertar um botão, receber o vídeo pronto. Tudo o que
 * ele faz também está disponível, passo a passo, nos painéis do editor.
 */
export function Assistant() {
  const mode = useEditor((s) => s.assistant);
  if (mode === "choose") return <Choose />;
  if (mode === "working") return <Working />;
  if (mode === "done") return <Done />;
  return null;
}

const backdrop = "fixed inset-0 z-[65] flex items-center justify-center bg-ink-950/75 p-4 backdrop-blur-sm";
const card = "pop-in w-full rounded-3xl border border-line-strong bg-ink-850 shadow-[0_40px_120px_-20px_rgba(0,0,0,1)]";

function Choose() {
  const project = useEditor((s) => s.project);
  const credits = useEditor((s) => s.credits);
  const unlimited = useEditor((s) => s.unlimited);
  const preset = useEditor((s) => s.assistantPick);
  // O modelo sugerido segue o gênero medido no vídeo: cena de ação não começa em "talking-head".
  const genre = project ? projectGenre(project) : null;
  const [picked, setPick] = useState<SkillId | null>(null);
  const pick = picked ?? preset ?? skillForGenre(genre);
  if (!project) return null;
  const total = autoEditCost(project);
  const enough = unlimited || credits >= total;

  return (
    <div className={backdrop} role="dialog" aria-label="Edição automática" data-testid="assistant">
      <div className={`${card} relative max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto p-7`}>
        <button
          onClick={editManually}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/8 hover:text-white"
          aria-label="Fechar e ir para o editor"
          title="Fechar e ir para o editor"
        >
          <Icon.x size={18} />
        </button>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-300">
          <Icon.sparkles size={14} /> Vídeo recebido
        </p>
        <h2 className="mt-2 pr-10 text-2xl font-semibold tracking-tight text-white">Como você quer editar o seu vídeo?</h2>
        <p className="mt-1.5 text-sm text-zinc-400">
          Deixe a IA editar do começo ao fim num estilo, ou vá direto para o editor e faça do seu jeito. Dá para trocar de ideia depois.
          {genre && (
            <span className="ml-1 text-brand-300" data-testid="genre">
              Detectamos: {GENRE_NAMES[genre]}.
            </span>
          )}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Estilo da edição">
          {STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={pick === s.id}
              onClick={() => setPick(s.id)}
              data-testid={`style-${s.id}`}
              className={`rounded-2xl border p-4 text-left transition ${pick === s.id ? "border-brand-400 bg-brand-500/15 ring-4 ring-brand-500/15" : "border-line bg-ink-900 hover:border-line-strong"}`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${pick === s.id ? "btn-brand" : "bg-white/8 text-zinc-300"}`}>{s.icon}</span>
              <span className="mt-3 block text-[15px] font-semibold text-white">{s.name}</span>
              <span className="mt-0.5 block text-[11.5px] font-medium text-brand-300">{s.forWho}</span>
              <span className="mt-2 block text-[12.5px] leading-snug text-zinc-400">{s.look}</span>
            </button>
          ))}
        </div>

        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-zinc-300">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <Icon.check size={14} className="text-brand-300" /> {item}
            </li>
          ))}
        </ul>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-col gap-2">
            <button className="btn-brand flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold" disabled={!enough} onClick={() => void autoEdit(pick)} data-testid="auto-edit">
              <Icon.wand size={18} /> Editar automaticamente com IA
            </button>
            <p className="text-center text-[12px] leading-snug text-zinc-400">
              {unlimited ? (
                "Sem custo: conta de administrador."
              ) : enough ? (
                <>
                  Usa <b className="font-semibold text-white">{formatCredits(total)} créditos</b> dos seus {formatCredits(credits)} · cerca de 1 a 2 minutos
                </>
              ) : (
                <>
                  Precisa de {formatCredits(total)} créditos e você tem {formatCredits(credits)}.{" "}
                  <a href="/planos" className="font-medium text-brand-300 underline-offset-2 hover:underline">
                    Ver planos
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              className="flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-white/[0.04] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:border-brand-400/60 hover:bg-white/[0.08]"
              onClick={editManually}
              data-testid="assistant-manual"
            >
              <Icon.scissors size={17} /> Ir para o editor
            </button>
            <p className="text-center text-[12px] leading-snug text-zinc-400">Edite por conta própria · grátis, sem créditos</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 border-t border-line pt-4 text-[12.5px] text-zinc-500">
          Só quer limpar a gravação?
          <button className="font-medium text-zinc-200 underline-offset-2 hover:text-white hover:underline" onClick={() => void autoCleanOnly()} data-testid="assistant-clean">
            Cortar só os erros e as pausas
          </button>
        </div>
      </div>
    </div>
  );
}

const STAGES: { match: RegExp; label: string }[] = [
  { match: /áudio|Transcrev/i, label: "Ouvindo e transcrevendo a fala" },
  { match: /Analisando|Assistindo|Lendo/i, label: "Assistindo ao vídeo inteiro" },
  { match: /Planejando|Conferindo a transcrição/i, label: "Planejando o ritmo da edição" },
  { match: /Montando|Aplicando|Continuando|removid|corte|zoom|componente/i, label: "Montando cortes, zooms e animações" },
  { match: /Revisando|Conferindo/i, label: "Revisando o resultado na tela" },
];

function Working() {
  const busy = useEditor((s) => s.busy);
  const plan = useEditor((s) => [...s.chat].reverse().find((m) => m.plan)?.plan);
  const [stage, setStage] = useState(0);
  const now = busy ? STAGES.findIndex((s) => s.match.test(busy)) : -1;
  // As etapas só avançam: uma mensagem intermediária não faz a lista voltar.
  if (now > stage) setStage(now);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[65] flex justify-center px-4" data-testid="assistant-working">
      <div className={`${card} pointer-events-auto max-w-md p-5`} role="status">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <span className="h-2 w-2 animate-ping rounded-full bg-brand-400" /> A IA está editando o seu vídeo
        </p>
        <ol className="mt-3 space-y-1.5">
          {STAGES.map((s, i) => (
            <li key={s.label} className={`flex items-center gap-2 text-[12.5px] ${i < stage ? "text-zinc-500" : i === stage ? "font-medium text-white" : "text-zinc-600"}`}>
              <span className={`flex h-4 w-4 items-center justify-center rounded-full ${i < stage ? "bg-brand-500 text-white" : i === stage ? "border-2 border-brand-400" : "border border-zinc-700"}`}>{i < stage && <Icon.check size={10} />}</span>
              {s.label}
            </li>
          ))}
        </ol>
        {plan && <p className="mt-3 line-clamp-3 border-t border-line pt-3 text-[12px] leading-relaxed text-zinc-400">{plan.diagnostico}</p>}
        <p className="mt-3 text-[11px] text-zinc-600">Você pode acompanhar a timeline sendo montada. Não feche esta aba.</p>
      </div>
    </div>
  );
}

function Done() {
  const project = useEditor((s) => s.project);
  const close = () => useEditor.setState({ assistant: null });
  if (!project) return null;
  const clips = project.tracks.flatMap((t) => t.clips);
  const count = (type: string) => clips.filter((c) => c.type === type).length;
  const original = Object.values(project.assets).find((a) => a.role !== "context")?.duration ?? 0;
  const final = projectDuration(project);

  return (
    <div className={backdrop} role="dialog" aria-label="Vídeo pronto" data-testid="assistant-done">
      <div className={`${card} max-w-lg p-7 text-center`}>
        <span className="btn-brand mx-auto flex h-14 w-14 items-center justify-center rounded-2xl">
          <Icon.check size={28} />
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">Seu vídeo está pronto</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          De {formatTime(original)} para <b className="font-semibold text-white">{formatTime(final)}</b>, com {count("zoom")} movimentos de câmera e {count("component") + count("broll")} elementos na tela.
          Assista antes de exportar; se algo não ficou como você quer, é só pedir.
        </p>
        <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
          <button
            className="btn-brand flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
            data-testid="done-watch"
            onClick={() => {
              close();
              const s = useEditor.getState();
              s.seek(0);
              if (!s.playing) togglePlay();
            }}
          >
            <Icon.play size={15} /> Assistir
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-xl border border-line-strong px-4 py-3 text-sm font-medium text-zinc-100 transition hover:bg-white/5"
            data-testid="done-export"
            onClick={() => {
              close();
              document.querySelector<HTMLButtonElement>('[data-tour="export"]')?.click();
            }}
          >
            <Icon.download size={15} /> Exportar
          </button>
        </div>
        <button
          className="mt-4 text-[12.5px] text-zinc-400 underline-offset-2 hover:text-white hover:underline"
          onClick={() => {
            close();
            useEditor.getState().focusAI();
          }}
        >
          Pedir um ajuste à IA
        </button>
        <p className="mt-4 text-[11px] text-zinc-600">Ctrl+Z desfaz a edição inteira, se preferir recomeçar.</p>
      </div>
    </div>
  );
}
