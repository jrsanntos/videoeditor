import { parseRich } from "@videoeditor/renderer";

/**
 * Leitura e escrita de parâmetros de componentes por caminho ("title",
 * "items.1.text"), e conversão entre o texto com *asteriscos* que o renderer
 * entende e a marcação visual de destaque que o usuário vê.
 */

export function getPath(params: Record<string, unknown>, path: string): unknown {
  let cur: unknown = params;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Devolve só a chave de primeiro nível alterada, pronta para `update_clip`
 * (que mescla os params no primeiro nível).
 */
export function setPath(params: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split(".");
  const top = parts[0]!;
  if (parts.length === 1) return { [top]: value };
  const root = structuredClone(params[top]) as Record<string, unknown> | unknown[];
  let cur = root as Record<string, unknown>;
  for (let i = 1; i < parts.length - 1; i++) cur = cur[parts[i]!] as Record<string, unknown>;
  cur[parts[parts.length - 1]!] = value;
  return { [top]: root };
}

export type RichToken = { text: string; emph: boolean };

export const toTokens = (rich: string): RichToken[] => parseRich(rich);

/** Palavras com destaque viram *asteriscos*; destaques vizinhos ficam num grupo só. */
export function fromTokens(tokens: RichToken[]): string {
  let out = "";
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (i) out += " ";
    if (t.emph && !prev?.emph) out += "*";
    out += t.text;
    if (t.emph && !next?.emph) out += "*";
  });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Texto reescrito sem marcação: as palavras que já estavam em destaque continuam. */
export function reEmphasize(before: string, plain: string): string {
  const emphasized = new Set(
    toTokens(before)
      .filter((t) => t.emph)
      .map((t) => norm(t.text)),
  );
  return fromTokens(
    plain
      .replace(/\*/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => ({ text, emph: emphasized.has(norm(text)) })),
  );
}
