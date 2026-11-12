import { type Ctx2D, font, serifFont } from "./draw";

/**
 * Tipografia mista: uma mesma frase com a fonte sem serifa de impacto e, nas
 * palavras marcadas com *asteriscos*, a serifada itálica na cor de destaque.
 * Tudo medido com measureText, palavra a palavra, para quebrar e alinhar certo.
 */
export type RichStyle = {
  size: number;
  weight: number;
  color: string;
  /** Cor das palavras em ênfase. */
  emphColor: string;
  /** Altura de linha como múltiplo de `size`. */
  leading?: number;
  upper?: boolean;
};

type RichWord = { text: string; emph: boolean; x: number; w: number; chars: number };
export type RichLayout = { lines: { words: RichWord[]; width: number }[]; width: number; height: number; chars: number; style: RichStyle };

/** "isso *muda tudo* hoje" → palavras com marca de ênfase. Asterisco sem par é texto comum. */
export function parseRich(text: string): { text: string; emph: boolean }[] {
  const out: { text: string; emph: boolean }[] = [];
  const parts = text.split("*");
  // Número par de partes = asterisco sem fechar: trata o último trecho como texto normal.
  const balanced = parts.length % 2 === 1;
  parts.forEach((part, i) => {
    const emph = i % 2 === 1 && (balanced || i < parts.length - 1);
    for (const word of part.split(/\s+/)) if (word) out.push({ text: word, emph });
  });
  return out;
}

/** Texto sem as marcas, para medir duração de digitação e afins. */
export const plainText = (text: string) =>
  parseRich(text)
    .map((w) => w.text)
    .join(" ");

const wordFont = (style: RichStyle, emph: boolean) => (emph ? serifFont(style.size * 1.12) : font(style.weight, style.size));

export function layoutRich(ctx: Ctx2D, text: string, style: RichStyle, maxWidth: number): RichLayout {
  const leading = style.leading ?? 1.15;
  ctx.font = font(style.weight, style.size);
  const space = ctx.measureText(" ").width;
  const lines: RichLayout["lines"] = [];
  let cur: RichWord[] = [];
  let x = 0;
  let chars = 0;
  const flush = () => {
    if (!cur.length) return;
    const last = cur[cur.length - 1]!;
    lines.push({ words: cur, width: last.x + last.w });
    cur = [];
    x = 0;
  };
  for (const word of parseRich(text)) {
    const shown = style.upper && !word.emph ? word.text.toUpperCase() : word.text;
    ctx.font = wordFont(style, word.emph);
    const w = ctx.measureText(shown).width;
    if (cur.length && x + w > maxWidth) flush();
    cur.push({ text: shown, emph: word.emph, x, w, chars: shown.length });
    chars += shown.length + 1;
    x += w + space;
  }
  flush();
  return {
    lines,
    width: lines.reduce((m, l) => Math.max(m, l.width), 0),
    height: lines.length * style.size * leading,
    chars: Math.max(0, chars - 1),
    style,
  };
}

/** Diminui o corpo até o texto caber em `maxWidth` × `maxLines`. */
export function fitRich(ctx: Ctx2D, text: string, style: RichStyle, maxWidth: number, maxLines: number, minSize = 14): RichLayout {
  let s = { ...style };
  let layout = layoutRich(ctx, text, s, maxWidth);
  for (let i = 0; i < 12 && (layout.lines.length > maxLines || layout.width > maxWidth) && s.size > minSize; i++) {
    s = { ...s, size: Math.max(minSize, s.size * 0.9) };
    layout = layoutRich(ctx, text, s, maxWidth);
  }
  return layout;
}

export type DrawRichOptions = {
  align?: "left" | "center" | "right";
  /** Máquina de escrever: quantos caracteres já foram digitados. Omitido = texto inteiro. */
  reveal?: number;
  /** Desenha o cursor "|" depois do último caractere digitado. */
  cursor?: boolean;
};

/**
 * Desenha o layout com o topo da primeira linha em `y`. `x` é a borda
 * esquerda, o centro ou a borda direita, conforme `align`.
 */
export function drawRich(ctx: Ctx2D, layout: RichLayout, x: number, y: number, opts: DrawRichOptions = {}) {
  const { style } = layout;
  const leading = style.leading ?? 1.15;
  const align = opts.align ?? "left";
  let budget = opts.reveal ?? Infinity;
  let cursor: { x: number; y: number } | null = null;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  layout.lines.forEach((line, i) => {
    const left = align === "center" ? x - line.width / 2 : align === "right" ? x - line.width : x;
    const baseline = y + style.size * 0.82 + i * style.size * leading;
    if (i === 0) cursor = { x: left, y: baseline };
    for (const word of line.words) {
      if (budget <= 0) break;
      const shown = budget >= word.chars ? word.text : word.text.slice(0, Math.max(0, Math.floor(budget)));
      ctx.font = wordFont(style, word.emph);
      ctx.fillStyle = word.emph ? style.emphColor : style.color;
      ctx.fillText(shown, left + word.x, baseline);
      cursor = { x: left + word.x + ctx.measureText(shown).width, y: baseline };
      budget -= word.chars + 1;
    }
  });
  if (opts.cursor && cursor) {
    const c = cursor as { x: number; y: number };
    ctx.fillStyle = style.emphColor;
    ctx.fillRect(c.x + style.size * 0.08, c.y - style.size * 0.78, Math.max(2, style.size * 0.07), style.size * 0.95);
  }
  ctx.restore();
}

/**
 * Estado da máquina de escrever em `t` segundos desde o início da digitação.
 * Enquanto digita o cursor fica aceso; depois pisca duas vezes por segundo.
 */
export function typewriter(t: number, chars: number, charsPerSecond = 22): { reveal: number; cursor: boolean; done: boolean } {
  const typed = Math.max(0, t) * charsPerSecond;
  const done = typed >= chars;
  return { reveal: Math.min(typed, chars), cursor: t >= 0 && (!done || Math.floor((t - chars / charsPerSecond) * 4) % 2 === 0), done };
}
