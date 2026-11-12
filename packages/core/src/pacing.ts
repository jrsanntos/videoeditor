import type { Clip, ComponentClip, Project, ZoomClip } from "./schema";
import { clipEnd, mainClips, projectDuration, r3, timelineWords, type TimelineWord } from "./timeline";

/**
 * Ritmo da edição: o que separa um vídeo editado por um profissional de um
 * vídeo com efeitos jogados em cima. Aqui ficam o orçamento de densidade de
 * cada estilo e o auditor que mede a timeline contra ele.
 *
 * O auditor é determinístico. O agente recebe o laudo depois de cada etapa e
 * corrige; o que ainda colidir no fim é podado por `enforcePacing`.
 */
export type PacingProfile = {
  /** Máximo de segundos seguidos sem zoom nem componente na tela. */
  maxStatic: number;
  /** Distância mínima (s) entre o início de dois componentes. */
  componentGap: number;
  /** Respiro mínimo (s) entre o fim de uma cena de tela cheia e o início da próxima. */
  fullscreenGap: number;
  /** Máximo de entradas visuais (zooms + componentes) em qualquer janela de 5 s. */
  maxPer5s: number;
  /** Faixa de componentes por minuto de vídeo. */
  componentsPerMin: [number, number];
  /** Faixa de zooms por minuto de vídeo. */
  zoomsPerMin: [number, number];
  /** Abaixo disso o zoom não é percebido por quem assiste. */
  minZoomScale: number;
  /** Punch-ins secos seguidos tolerados antes de exigir outra modalidade. */
  maxPunchStreak: number;
  /** O estilo pede legendas ligadas. */
  captions: boolean;
  /** Gancho e fecho precisam de tratamento visual (falso em estilos de pura decupagem). */
  edges: boolean;
};

export const DEFAULT_PACING: PacingProfile = {
  maxStatic: 9,
  componentGap: 4,
  fullscreenGap: 8,
  maxPer5s: 3,
  componentsPerMin: [2, 5],
  zoomsPerMin: [5, 10],
  minZoomScale: 1.1,
  maxPunchStreak: 2,
  captions: true,
  edges: true,
};

/** Cenas que cobrem o apresentador. O core só conhece os ids; o desenho fica no renderer. */
export function isFullscreen(clip: ComponentClip): boolean {
  if (clip.component === "kinetic_pivot_card" || clip.component === "title_card") return true;
  if (clip.component === "step_progress") return clip.params.fullscreen !== false;
  if (clip.component === "stat_counter") return clip.params.fullscreen === true;
  return false;
}

export type PacingIssue = {
  severity: "erro" | "aviso";
  code:
    | "hook"
    | "estatico"
    | "densidade"
    | "componentes_colados"
    | "tela_cheia_seguida"
    | "sobreposicao"
    | "zoom_sobreposto"
    | "zoom_fraco"
    | "punch_repetido"
    | "poucos_componentes"
    | "muitos_componentes"
    | "poucos_zooms"
    | "muitos_zooms"
    | "final"
    | "legendas";
  message: string;
  clipIds?: string[];
};

export type PacingAudit = {
  duration: number;
  zooms: number;
  components: number;
  cuts: number;
  /** Maior trecho sem nenhum tratamento visual, em segundos. */
  longestStatic: number;
  buckets: { start: number; end: number; zooms: number; components: number }[];
  issues: PacingIssue[];
};

const BUCKET = 5;

function visuals(project: Project) {
  const zooms: ZoomClip[] = [];
  const components: ComponentClip[] = [];
  for (const t of project.tracks)
    for (const c of t.clips) {
      if (c.type === "zoom") zooms.push(c);
      else if (c.type === "component") components.push(c);
    }
  zooms.sort((a, b) => a.start - b.start);
  components.sort((a, b) => a.start - b.start);
  return { zooms, components };
}

/** "w12–w30 (4.2–11.8s)": o agente trabalha por palavra, então todo trecho vem ancorado nelas. */
function span(words: TimelineWord[], start: number, end: number): string {
  const inside = words.filter((w) => w.end > start && w.start < end);
  const time = `${r3(start)}–${r3(end)}s`;
  return inside.length ? `${inside[0]!.id}–${inside[inside.length - 1]!.id} (${time})` : time;
}

