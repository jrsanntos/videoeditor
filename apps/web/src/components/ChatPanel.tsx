"use client";

import { useEffect, useRef, useState } from "react";
import { formatCredits, PRICING, SKILLS, type SkillId } from "@videoeditor/core";
import { askAgent, runSkill } from "@/lib/actions";
import { useEditor } from "@/lib/store";
import { formatTime } from "./Player";

const SUGGESTIONS = [
  "Revise os erros de gravação e corte os takes ruins",
  "Aplique zoom nos momentos de ênfase",
  "Crie um gráfico animado quando eu citar números",
];

export function ChatPanel() {
  const chat = useEditor((s) => s.chat);
  const busy = useEditor((s) => s.busy);
  const range = useEditor((s) => s.range);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Em navegadores recentes scrollIntoView devolve uma Promise; o efeito não pode retorná-la.
    void end.current?.scrollIntoView({ block: "end" });
  }, [chat.length, busy]);

  const send = (message: string) => {
    if (!message.trim() || busy) return;
    setText("");
    void askAgent(message.trim());
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Diretor de IA</h2>
        <p className="text-xs text-zinc-500">Diga o que quer; a IA edita a timeline.</p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {chat.length === 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Editar em 1 clique</p>
            <div className="grid grid-cols-2 gap-2" data-testid="skills">
              {(Object.keys(SKILLS) as SkillId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => void runSkill(id)}
                  disabled={!!busy}
                  title={SKILLS[id].audience}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left hover:border-indigo-500 disabled:opacity-40"
                >
                  <span className="block text-xs font-medium text-zinc-100">{SKILLS[id].name}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">{SKILLS[id].tagline}</span>
                </button>
              ))}
            </div>
            <p className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Ou peça o que quiser</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={!!busy}
                className="block w-full rounded-lg border border-zinc-800 px-3 py-2 text-left text-xs text-zinc-300 hover:border-zinc-600 disabled:opacity-40"
              >
                {s}
              </button>
            ))}
            <p className="pt-2 text-[11px] leading-relaxed text-zinc-600">
              Cada pedido que altera a timeline custa {String(PRICING.agentCommand).replace(".", ",")} crédito, com quantos zooms e componentes ele criar.
              Ajustes manuais são sempre gratuitos.
            </p>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={`max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-indigo-600 text-white"
                  : m.error
                    ? "border border-rose-900 bg-rose-950/50 text-rose-200"
                    : "bg-zinc-900 text-zinc-200"
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
          </div>
        ))}
        {busy && <p className="animate-pulse text-xs text-zinc-500">{busy}</p>}
        <div ref={end} />
      </div>

      <form
        className="border-t border-zinc-800 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        {range && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-1 text-[11px] text-sky-300">
            Só o trecho {formatTime(range.start)}–{formatTime(range.end)}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          rows={3}
          placeholder={range ? "O que fazer neste trecho?" : "Ex.: tire as pausas e dê zoom nas partes importantes"}
          className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
        />
        <button
          type="submit"
          disabled={!text.trim() || !!busy}
          className="mt-2 w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40"
        >
          Enviar
        </button>
      </form>
    </aside>
  );
}
