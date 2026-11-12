import { z } from "zod";
import { drawTopoBackground } from "../background";
import { clamp01, EASE, enter, font, formatNumber, rgba, roundRect, setBlur, stage } from "../draw";
import { drawRich, fitRich, plainText, typewriter } from "../text";
import type { ComponentDef, SoundCue } from "./library";

/**
 * Os seis componentes da v1.0. Todos herdam cores, fontes e credencial do
 * Brand Kit, respeitam as áreas seguras do formato e aceitam *asteriscos* nos
 * textos para a ênfase em serifada itálica.
 */
const define = <S extends z.ZodType>(def: ComponentDef<S>) => def;
const rich = (max: number, what: string) => z.string().min(1).max(max).describe(`${what}. Marque 1–2 palavras de ênfase com *asteriscos*`);
const at = z.number().min(0).optional().describe("instante de entrada, em segundos desde o início do componente; mande atWord com o id da palavra");

const pos = z
  .object({ x: z.number().min(-1).max(1).default(0), y: z.number().min(-1).max(1).default(0) })
  .optional()
  .describe("posição ajustada à mão pelo usuário (fração do quadro); o agente não usa");

const CPS = 24;
/** Sai nos últimos 0,3 s. */
const fadeOut = (t: number, duration: number) => clamp01((duration - t) / 0.3);
/** Som de teclado enquanto um texto é digitado, cortado na duração da digitação. */
const typing = (start: number, text: string): SoundCue[] => [{ at: start, sfx: "digitacao", duration: Math.max(0.3, plainText(text).length / CPS) }];
/** Itens entrando em sequência: pop no primeiro, clique discreto nos seguintes. */
const itemSound = (i: number) => (i === 0 ? ("pop" as const) : ("click_suave" as const));
/** Instante padrão do item `i` quando o agente não sincronizou com a fala. */
const spread = (i: number, n: number, duration: number, first = 0.5) => first + (i * Math.max(0.4, duration - first - 1.2)) / Math.max(1, n);