export function auditPacing(project: Project, profile: PacingProfile = DEFAULT_PACING): PacingAudit {
  const duration = mainClips(project).reduce((m, c) => Math.max(m, clipEnd(c)), 0) || projectDuration(project);
  const { zooms, components } = visuals(project);
  const words = timelineWords(project);
  const issues: PacingIssue[] = [];
  const minutes = Math.max(duration / 60, 0.25);

  const buckets: PacingAudit["buckets"] = [];
  for (let s = 0; s < duration; s += BUCKET) {
    const e = Math.min(duration, s + BUCKET);
    buckets.push({
      start: s,
      end: r3(e),
      zooms: zooms.filter((z) => z.start >= s && z.start < e).length,
      components: components.filter((c) => c.start >= s && c.start < e).length,
    });
  }

  // Trechos parados: intervalos que nenhum zoom nem componente cobre.
  const covered = [...zooms, ...components].map((c) => ({ start: c.start, end: clipEnd(c) })).sort((a, b) => a.start - b.start);
  let cursor = 0;
  let longestStatic = 0;
  const gaps: { start: number; end: number }[] = [];
  for (const c of [...covered, { start: duration, end: duration }]) {
    if (c.start - cursor > 0.05) gaps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  for (const g of gaps) {
    const len = g.end - g.start;
    longestStatic = Math.max(longestStatic, len);
    if (len > profile.maxStatic)
      issues.push({
        severity: "erro",
        code: "estatico",
        message: `${r3(len)}s parados em ${span(words, g.start, g.end)}: nenhum zoom nem componente. O limite deste estilo é ${profile.maxStatic}s. Trate a frase mais forte do trecho.`,
      });
  }

  if (profile.edges && duration > 4) {
    const firstVisual = Math.min(zooms[0]?.start ?? Infinity, components[0]?.start ?? Infinity);
    if (firstVisual > 1.5)
      issues.push({
        severity: "erro",
        code: "hook",
        message: `O gancho (primeiros 3s, ${span(words, 0, 3)}) está sem tratamento: nada acontece na tela até ${Number.isFinite(firstVisual) ? `${r3(firstVisual)}s` : "o fim"}. É onde se decide se a pessoa continua assistindo.`,
      });
    const tail = Math.max(0, duration - 4);
    if (duration > 12 && !covered.some((c) => c.end > tail + 0.5))
      issues.push({ severity: "aviso", code: "final", message: `O fechamento (${span(words, tail, duration)}) está sem tratamento: destaque a conclusão ou a chamada para ação.` });
  }

  // Densidade: qualquer janela de 5 s.
  const starts = [...zooms, ...components].map((c) => c.start).sort((a, b) => a - b);
  let flaggedUntil = -1;
  starts.forEach((s, i) => {
    if (s < flaggedUntil) return;
    let n = 0;
    while (i + n < starts.length && starts[i + n]! < s + BUCKET) n++;
    if (n > profile.maxPer5s) {
      flaggedUntil = s + BUCKET;
      const crowd = [...zooms, ...components].filter((c) => c.start >= s && c.start < s + BUCKET).sort((a, b) => a.start - b.start);
      issues.push({
        severity: "erro",
        code: "densidade",
        clipIds: crowd.map((c) => c.id),
        message: `${n} entradas visuais em 5s em ${span(words, s, s + BUCKET)} (máximo ${profile.maxPer5s}): ${crowd.map((c) => c.id).join(", ")}. Fica poluído: mantenha a mais importante e remova (delete_clip) ou afaste as outras.`,
      });
    }
  });

  for (let i = 1; i < components.length; i++) {
    const a = components[i - 1]!;
    const b = components[i]!;
    const overlap = b.start < clipEnd(a) - 0.05;
    if (overlap && (isFullscreen(a) || isFullscreen(b) || a.component === b.component))
      issues.push({
        severity: "erro",
        code: "sobreposicao",
        clipIds: [a.id, b.id],
        message: `${a.component} (${a.id}) e ${b.component} (${b.id}) estão na tela ao mesmo tempo e um cobre o outro. Encurte o primeiro ou mova o segundo.`,
      });
    else if (b.start - a.start < profile.componentGap)
      issues.push({
        severity: "erro",
        code: "componentes_colados",
        clipIds: [a.id, b.id],
        message: `${a.id} e ${b.id} entram com ${r3(b.start - a.start)}s de diferença (mínimo ${profile.componentGap}s). Sem respiro o olho não lê nenhum dos dois: junte num componente só ou afaste.`,
      });
    if (isFullscreen(a) && isFullscreen(b) && !overlap && b.start - clipEnd(a) < profile.fullscreenGap)
      issues.push({
        severity: "erro",
        code: "tela_cheia_seguida",
        clipIds: [a.id, b.id],
        message: `Duas cenas de tela cheia quase seguidas (${a.id}, ${b.id}): o apresentador some por tempo demais. Deixe pelo menos ${profile.fullscreenGap}s com ele na tela entre uma e outra.`,
      });
  }

  for (let i = 1; i < zooms.length; i++) {
    const a = zooms[i - 1]!;
    const b = zooms[i]!;
    if (b.start < clipEnd(a) - 0.05)
      issues.push({ severity: "erro", code: "zoom_sobreposto", clipIds: [a.id, b.id], message: `Os zooms ${a.id} e ${b.id} se sobrepõem: a câmera salta. Termine um antes de começar o outro.` });
  }
  const weak = zooms.filter((z) => z.scale < profile.minZoomScale);
  if (weak.length)
    issues.push({
      severity: "erro",
      code: "zoom_fraco",
      clipIds: weak.map((z) => z.id),
      message: `${weak.length} zoom(s) com escala abaixo de ${profile.minZoomScale}x (${weak.map((z) => `${z.id}: ${z.scale}x`).join(", ")}): quem assiste não percebe. Use pelo menos ${profile.minZoomScale}x no avanço lento e 1.18x no punch-in.`,
    });

  // Alternância de modalidade: punch-ins seguidos sem outra coisa no meio cansam.
  const isPunch = (c: Clip) => c.type === "zoom" && c.mode === "hold" && c.ease === 0;
  const ordered = [...zooms, ...components].sort((a, b) => a.start - b.start);
  let streak: Clip[] = [];
  let streakFlagged = false;
  for (const c of ordered) {
    if (isPunch(c)) {
      streak.push(c);
      if (streak.length > profile.maxPunchStreak && !streakFlagged) {
        streakFlagged = true;
        issues.push({
          severity: "aviso",
          code: "punch_repetido",
          clipIds: streak.map((s) => s.id),
          message: `${streak.length}+ punch-ins secos seguidos a partir de ${span(words, streak[0]!.start, clipEnd(c))}. Alterne a modalidade: a próxima ênfase vai em tipografia (componente), avanço lento ou pan.`,
        });
      }
    } else streak = [];
  }

  const perMin = (n: number) => r3(n / minutes);
  const check = (n: number, [min, max]: [number, number], few: PacingIssue["code"], many: PacingIssue["code"], what: string) => {
    const lo = Math.floor(min * minutes);
    const hi = Math.max(1, Math.ceil(max * minutes));
    if (n < lo) issues.push({ severity: "erro", code: few, message: `Só ${n} ${what} em ${r3(duration)}s (${perMin(n)}/min). Este estilo pede de ${lo} a ${hi} neste vídeo.` });
    else if (n > hi) issues.push({ severity: "erro", code: many, message: `${n} ${what} em ${r3(duration)}s (${perMin(n)}/min) é demais. Este estilo pede de ${lo} a ${hi} neste vídeo: corte os menos importantes.` });
  };
  check(components.length, profile.componentsPerMin, "poucos_componentes", "muitos_componentes", "componente(s)");
  check(zooms.length, profile.zoomsPerMin, "poucos_zooms", "muitos_zooms", "zoom(s)");

  if (profile.captions && words.length && !project.captions.enabled)
    issues.push({ severity: "aviso", code: "legendas", message: "As legendas estão desligadas; este estilo usa legendas (a maior parte das pessoas assiste sem som)." });

  return {
    duration: r3(duration),
    zooms: zooms.length,
    components: components.length,
    cuts: Math.max(0, mainClips(project).length - 1),
    longestStatic: r3(longestStatic),
    buckets,
    issues,
  };
}

/** O que está na tela, em ordem, com os ids: é como o agente "assiste" ao que acabou de montar. */
export function visualsReport(project: Project): string {
  const { zooms, components } = visuals(project);
  const words = timelineWords(project);
  const all = [...zooms, ...components].sort((a, b) => a.start - b.start);
  if (!all.length) return "Na tela agora: nenhum zoom nem componente.";
  return [
    "Na tela agora (id | trecho | o quê):",
    ...all.map((c) =>
      c.type === "zoom"
        ? `${c.id} | ${span(words, c.start, clipEnd(c))} | zoom ${c.scale}x ${c.mode === "creep" ? "avanço lento" : c.ease === 0 ? "punch-in" : "suave"}${Math.abs(c.panX) >= 0.05 ? ` pan ${c.panX}` : ""}`
        : `${c.id} | ${span(words, c.start, clipEnd(c))} | ${c.component}${isFullscreen(c) ? " (tela cheia)" : ""}`,
    ),
  ].join("\n");
}

/** Laudo em texto para o agente: densidade por janela e o que precisa ser corrigido. */
export function pacingReport(audit: PacingAudit): string {
  const lines = [
    `Auditoria de ritmo — ${audit.duration}s, ${audit.cuts} corte(s), ${audit.zooms} zoom(s), ${audit.components} componente(s); maior trecho parado: ${audit.longestStatic}s.`,
    `Densidade por janela de 5s (zooms+componentes): ${audit.buckets.map((b) => `${b.start}–${b.end}s:${b.zooms}+${b.components}`).join(" | ") || "—"}`,
  ];
  const errors = audit.issues.filter((i) => i.severity === "erro");
  const warnings = audit.issues.filter((i) => i.severity === "aviso");
  if (!audit.issues.length) lines.push("Nenhum problema de ritmo.");
  if (errors.length) lines.push("Corrija (obrigatório):", ...errors.map((i) => `- [${i.code}] ${i.message}`));
  if (warnings.length) lines.push("Avalie:", ...warnings.map((i) => `- [${i.code}] ${i.message}`));
  return lines.join("\n");
}

/**
 * Poda determinística do que ainda colide depois da revisão do agente. Só
 * remove ou encurta: nunca cria nada. Devolve o que fez, para o registro.
 */
export function enforcePacing(project: Project, profile: PacingProfile = DEFAULT_PACING): { project: Project; log: string[] } {
  const next = structuredClone(project);
  const log: string[] = [];
  const drop = (id: string) => {
    for (const t of next.tracks) t.clips = t.clips.filter((c) => c.id !== id);
  };

  // Zooms sobrepostos: o primeiro termina onde o segundo começa.
  let { zooms } = visuals(next);
  for (let i = 1; i < zooms.length; i++) {
    const a = zooms[i - 1]!;
    const b = zooms[i]!;
    if (b.start >= clipEnd(a) - 0.05) continue;
    const left = r3(b.start - a.start);
    if (left < 0.6) {
      drop(a.id);
      log.push(`zoom ${a.id} removido (sobreposto ao seguinte)`);
    } else {
      a.duration = left;
      a.ease = Math.min(a.ease, left / 2);
      log.push(`zoom ${a.id} encurtado para não se sobrepor ao seguinte`);
    }
  }

  // Componentes que se cobrem ou entram colados: fica o primeiro.
  let { components } = visuals(next);
  let kept: ComponentClip[] = [];
  for (const c of components) {
    const clash = kept.find((k) => {
      const overlap = c.start < clipEnd(k) - 0.05;
      if (overlap && (isFullscreen(k) || isFullscreen(c) || k.component === c.component)) return true;
      if (c.start - k.start < Math.min(profile.componentGap, 2)) return true;
      return isFullscreen(k) && isFullscreen(c) && c.start - clipEnd(k) < profile.fullscreenGap / 2;
    });
    if (clash) {
      drop(c.id);
      log.push(`componente ${c.component} (${c.id}) removido: colidia com ${clash.id}`);
    } else kept.push(c);
  }

  // Excesso numa janela de 5 s: saem primeiro os zooms mais fracos.
  for (let guard = 0; guard < 50; guard++) {
    ({ zooms, components } = visuals(next));
    const all = [...zooms, ...components].sort((a, b) => a.start - b.start);
    const crowded = all.find((c, i) => all.filter((o, j) => j >= i && o.start < c.start + BUCKET).length > profile.maxPer5s);
    if (!crowded) break;
    const inWindow = all.filter((o) => o.start >= crowded.start && o.start < crowded.start + BUCKET);
    const victim = inWindow.filter((o): o is ZoomClip => o.type === "zoom").sort((a, b) => a.scale - b.scale)[0] ?? inWindow[inWindow.length - 1]!;
    drop(victim.id);
    log.push(`${victim.type === "zoom" ? "zoom" : "componente"} ${victim.id} removido: janela de 5s acima do limite`);
  }
  kept = [];
  return { project: next, log };
}
