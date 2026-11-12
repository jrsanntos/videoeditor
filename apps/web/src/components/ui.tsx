"use client";

import { useRef } from "react";

import { Icon, Logo } from "./icons";

export { Icon, Logo };

/** Interruptor liga/desliga. */
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; "data-testid"?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      data-testid={props["data-testid"]}
      onClick={() => props.onChange(!props.checked)}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${props.checked ? "bg-brand-500" : "bg-ink-600"}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${props.checked ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );
}

/** Linha com rótulo, descrição opcional e um interruptor. */
export function ToggleRow(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testid?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12.5px] text-zinc-200">{props.label}</div>
        {props.hint && <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">{props.hint}</div>}
      </div>
      <Switch checked={props.checked} onChange={props.onChange} label={props.label} disabled={props.disabled} data-testid={props.testid} />
    </div>
  );
}

/**
 * Alça de redimensionamento entre painéis: arraste para mudar o tamanho,
 * duplo clique para voltar ao padrão.
 */
export function ResizeHandle(props: { axis: "x" | "y"; onDrag: (deltaPx: number) => void; onReset?: () => void; label: string }) {
  const last = useRef(0);
  const x = props.axis === "x";
  return (
    <div
      role="separator"
      aria-orientation={x ? "vertical" : "horizontal"}
      aria-label={props.label}
      title={`${props.label} — arraste para redimensionar, duplo clique para o padrão`}
      className={`group relative z-30 shrink-0 ${x ? "w-[5px] cursor-col-resize" : "h-[5px] cursor-row-resize"}`}
      onDoubleClick={props.onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        last.current = x ? e.clientX : e.clientY;
        document.body.style.cursor = x ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
        const move = (ev: PointerEvent) => {
          const now = x ? ev.clientX : ev.clientY;
          props.onDrag(now - last.current);
          last.current = now;
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
    >
      <div className={`absolute bg-line transition-colors group-hover:bg-brand-500 group-active:bg-brand-400 ${x ? "inset-y-0 left-[2px] w-px group-hover:left-[1px] group-hover:w-[3px]" : "inset-x-0 top-[2px] h-px group-hover:top-[1px] group-hover:h-[3px]"}`} />
      <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 ${x ? "h-8 w-[3px]" : "h-[3px] w-8"}`} />
    </div>
  );
}

export const iconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-white/8 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent";