const depthHookTitle = define({
  id: "depth_hook_title",
  name: "Título de gancho com profundidade",
  description:
    "Gancho dos 3 primeiros segundos: palavra ou frase curta GIGANTE atrás do apresentador (o corpo dele passa na frente do texto), com textos auxiliares opcionais à esquerda e à direita da cabeça. Use uma vez, no início do vídeo.",
  defaultDuration: 3,
  needsPerson: true,
  schema: z.object({
    title: z.string().min(1).max(26).describe("1 a 3 palavras de impacto; aparece em caixa alta"),
    left: rich(48, "texto curto à esquerda da cabeça").optional(),
    right: rich(48, "texto curto à direita da cabeça").optional(),
    titlePos: pos,
    leftPos: pos,
    rightPos: pos,
  }),
  labels: { title: "Título gigante", left: "Texto da esquerda", right: "Texto da direita" },
  positions: { title: "titlePos", left: "leftPos", right: "rightPos" },
  example: { title: "3 erros", left: "que fazem você", right: "*perder dinheiro*" },
  sounds: () => [{ at: 0.1, sfx: "impacto_grave" }],
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, vertical, hasPerson, drawPerson, region }) {
    const p = EASE.snap(stage(t, 0, 0.6));
    const out = fadeOut(t, duration);
    const words = params.title.toUpperCase().split(/\s+/);
    // Duas linhas quando a frase é longa demais para uma só continuar gigante.
    const lines = words.length > 1 && params.title.length > 9 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [words.join(" ")];
    let size = (vertical ? 250 : 300) * u;
    ctx.font = font(900, size);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest > W * 0.94) size *= (W * 0.94) / widest;
    const block = lines.length * size * 0.92;
    // Atrás da pessoa: na altura dos ombros. Sem recorte disponível: acima da cabeça, onde não cobre o rosto.
    const cy = hasPerson ? H * (vertical ? 0.33 : 0.4) : safe.top + block / 2 + 10 * u;

    ctx.save();
    ctx.globalAlpha = out * clamp01(p * 1.5);
    ctx.translate(W / 2 + (params.titlePos?.x ?? 0) * W, cy + (params.titlePos?.y ?? 0) * H);
    ctx.scale(1.2 - 0.2 * p, 1.2 - 0.2 * p);
    setBlur(ctx, (1 - p) * 26 * u);
    ctx.font = font(900, size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => {
      ctx.fillStyle = i === lines.length - 1 && lines.length > 1 ? brand.primaryColor : brand.textColor;
      ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * size * 0.92);
    });
    region("title", -Math.min(widest, W * 0.94) / 2, -block / 2, Math.min(widest, W * 0.94), block);
    ctx.restore();

    drawPerson();

    // Textos auxiliares dos dois lados da cabeça, por cima de tudo.
    // Sempre abaixo do título gigante, para os dois textos não se sobreporem.
    const sideTop = Math.max(H * (vertical ? 0.45 : 0.5), cy + block / 2 + 28 * u);
    const style = { size: 58 * u, weight: 800, color: brand.textColor, emphColor: brand.primaryColor };
    const maxW = (W - safe.left - safe.right) * (vertical ? 0.36 : 0.26);
    const side = (text: string | undefined, right: boolean, delay: number) => {
      if (!text) return;
      const e = EASE.snap(stage(t, delay, 0.5));
      const layout = fitRich(ctx, text, style, maxW, 3);
      const off = right ? params.rightPos : params.leftPos;
      ctx.save();
      ctx.translate((off?.x ?? 0) * W, (off?.y ?? 0) * H);
      ctx.globalAlpha = out;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 14 * u;
      enter(ctx, e, (right ? 70 : -70) * u, 0);
      drawRich(ctx, layout, right ? W - safe.right : safe.left, sideTop, { align: right ? "right" : "left" });
      region(right ? "right" : "left", right ? W - safe.right - layout.width : safe.left, sideTop, layout.width, layout.height);
      ctx.restore();
    };
    side(params.left, false, 0.35);
    side(params.right, true, 0.55);
  },
});

