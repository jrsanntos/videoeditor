import type { TimelineWord } from "./timeline";

/**
 * Muletas da fala, a partir da transcrição:
 * - "hesitation": som de hesitação sem conteúdo ("hum", "ahn", "éé", "é…"). Sai sempre.
 * - "marker": palavra de apoio dita no vazio ("tipo", "né", "sabe?", "tá?", "assim"),
 *   só quando está solta — entre vírgulas, no fim da frase ou cercada de pausa.
 *   "um tipo de produto" e "faça assim" ficam: a palavra tem função na frase.
 *
 * A transcrição precisa preservar hesitações (o servidor pede isso ao
 * transcritor). Roda no navegador, 0 créditos.
 */
export type Filler = {
  kind: "hesitation" | "marker";
  confidence: "alta" | "media";
  from: string;
  to: string;
  text: string;
};

/** Nível da limpeza: só os sons de hesitação, ou também as palavras de apoio soltas. */
export type FillerLevel = "hesitations" | "all";

// Minúsculas, com acentos (o "é" verbo e o "e" conjunção não podem virar a mesma coisa), sem pontuação.
const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Sons sem conteúdo, inclusive alongados ("hummm", "ééé", "ããã"). "um" sozinho
 * é artigo ou numeral ("número um", "um produto"): só alongado ("uum", "ummm") é hesitação.
 */
export const HESITATION = /^(h+u+m+|h+m+|u{2,}m+|u+m{2,}|u+h+m*|a+h+n+|ã+h*|h+ã+|é+h+|e+h+|é{2,}|e{3,}|a{3,}|ã{2,})$/;
/** Palavras de apoio que só são muleta quando soltas. */
const MARKERS = new Set(["tipo", "né", "sabe", "tá", "assim", "entendeu", "entende"]);
/** Interjeições que às vezes têm sentido ("Ah, entendi"): decisão do agente. */
const MAYBE = new Set(["ah", "eh", "uh", "hã", "ham"]);

const leftOpen = (prev: TimelineWord | undefined, w: TimelineWord) => !prev || /[,.;:!?…]$/.test(prev.text.trim()) || w.start - prev.end > 0.3;
const rightOpen = (w: TimelineWord, next: TimelineWord | undefined) => !next || /[,.;:!?…]$/.test(w.text.trim()) || next.start - w.end > 0.3;

export function findFillers(words: TimelineWord[]): Filler[] {
  const out: Filler[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = words[i - 1];
    const next = words[i + 1];
    const b = bare(w.text);
    const push = (kind: Filler["kind"], confidence: Filler["confidence"], to = w) => out.push({ kind, confidence, from: w.id, to: to.id, text: to === w ? w.text : `${w.text} ${to.text}` });

    // Achado pela segunda escuta ou pelo áudio: não é palavra, sai sempre.
    if (w.disfluency) {
      push("hesitation", "alta");
      continue;
    }
    if (!b) continue;
    // "é…" com reticências, ou "é, é" repetido antes de continuar: hesitação, não o verbo.
    const trailing = /(\.\.\.|…)$/.test(w.text.trim());
    if (HESITATION.test(b) || ((b === "é" || b === "e") && (trailing || (next && bare(next.text) === b && /,$/.test(w.text.trim()))))) {
      push("hesitation", "alta");
      continue;
    }
    // "É," / "Ah," alongado e solto entre pausas: o som de quem está pensando, não o verbo.
    if ((b === "é" || b === "e" || b === "ah") && w.end - w.start >= 0.4 && leftOpen(prev, w) && rightOpen(w, next)) {
      push("hesitation", "alta");
      continue;
    }
    if (MAYBE.has(b) && leftOpen(prev, w) && rightOpen(w, next)) {
      push("hesitation", "media");
      continue;
    }
    if (!MARKERS.has(b)) continue;
    // "tipo assim," solto: as duas saem juntas.
    if (b === "tipo" && next && bare(next.text) === "assim" && leftOpen(prev, w) && rightOpen(next, words[i + 2])) {
      push("marker", "alta", next);
      i++;
      continue;
    }
    if (leftOpen(prev, w) && rightOpen(w, next)) push("marker", "alta");
  }
  return out;
}

/** Filtra pelo nível pedido e pela confiança. */
export function fillersFor(words: TimelineWord[], level: FillerLevel, minConfidence: "alta" | "media" = "alta"): Filler[] {
  return findFillers(words).filter((f) => (level === "all" || f.kind === "hesitation") && (minConfidence === "media" || f.confidence === "alta"));
}
