import type { TimelineWord } from "./timeline";

/**
 * Detecção de takes ruins (erros de gravação) a partir da transcrição:
 * - "restart": a pessoa começa uma frase, para e recomeça com as mesmas palavras
 *   ("o segredo do… o segredo do sucesso é"). Corta-se tudo até o recomeço,
 *   ficando o último take.
 * - "stutter": a mesma palavra dita duas vezes seguidas, ou uma palavra truncada.
 * - "marker": a pessoa avisa que errou ("errei", "de novo", "corta"). O corte
 *   sugerido vai do início da frase até o aviso — ou, quando a pessoa recomeça
 *   depois do aviso, do início do take abandonado até o recomeço.
 * - "correction": a pessoa se corrige no meio da frase ("são três, quer dizer,
 *   na verdade são quatro"). A informação nova fica entre o aviso e a
 *   repetição, então o corte certo depende de leitura: sempre "media".
 *
 * É determinístico e roda no navegador (0 créditos). "alta" pode ser cortado
 * direto; "media" precisa do julgamento do agente ou do usuário, porque
 * repetição também é recurso retórico ("você precisa de foco, você precisa de método").
 */
export type Retake = {
  /** correction: autocorreção ("três, quer dizer, quatro") — nunca é cortada sozinha, porque a parte nova fica no meio. */
  kind: "restart" | "stutter" | "marker" | "correction";
  confidence: "alta" | "media";
  /** Primeira e última palavra a cortar (inclusive). */
  from: string;
  to: string;
  cutText: string;
  /** Início do take que fica, para conferência. */
  keepText: string;
};

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const endsSentence = (t: string) => /[.!?]["')\]]?$/.test(t.trim());
const truncated = (t: string) => /(-|…|\.\.\.)$/.test(t.trim());

/** Avisos de erro, já normalizados (sem acento/pontuação), como sequências de palavras. */
const MARKERS = [
  ["errei"],
  ["de", "novo"],
  ["denovo"],
  ["vou", "repetir"],
  ["vou", "refazer"],
  ["vou", "falar", "de", "novo"],
  ["vou", "comecar", "de", "novo"],
  ["comecando", "de", "novo"],
  ["corta"],
  ["cortar", "essa", "parte"],
  ["corta", "isso"],
  ["perai"],
  ["pera", "ai"],
  ["espera", "ai"],
  ["nao", "nao", "nao"],
  ["ops"],
  ["desculpa"],
  ["apaga", "isso"],
].sort((a, b) => b.length - a.length);

/** Conjunções que introduzem um paralelismo ("estão causando X e estão causando Y"): repetição de propósito. */
const PARALLEL = new Set(["e", "ou", "mas", "nem", "que", "porque", "quando", "como", "se", "pois"]);

/** Expressões de autocorreção, já normalizadas. */
const CORRECTIONS = [["quer", "dizer"], ["na", "verdade"], ["alias"], ["ou", "melhor"], ["melhor", "dizendo"], ["corrigindo"], ["digo"]].sort((a, b) => b.length - a.length);

/** Recomeço procurado até esta distância (palavras / segundos) do início do take ruim. */
const MAX_LOOKAHEAD_WORDS = 30;
const MAX_LOOKAHEAD_SEC = 20;

export function findRetakes(words: TimelineWord[]): Retake[] {
  const n = words.map((w) => norm(w.text));
  const out: Retake[] = [];
  const text = (a: number, b: number) =>
    words
      .slice(a, b)
      .map((w) => w.text)
      .join(" ");
  const push = (kind: Retake["kind"], confidence: Retake["confidence"], a: number, b: number) =>
    out.push({
      kind,
      confidence,
      from: words[a]!.id,
      to: words[b - 1]!.id,
      cutText: text(a, b),
      keepText: text(b, Math.min(words.length, b + 6)),
    });
  /** Início da frase que contém a palavra `i`. */
  const sentenceStart = (i: number) => {
    let s = i;
    while (s > 0 && !endsSentence(words[s - 1]!.text) && words[s]!.start - words[s - 1]!.end < 1) s--;
    return s;
  };

  /** Primeira ocorrência de alguma sequência de `list` que começa em [a, b). */
  const seqIn = (list: string[][], a: number, b: number) => {
    for (let x = a; x < b; x++) {
      const m = list.find((seq) => seq.every((tok, k) => n[x + k] === tok));
      if (m) return { at: x, end: x + m.length, seq: m };
    }
    return null;
  };
  /** Aviso de erro "forte" (não ambíguo) dentro do trecho. */
  const strongMarkerIn = (a: number, b: number) => {
    for (let x = a; x < b; x++) {
      const m = MARKERS.find((seq) => seq.every((tok, k) => n[x + k] === tok));
      if (!m) continue;
      const end = x + m.length;
      const isolated = end >= words.length || endsSentence(words[end - 1]!.text) || /,$/.test(words[end - 1]!.text.trim()) || words[end]!.start - words[end - 1]!.end > 0.4;
      if (m[0] === "errei" || m.length >= 3 || isolated) return true;
    }
    return false;
  };

  let i = 0;
  while (i < words.length) {
    if (!n[i]) {
      i++;
      continue;
    }

    // Aviso de erro: corta do início da frase até o fim do aviso.
    const marker = MARKERS.find((m) => m.every((tok, k) => n[i + k] === tok));
    if (marker) {
      // "de novo" só conta como aviso no fim de frase ou antes de pausa ("faça de novo amanhã" não é erro).
      const end = i + marker.length;
      const isolated = end >= words.length || endsSentence(words[end - 1]!.text) || words[end]!.start - words[end - 1]!.end > 0.4;
      const strong = marker[0] === "errei" || marker.length >= 3;
      if (isolated || strong) {
        push("marker", strong && isolated ? "alta" : "media", sentenceStart(i), end);
        i = end;
        continue;
      }
    }

    // Palavra truncada pelo transcritor ("apre-", "apre…") seguida da versão completa.
    if (truncated(words[i]!.text) && i + 1 < words.length && n[i + 1]!.startsWith(n[i]!) && n[i]!.length >= 2) {
      push("stutter", "alta", i, i + 1);
      i++;
      continue;
    }

    // Recomeço: as mesmas k palavras de `i` reaparecem em `j`, um pouco adiante.
    let best: { j: number; k: number } | null = null;
    for (let j = i + 1; j < words.length && j - i <= MAX_LOOKAHEAD_WORDS && words[j]!.start - words[i]!.start <= MAX_LOOKAHEAD_SEC; j++) {
      if (n[j] !== n[i]) continue;
      let k = 1;
      // O trecho repetido não pode invadir o próprio recomeço.
      while (i + k < j && j + k < words.length && n[i + k] && n[i + k] === n[j + k]) k++;
      const adjacent = k === j - i;
      const letters = n.slice(i, i + k).join("").length;
      // Uma palavra só vale colada e com 4+ letras ("mudar mudar"); senão exige 2+ palavras
      // com algum conteúdo, para não casar "o … o" ou "e a … e a".
      const enough = k === 1 ? adjacent && letters >= 4 : k >= 3 || letters >= 6;
      if (!enough) continue;
      // Retomada imediata: sem pausa longa entre os takes quando estão colados.
      if (adjacent && words[j]!.start - words[j - 1]!.end > 1.5) continue;
      if (!best || k > best.k) best = { j, k };
    }
    if (best) {
      const { j, k } = best;
      const adjacent = k === j - i;
      // Aviso de erro entre o take abandonado e o recomeço ("como apre… pera, errei. Eu vou mostrar como"):
      // é erro certo, e o corte vai do começo do take ruim até o recomeço.
      if (strongMarkerIn(i + 1, j)) {
        push("marker", "alta", i, j);
        i = j;
        continue;
      }
      // Autocorreção ("três formas, quer dizer, na verdade são quatro formas"): cortar até o recomeço
      // apagaria a correção. Vai para revisão. O corte sugerido leva a palavra corrigida (logo antes da
      // repetição) e a expressão, e deixa a palavra nova (logo antes do recomeço): "três formas…, quer
      // dizer, na verdade são | quatro formas de ganhar dinheiro".
      const cue = seqIn(CORRECTIONS, i + 1, j);
      if (cue) {
        push("correction", "media", Math.max(sentenceStart(i), i - 1), Math.max(cue.end, j - 1));
        i = j;
        continue;
      }
      // Fala natural repete o tempo todo ("a guarnição…, evitando que a guarnição", "aquele indivíduo X,
      // aquele indivíduo Y", "estão causando X e estão causando Y"). Só é erro CERTO o take claramente
      // abandonado: curto, sem pontuação (o transcritor pontua o que foi concluído) e sem conjunção de
      // paralelismo logo antes da repetição. O resto vai para a leitura do agente.
      const span = words.slice(i, j);
      const punctuated = span.some((w) => /[,.;:!?…]$/.test(w.text.trim()));
      // Com acento: o verbo "é" não é a conjunção "e".
      const parallel = PARALLEL.has(words[j - 1]!.text.toLowerCase().replace(/[^\p{L}]/gu, ""));
      const abandoned = !punctuated && !parallel && j - (i + k) <= 3 && j - i <= 8;
      const confidence = adjacent || abandoned ? "alta" : "media";
      push(adjacent && k === 1 ? "stutter" : "restart", confidence, i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}