const kineticPivotCard = define({
  id: "kinetic_pivot_card",
  name: "Cartão cinético (tela cheia)",
  description:
    "Cena de tela cheia em fundo escuro: a primeira frase é digitada, gira 90° para a lateral com uma barra de destaque e abre espaço para a frase de conclusão. Substitui b-roll em viradas de raciocínio (problema → solução, mito → verdade). Cobre o apresentador: use por 4 a 6 s.",
  defaultDuration: 5,
  schema: z.object({
    setup: rich(60, "primeira frase (a premissa, o problema, o mito)"),
    punchline: rich(80, "frase de conclusão"),
    pivot: z.object({ at }).optional().describe("quando a primeira frase gira e a conclusão entra"),
  }),
  example: { setup: "Preço não é o problema", punchline: "A *oferta* é que não convence" },
  labels: { setup: "Primeira frase", punchline: "Frase de conclusão", pivot: "Momento da virada" },
  sounds: (params, duration) => {
    const pivotAt = params.pivot?.at ?? pivotDefault(duration);
    return [{ at: 0.05, sfx: "impacto_grave" }, ...typing(0.3, params.setup), { at: pivotAt + 0.1, sfx: "swoosh_texto" }, ...typing(pivotAt + 0.45, params.punchline)];
  },
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, region }) {
    const out = fadeOut(t, duration);
    drawTopoBackground(ctx, W, H, t, brand, Math.min(EASE.snap(t / 0.35), out));
    const pivotAt = params.pivot?.at ?? pivotDefault(duration);
    const q = EASE.swift(stage(t, pivotAt, 0.55));
    const contentW = W - safe.left - safe.right;
    const centerX = safe.left + contentW / 2;
    const base = { weight: 900, color: brand.textColor, emphColor: brand.primaryColor, leading: 1.08 };

    // Frase de abertura: centralizada, depois gira e encosta na lateral.
    const setup = fitRich(ctx, params.setup, { ...base, size: 88 * u }, contentW * 0.92, 4);
    const shrink = 0.6;
    const columnX = safe.left + (setup.height * shrink) / 2 + 24 * u;
    const typed = typewriter(t - 0.3, setup.chars, CPS);
    ctx.save();
    ctx.globalAlpha = out;
    ctx.translate(centerX + (columnX - centerX) * q, H / 2);
    ctx.rotate((-Math.PI / 2) * q);
    ctx.scale(1 - (1 - shrink) * q, 1 - (1 - shrink) * q);
    setBlur(ctx, Math.sin(q * Math.PI) * 16 * u);
    drawRich(ctx, setup, 0, -setup.height / 2, { align: "center", reveal: typed.reveal, cursor: q === 0 && typed.cursor });
    region("setup", -setup.width / 2, -setup.height / 2, setup.width, setup.height);
    ctx.restore();

    // Barra de destaque entre a frase girada e a conclusão.
    const barX = columnX + (setup.height * shrink) / 2 + 30 * u;
    const bar = EASE.snap(stage(t, pivotAt + 0.2, 0.5));
    const barH = Math.min(H * 0.36, setup.width * shrink + 40 * u) * bar;
    ctx.save();
    ctx.globalAlpha = out;
    ctx.fillStyle = brand.primaryColor;
    roundRect(ctx, barX, H / 2 - barH / 2, 8 * u, barH, 4 * u);
    ctx.fill();
    ctx.restore();

    // Conclusão, digitada no espaço que abriu.
    const left = barX + 44 * u;
    const punch = fitRich(ctx, params.punchline, { ...base, size: 84 * u }, W - safe.right - left, 6);
    const typing = typewriter(t - pivotAt - 0.45, punch.chars, CPS);
    if (typing.reveal > 0 || typing.cursor) {
      ctx.save();
      ctx.globalAlpha = out;
      drawRich(ctx, punch, left, H / 2 - punch.height / 2, { reveal: typing.reveal, cursor: typing.cursor });
      region("punchline", left, H / 2 - punch.height / 2, punch.width, punch.height);
      ctx.restore();
    }
  },
});
const pivotDefault = (duration: number) => Math.min(Math.max(duration * 0.42, 1.2), Math.max(1.2, duration - 1.6));

