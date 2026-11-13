"use client";

import { useState } from "react";
import { SKILLS, type SkillId } from "@videoeditor/core";
import { Reel } from "./LandingReel";

const IDS = Object.keys(SKILLS) as SkillId[];

/** O que cada estilo faz, em linguagem de quem grava (resumo das instruções que a IA recebe). */
const MOVES: Record<SkillId, string[]> = {
  viral: [
    "O vídeo começa na primeira frase que promete algo; o aquecimento sai.",
    "Título de gancho nos três primeiros segundos, com punch-in seco.",
    "Uma peça de motion a cada virada de raciocínio, entrando na palavra em que é dita.",
  ],
  autoridade: [
    "Pausas de raciocínio ficam; erros e frases abandonadas saem.",
    "Tarja com seu nome e credencial na afirmação mais forte da abertura.",
    "Avanço lento de câmera nas frases que carregam a tese. Sem punch-in em sequência.",
  ],
  vsl: [
    "Cortes rápidos: sai a hesitação e tudo que repete o que já foi dito.",
    "Todo número, prazo ou preço aparece animado na palavra exata.",
    "A dor abre o vídeo e o benefício fecha, em cartão de tela cheia.",
  ],
  limpeza: [
    "Recomeços, falas para a equipe e trechos fora do conteúdo são cortados.",
    "Um zoom suave em cada mudança de tópico, e só.",
    "Sem motion e sem mexer nas legendas: o acabamento continua com você.",
  ],
};

const CAPTIONS: Record<string, string> = { karaoke: "Palavra por palavra, no centro", clean: "Discreta, na base", bold: "Em negrito, na base" };

const range = ([min, max]: [number, number]) => (max < 1 ? "quase nenhuma" : `${min} a ${max}`);

/** Seletor de estilo: o chip troca o cartão de exemplo e a descrição do que a IA faz. */
export function LandingStyles() {
  const [id, setId] = useState<SkillId>("viral");
  const skill = SKILLS[id];
  const captions = skill.local.find((op) => op.op === "set_captions");
  const preset = captions && "style" in captions ? captions.style?.preset : undefined;

  return (
    <div>
      <div role="tablist" aria-label="Estilos de edição" className="flex flex-wrap gap-2.5">
        {IDS.map((s) => (
          <button key={s} type="button" role="tab" id={`estilo-${s}`} aria-selected={s === id} aria-controls="estilo-painel" className="lp-chip" onClick={() => setId(s)}>
            {SKILLS[s].name}
          </button>
        ))}
      </div>

      <div id="estilo-painel" role="tabpanel" aria-labelledby={`estilo-${id}`} className="lp-panel mt-6 grid gap-8 rounded-[28px] p-5 sm:p-8 md:grid-cols-[minmax(0,260px)_1fr] md:gap-12">
        <Reel key={id} style={id} className="mx-auto w-full max-w-[260px] pop-in" />
        <div className="flex flex-col">
          <p className="lp-overline">{skill.audience}</p>
          <h3 className="lp-display mt-3 text-[30px] font-semibold leading-[1.1] sm:text-[38px]">{skill.tagline}.</h3>
          <ul className="mt-7 space-y-4 text-[16.5px] leading-snug text-haze">
            {MOVES[id].map((m, i) => (
              <li key={m} className="flex gap-4">
                <span className="lp-display mt-0.5 text-[13px] font-semibold text-neon-pink">0{i + 1}</span>
                {m}
              </li>
            ))}
          </ul>
          <dl className="mt-8 grid gap-5 border-t border-edge pt-6 sm:grid-cols-3 md:mt-auto">
            {[
              ["Câmera", `${range(skill.pacing.zoomsPerMin)} movimentos por minuto`],
              ["Motion", `${range(skill.pacing.componentsPerMin)} ${skill.pacing.componentsPerMin[1] < 1 ? "peça" : "peças por minuto"}`],
              ["Legenda", preset ? (CAPTIONS[preset] ?? "Automática") : "Como você deixou"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] uppercase tracking-[0.2em] text-haze">{k}</dt>
                <dd className="lp-display mt-1.5 text-[17px] font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