const stepProgress = define({
  id: "step_progress",
  name: "Escada de evolução",
  description:
    "Gráfico vetorial minimalista que sobe degrau a degrau (ou em linha de tendência), cada etapa entrando quando é dita; a última fica em destaque. Para jornadas e progressões: vários 'nãos' até o 'sim', passos de um método, evolução de resultados.",
  defaultDuration: 6,
  schema: z.object({
    title: rich(44, "título curto").optional(),
    steps: z
      .array(z.object({ label: z.string().min(1).max(18).describe("rótulo curto do degrau"), at }))
      .min(2)
      .max(6)
      .describe("do primeiro ao último degrau; o último é o ponto de chegada"),
    style: z.enum(["stairs", "line"]).default("stairs").describe("stairs: escada; line: linha de tendência ascendente"),
    fullscreen: z.boolean().default(true).describe("true: cena de tela cheia em fundo escuro; false: por cima do vídeo"),
  }),
  labels: { title: "Título", steps: "Degraus", label: "Rótulo", style: "Formato", fullscreen: "Tela cheia" },
  example: { title: "Do *não* ao sim", steps: [{ label: "Não" }, { label: "Não" }, { label: "Talvez" }, { label: "Sim" }] },
  sounds: (params, duration) => [
    ...(params.fullscreen ? [{ at: 0.05, sfx: "impacto_grave" as const }] : []),
    // O último degrau é a chegada: conclusão positiva.
    ...params.steps.map((s, i) => ({ at: s.at ?? spread(i, params.steps.length, duration), sfx: i === params.steps.length - 1 ? ("ding" as const) : itemSound(i) })),
  ],
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, vertical, region }) {
    const out = fadeOut(t, duration);
    if (params.fullscreen) drawTopoBackground(ctx, W, H, t, brand, Math.min(EASE.snap(t / 0.35), out));
    const n = params.steps.length;
    const left = safe.left + 30 * u;
    const areaW = W - safe.right - 30 * u - left;
    const areaH = Math.min(H * (vertical ? 0.3 : 0.44), 600 * u);
    const bottom = H * (vertical ? 0.64 : 0.74);
    const stepW = areaW / n;
    const topOf = (i: number) => bottom - ((i + 1) / n) * areaH;

    ctx.save();
    ctx.globalAlpha = out;
    if (!params.fullscreen) {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 16 * u;
    }
    if (params.title) {
      const title = fitRich(ctx, params.title, { size: 68 * u, weight: 900, color: brand.textColor, emphColor: brand.primaryColor }, areaW, 2);
      ctx.save();
      enter(ctx, EASE.snap(stage(t, 0.1, 0.5)), 0, 40 * u);
      drawRich(ctx, title, left, bottom - areaH - title.height - 110 * u);
      region("title", left, bottom - areaH - title.height - 110 * u, title.width, title.height);
      ctx.restore();
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    params.steps.forEach((step, i) => {
      const g = EASE.snap(stage(t, step.at ?? spread(i, n, duration), 0.5));
      if (g <= 0) return;
      const last = i === n - 1;
      const x0 = left + i * stepW;
      const y0 = i === 0 ? bottom : topOf(i - 1);
      const y1 = topOf(i);
      const color = last ? brand.primaryColor : brand.textColor;
      ctx.strokeStyle = rgba(color, last ? 1 : 0.85);
      ctx.lineWidth = (last ? 9 : 6) * u;
      ctx.beginPath();
      if (params.style === "stairs") {
        // Sobe o espelho do degrau e depois corre o piso, na proporção do progresso.
        const rise = y0 - y1;
        const total = rise + stepW;
        const drawn = total * g;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0, y0 - Math.min(drawn, rise));
        if (drawn > rise) ctx.lineTo(x0 + (drawn - rise), y1);
      } else {
        const fromX = i === 0 ? x0 : x0 - stepW / 2;
        const fromY = i === 0 ? bottom : y0;
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(fromX + (x0 + stepW / 2 - fromX) * g, fromY + (y1 - fromY) * g);
      }
      ctx.stroke();

      const cx = x0 + stepW / 2;
      if (params.style === "line" || last) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(params.style === "line" ? cx : x0 + stepW, y1, (last ? 15 : 9) * u * g, 0, Math.PI * 2);
        ctx.fill();
      }
      // Rótulo acima do degrau, encolhido para caber na largura dele.
      let size = (last ? 44 : 34) * u;
      ctx.font = font(last ? 900 : 700, size);
      const w = ctx.measureText(step.label).width;
      if (w > stepW * 0.94) size = Math.max(16 * u, (size * stepW * 0.94) / w);
      ctx.font = font(last ? 900 : 700, size);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = out * g;
      ctx.fillText(step.label, cx, y1 - 26 * u - (1 - g) * 20 * u);
      ctx.globalAlpha = out;
    });
    ctx.restore();
  },
});

const acronymList = define({
  id: "acronym_list",
  name: "Lista lateral / sigla",
  description:
    "Checklist de 2 a 5 itens entrando um a um num lado da tela, cada um quando é dito; ou uma sigla cujas letras se expandem em palavras (mode acronym). Fica por cima do vídeo: combine com um zoom de pan lateral que leve o apresentador para o lado OPOSTO (lista à direita → panX negativo).",
  defaultDuration: 7,
  schema: z.object({
    mode: z.enum(["list", "acronym"]).default("list").describe("list: checklist numerado; acronym: a primeira letra de cada item forma a sigla"),
    title: z.string().max(32).optional().describe("rótulo curto acima da lista"),
    items: z
      .array(z.object({ text: rich(44, "texto do item"), at }))
      .min(2)
      .max(5),
    side: z.enum(["left", "right"]).default("right"),
  }),
  labels: { mode: "Tipo", title: "Rótulo acima da lista", items: "Itens", text: "Texto", side: "Lado da tela" },
  example: { title: "Os 3 erros", items: [{ text: "Tudo na *poupança*" }, { text: "Sem reserva de emergência" }, { text: "Investir sem *objetivo*" }] },
  sounds: (params, duration) => params.items.map((it, i) => ({ at: it.at ?? spread(i, params.items.length, duration, 0.4), sfx: itemSound(i) })),
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, vertical, region }) {
    const out = fadeOut(t, duration);
    const right = params.side === "right";
    const panelW = (W - safe.left - safe.right) * (vertical ? 0.56 : 0.36);
    const x = right ? W - safe.right - panelW : safe.left;
    const rowH = 96 * u;
    const gap = 16 * u;
    const n = params.items.length;
    const total = n * rowH + (n - 1) * gap;
    let y = H * (vertical ? 0.56 : 0.52) - total / 2;
    const from = (right ? 80 : -80) * u;

    ctx.save();
    ctx.globalAlpha = out;
    if (params.title) {
      ctx.save();
      enter(ctx, EASE.snap(stage(t, 0.1, 0.45)), from, 0);
      ctx.font = font(800, 30 * u);
      ctx.fillStyle = brand.primaryColor;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = right ? "right" : "left";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 12 * u;
      ctx.fillText(params.title.toUpperCase(), right ? x + panelW : x, y - 22 * u);
      // Área ocupada pelo rótulo: as legendas desviam dele também.
      region("", x, y - 56 * u, panelW, 40 * u);
      ctx.restore();
    }
    params.items.forEach((item, i) => {
      const start = item.at ?? spread(i, n, duration, 0.4);
      const e = EASE.snap(stage(t, start, 0.45));
      if (e > 0) {
        ctx.save();
        enter(ctx, e, from, 0);
        // Pílula escura translúcida: legível sobre qualquer vídeo.
        ctx.fillStyle = rgba(brand.backgroundColor, 0.8);
        roundRect(ctx, x, y, panelW, rowH, 22 * u);
        ctx.fill();
        const badge = rowH - 28 * u;
        const bx = x + 14 * u;
        const by = y + 14 * u;
        const plain = plainText(item.text);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (params.mode === "acronym") {
          ctx.fillStyle = brand.primaryColor;
          ctx.font = font(900, 62 * u);
          ctx.fillText(plain.charAt(0).toUpperCase(), bx + badge / 2, y + rowH / 2 + 3 * u);
        } else {
          ctx.fillStyle = brand.primaryColor;
          roundRect(ctx, bx, by, badge, badge, 16 * u);
          ctx.fill();
          ctx.fillStyle = brand.backgroundColor;
          ctx.font = font(900, 36 * u);
          ctx.fillText(String(i + 1), bx + badge / 2, by + badge / 2 + 2 * u);
        }
        const tx = bx + badge + 20 * u;
        const layout = fitRich(ctx, item.text, { size: 36 * u, weight: 700, color: brand.textColor, emphColor: brand.primaryColor, leading: 1.1 }, x + panelW - 18 * u - tx, 2, 18 * u);
        // Na sigla, a palavra é digitada a partir da letra; na lista entra inteira.
        const typing = params.mode === "acronym" ? typewriter(t - start - 0.15, layout.chars, CPS * 1.4) : null;
        drawRich(ctx, layout, tx, y + rowH / 2 - layout.height / 2, typing ? { reveal: typing.reveal } : {});
        region(`items.${i}.text`, tx, y + rowH / 2 - layout.height / 2, layout.width, layout.height);
        ctx.restore();
      }
      y += rowH + gap;
    });
    ctx.restore();
  },
});

const executiveLowerThird = define({
  id: "executive_lower_third",
  name: "Tarja executiva",
  description:
    "Tarja minimalista no canto inferior esquerdo com nome e especialidade/registro do profissional. Sem params usa o nome e a credencial do Brand Kit. Use sobre a primeira frase do vídeo, por 3 a 5 s.",
  defaultDuration: 4,
  schema: z.object({
    name: z.string().max(40).optional().describe("omita para usar o nome do Brand Kit"),
    credential: z.string().max(60).optional().describe("omita para usar a credencial do Brand Kit"),
  }),
  example: { name: "Dra. Ana Silva", credential: "Cardiologista • CRM 12345" },
  labels: { name: "Nome", credential: "Registro ou cargo" },
  sounds: () => [{ at: 0.2, sfx: "swoosh_texto" }],
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, region }) {
    const name = params.name ?? brand.displayName;
    const credential = params.credential ?? (params.name ? "" : brand.credential);
    if (!name) return;
    const out = fadeOut(t, duration);
    const maxW = W - safe.left - safe.right - 60 * u;
    let nameSize = 50 * u;
    ctx.font = font(700, nameSize);
    let nameW = ctx.measureText(name).width;
    if (nameW > maxW) {
      nameSize *= maxW / nameW;
      nameW = maxW;
    }
    let credSize = 34 * u;
    ctx.font = font(600, credSize);
    let credW = credential ? ctx.measureText(credential).width : 0;
    if (credW > maxW) {
      credSize *= maxW / credW;
      credW = maxW;
    }
    const padX = 30 * u;
    const w = Math.max(nameW, credW) + padX * 2 + 14 * u;
    const h = (credential ? 132 : 92) * u;
    const x = safe.left;
    // Acima da faixa onde ficam as legendas.
    const y = H - safe.bottom - h - 150 * u;

    const line = EASE.snap(stage(t, 0, 0.45));
    const wipe = EASE.snap(stage(t, 0.15, 0.6));
    ctx.save();
    ctx.globalAlpha = out;
    // A tarja abre da linha para a direita.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 4 * u, w * wipe, h + 8 * u);
    ctx.clip();
    ctx.fillStyle = "rgba(15,23,42,0.78)";
    roundRect(ctx, x, y, w, h, 10 * u);
    ctx.fill();
    ctx.translate(-24 * u * (1 - wipe), 0);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = brand.textColor;
    ctx.font = font(700, nameSize);
    ctx.fillText(name, x + padX + 8 * u, y + (credential ? 58 : 62) * u);
    region("name", x + padX + 8 * u, y + (credential ? 58 : 62) * u - nameSize * 0.85, nameW, nameSize);
    if (credential) {
      ctx.fillStyle = rgba(brand.textColor, 0.82);
      ctx.font = font(600, credSize);
      ctx.fillText(credential, x + padX + 8 * u, y + 106 * u);
      region("credential", x + padX + 8 * u, y + 106 * u - credSize * 0.85, credW, credSize);
    }
    ctx.restore();
    ctx.fillStyle = brand.primaryColor;
    ctx.fillRect(x, y + (h * (1 - line)) / 2, 6 * u, h * line);
    ctx.restore();
  },
});

const statCounter = define({
  id: "stat_counter",
  name: "Número em destaque",
  description:
    "Dado numérico com contador animado (de 0 ao valor final) e uma legenda. Use sempre que a pessoa citar um número forte: resultado, porcentagem, prazo, valor, prova social.",
  defaultDuration: 4,
  schema: z.object({
    value: z.number().describe("valor final"),
    from: z.number().default(0),
    prefix: z.string().max(6).default("").describe('ex.: "R$ ", "+"'),
    suffix: z.string().max(8).default("").describe('ex.: "%", " mil", "x"'),
    decimals: z.number().int().min(0).max(2).default(0),
    label: rich(56, "o que o número significa").optional(),
    fullscreen: z.boolean().default(false).describe("true: cena de tela cheia em fundo escuro, para o número mais importante do vídeo"),
  }),
  example: { value: 30, suffix: "%", prefix: "+", label: "de retorno para quem tem *objetivo*" },
  labels: { value: "Valor final", from: "Começa em", prefix: "Antes do número", suffix: "Depois do número", decimals: "Casas decimais", label: "Legenda do número", fullscreen: "Tela cheia" },
  sounds: (params, duration) => {
    const end = 0.2 + countTime(duration);
    const money = /\$/.test(params.prefix);
    return [
      // Teclas enquanto conta; no valor final: caixa registradora para dinheiro, impacto na tela cheia, pop no resto.
      ...Array.from({ length: Math.min(8, Math.floor(countTime(duration) / 0.14)) }, (_, i) => ({ at: 0.25 + i * 0.14, sfx: "tecla" as const })),
      { at: end, sfx: money ? ("caixa_registradora" as const) : params.fullscreen ? ("impacto_grave" as const) : ("pop" as const) },
    ];
  },
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, vertical, region }) {
    const out = fadeOut(t, duration);
    if (params.fullscreen) drawTopoBackground(ctx, W, H, t, brand, Math.min(EASE.snap(t / 0.35), out));
    const k = EASE.snap(stage(t, 0.2, countTime(duration)));
    const text = `${params.prefix}${formatNumber(params.from + (params.value - params.from) * k, params.decimals)}${params.suffix}`;
    const finalText = `${params.prefix}${formatNumber(params.value, params.decimals)}${params.suffix}`;
    const maxW = (W - safe.left - safe.right) * (params.fullscreen ? 0.94 : vertical ? 0.8 : 0.42);
    // O corpo é calculado com o valor final: o número não muda de tamanho enquanto conta.
    let size = (params.fullscreen ? 260 : 170) * u;
    ctx.font = font(900, size);
    const w = ctx.measureText(finalText).width;
    if (w > maxW) size *= maxW / w;
    const label = params.label
      ? fitRich(ctx, params.label, { size: (params.fullscreen ? 52 : 40) * u, weight: 700, color: brand.textColor, emphColor: brand.primaryColor }, maxW, 3)
      : null;
    const blockH = size + (label ? label.height + 22 * u : 0);
    const cy = H * (params.fullscreen ? 0.5 : vertical ? 0.7 : 0.6);
    // Centralizado na área segura: no vertical ela é deslocada para a esquerda pelos botões do app.
    const cx = safe.left + (W - safe.left - safe.right) / 2;
    const top = cy - blockH / 2;

    ctx.save();
    ctx.globalAlpha = out;
    enter(ctx, EASE.snap(stage(t, 0, 0.5)), 0, 70 * u);
    if (!params.fullscreen) {
      const padX = 44 * u;
      const cardW = Math.max(Math.min(w, maxW), label?.width ?? 0) + padX * 2;
      ctx.fillStyle = rgba(brand.backgroundColor, 0.82);
      roundRect(ctx, cx - cardW / 2, top - 30 * u, cardW, blockH + 60 * u, 28 * u);
      ctx.fill();
      // O cartão inteiro ocupa a tela: as legendas desviam dele.
      region("", cx - cardW / 2, top - 30 * u, cardW, blockH + 60 * u);
    }
    // Pequeno pulso quando o contador chega ao valor final.
    const pulse = 1 + 0.06 * Math.sin(Math.PI * stage(t, 0.2 + countTime(duration), 0.35));
    ctx.save();
    ctx.translate(cx, top + size / 2);
    ctx.scale(pulse, pulse);
    ctx.font = font(900, size);
    ctx.fillStyle = brand.primaryColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, size * 0.04);
    ctx.restore();
    if (label) {
      drawRich(ctx, label, cx, top + size + 22 * u, { align: "center" });
      region("label", cx - label.width / 2, top + size + 22 * u, label.width, label.height);
    }
    ctx.restore();
  },
});
const countTime = (duration: number) => Math.min(1.6, duration * 0.5);

export const V1_COMPONENTS = [depthHookTitle, kineticPivotCard, stepProgress, acronymList, executiveLowerThird, statCounter];
