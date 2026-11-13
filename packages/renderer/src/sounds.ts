import { hasSpeed, rateAverage, type Project } from "@videoeditor/core";
import { COMPONENTS, type SfxId } from "./components/library";

/**
 * Design sonoro. Os efeitos são derivados do estado da timeline (função pura):
 * o preview e a exportação tocam exatamente a mesma lista de eventos.
 *
 * Os sons vêm do catálogo em apps/web/public/sfx. Cada entrada traz o nível
 * (relativo à voz), onde o pico deve cair em relação ao evento visual e os
 * limites de uso — as regras do catálogo viram código aqui, não ficam a cargo
 * de quem monta a edição.
 */
export type SfxSpec = {
  file: string;
  /** Nível de pico desejado, em dB. */
  level: number;
  /** Pico do arquivo original, em dBFS (para chegar ao nível desejado). */
  filePeak: number;
  /** Onde, dentro do arquivo, está o pico (s). */
  peakAt: number;
  /** Onde o pico cai em relação ao evento visual (negativo = antes). */
  offset: number;
  /** Intervalo mínimo entre dois usos (s). Infinity = uma vez por vídeo. */
  minGap: number;
  /** Som contínuo, cortado na duração do evento (digitação). */
  sustained?: boolean;
};

export const SFX_CATALOG = {
  whoosh_rapido: { file: "whoosh_rapido.mp3", level: -14, filePeak: -2.3, peakAt: 0.16, offset: -0.1, minGap: 3 },
  whoosh_longo: { file: "whoosh_longo.mp3", level: -12, filePeak: -3.2, peakAt: 0.7, offset: -0.4, minGap: 20 },
  zoom_punch: { file: "zoom_punch.mp3", level: -16, filePeak: -3.5, peakAt: 0.59, offset: -0.03, minGap: 2 },
  swoosh_texto: { file: "swoosh_texto.mp3", level: -20, filePeak: -3.9, peakAt: 0.09, offset: -0.05, minGap: 1 },
  pop: { file: "pop.mp3", level: -18, filePeak: -5.4, peakAt: 0.03, offset: 0, minGap: 0.3 },
  click_suave: { file: "click_suave.mp3", level: -22, filePeak: -6.5, peakAt: 0.07, offset: 0, minGap: 0.2 },
  tecla: { file: "tecla.mp3", level: -22, filePeak: -9.9, peakAt: 0.07, offset: 0, minGap: 0.08 },
  digitacao: { file: "digitacao.mp3", level: -22, filePeak: -2, peakAt: 0.28, offset: 0, minGap: 0.3, sustained: true },
  ding: { file: "ding.mp3", level: -18, filePeak: -4.8, peakAt: 0.01, offset: 0, minGap: 10 },
  impacto_grave: { file: "impacto_grave.mp3", level: -10, filePeak: -7, peakAt: 0.35, offset: 0, minGap: 20 },
  caixa_registradora: { file: "caixa_registradora.mp3", level: -18, filePeak: -3.8, peakAt: 0.67, offset: 0, minGap: Infinity },
  // No catálogo, ainda sem evento visual que os dispare.
  click: { file: "click.mp3", level: -20, filePeak: -5.6, peakAt: 1.05, offset: 0, minGap: 0.3 },
  riser: { file: "riser.mp3", level: -13, filePeak: -15.3, peakAt: 1.79, offset: 0, minGap: 60 },
  impacto_cinematico: { file: "impacto_cinematico.mp3", level: -10, filePeak: -0.2, peakAt: 2.01, offset: 0, minGap: Infinity },
  buzz_erro: { file: "buzz_erro.mp3", level: -18, filePeak: -10.5, peakAt: 0.1, offset: 0, minGap: 5 },
  glitch: { file: "glitch.mp3", level: -16, filePeak: -4.4, peakAt: 0.09, offset: 0, minGap: 5 },
  glitch_02: { file: "glitch_02.mp3", level: -16, filePeak: 0, peakAt: 0.76, offset: 0, minGap: 5 },
  glitch_03: { file: "glitch_03.mp3", level: -16, filePeak: -8.6, peakAt: 1.81, offset: 0, minGap: 5 },
  record_scratch: { file: "record_scratch.mp3", level: -14, filePeak: -7.1, peakAt: 0.11, offset: 0, minGap: Infinity },
  sub_drop: { file: "sub_drop.mp3", level: -12, filePeak: -0.4, peakAt: 0.47, offset: 0, minGap: 60 },
  brilho: { file: "brilho.mp3", level: -20, filePeak: 0, peakAt: 0.13, offset: 0, minGap: 5 },
  ping: { file: "ping.mp3", level: -20, filePeak: -5.1, peakAt: 0.32, offset: 0, minGap: 0.5 },
  notificacao: { file: "notificacao.mp3", level: -18, filePeak: -4.5, peakAt: 0.23, offset: 0, minGap: 5 },
} as const satisfies Record<string, SfxSpec>;

/** Confere um id de efeito contra o catálogo (para o core validar add_sfx). Lança se não existe. */
export function validateSfx(sfx: string) {
  if (!(sfx in SFX_CATALOG)) throw new Error(`efeito sonoro "${sfx}" não existe. Disponíveis: ${Object.keys(SFX_CATALOG).join(", ")}`);
}

/** Catálogo de efeitos em texto, para o prompt do agente. */
export function sfxCatalogForAgent(): string {
  const use: Partial<Record<SfxId, string>> = {
    impacto_cinematico: "o golpe do clímax, uma vez por vídeo (subida de 2 s antes do pico)",
    impacto_grave: "golpes e entradas de título forte",
    sub_drop: "entrada em câmera lenta, queda de tensão",
    whoosh_rapido: "aceleração, troca de plano, transição de assunto",
    whoosh_longo: "transição longa entre atos",
    riser: "subida de tensão terminando num corte ou no clímax (1,8 s antes do pico)",
    zoom_punch: "punch-in de câmera",
    pop: "entrada de item ou card",
    swoosh_texto: "entrada de texto",
    ding: "acerto, conclusão",
    glitch: "interferência, HUD ligando",
    record_scratch: "quebra de expectativa, uma vez",
  };
  return (Object.keys(use) as SfxId[]).map((id) => `- ${id}: ${use[id]}`).join("\n");
}

/** A partir deste nível (dB) um som é "de destaque" e entra no limite global de frequência. */
export const HIGHLIGHT_LEVEL = -14;
export const HIGHLIGHT_GAP = 5;

/** Um som a tocar: começa em `start` (tempo de timeline), pulando `skip` segundos do arquivo. */
export type SoundEvent = { start: number; skip: number; sfx: SfxId; gain: number; duration?: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Eventos sonoros do projeto, em ordem de início, já com as regras de densidade aplicadas. */
export function soundEvents(project: Project): SoundEvent[] {
  if (!project.sfx.enabled) return [];
  type Cue = { t: number; sfx: SfxId; duration?: number; volume?: number; explicit?: boolean };
  const cues: Cue[] = [];
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.type === "sfx") {
        // Som posicionado à mão ou pelo agente: o pico cai exatamente em `start` e ele tem prioridade sobre os automáticos.
        if (c.sfx in SFX_CATALOG) cues.push({ t: c.start - SFX_CATALOG[c.sfx as SfxId].offset, sfx: c.sfx as SfxId, volume: c.volume, explicit: true });
      } else if (c.type === "media") {
        // Rampa de velocidade: queda grave ao entrar na câmera lenta, whoosh ao acelerar.
        if (hasSpeed(c)) cues.push({ t: c.start, sfx: rateAverage(c) < 0.8 ? "sub_drop" : rateAverage(c) > 1.25 ? "whoosh_rapido" : "swoosh_texto" });
      } else if (c.type === "zoom") {
        const pans = Math.abs(c.panX) >= 0.05 || Math.abs(c.panY) >= 0.05;
        // Movimento rápido de câmera faz whoosh; punch-in seco faz o punch. Zoom lento fica sem som.
        if (c.mode === "hold" && c.ease > 0 && c.ease <= 0.45 && (pans || c.scale >= 1.2)) cues.push({ t: c.start, sfx: "whoosh_rapido" });
        else if (c.mode === "hold" && c.ease === 0 && c.scale >= 1.12) cues.push({ t: c.start, sfx: "zoom_punch" });
      } else if (c.type === "component") {
        // Tarja desligada no Brand Kit: não aparece e não faz som.
        if (!project.brand.showLowerThird && (c.component === "executive_lower_third" || c.component === "lower_third")) continue;
        const def = COMPONENTS[c.component];
        const parsed = def?.sounds ? def.schema.safeParse(c.params) : null;
        if (!def?.sounds || !parsed?.success) continue;
        for (const cue of def.sounds(parsed.data, c.duration))
          if (cue.at >= 0 && cue.at < c.duration)
            cues.push({ t: c.start + cue.at, sfx: cue.sfx, duration: cue.duration === undefined ? undefined : Math.min(cue.duration, c.duration - cue.at) });
      }
    }
  }

  // O mais forte ganha: dois picos a menos de 0,15 s soam como defeito, e cada som tem seu intervalo mínimo.
  const kept: (Cue & { peak: number })[] = [];
  const byLevel = cues
    .map((c) => ({ ...c, peak: c.t + SFX_CATALOG[c.sfx].offset }))
    .sort((a, b) => Number(!!b.explicit) - Number(!!a.explicit) || SFX_CATALOG[b.sfx].level - SFX_CATALOG[a.sfx].level || a.t - b.t);
  for (const cue of byLevel) {
    const spec: SfxSpec = SFX_CATALOG[cue.sfx];
    const clash = kept.some(
      (k) =>
        (k.sfx === cue.sfx && Math.abs(k.peak - cue.peak) < (cue.explicit ? Math.min(spec.minGap, 2) : spec.minGap)) ||
        // Som contínuo de fundo (digitação) convive com os pontuais.
        (!spec.sustained && !(SFX_CATALOG[k.sfx] as SfxSpec).sustained && Math.abs(k.peak - cue.peak) < 0.15) ||
        // Sons de destaque (impactos, whooshes) disputam a atenção entre si: no máximo um a cada HIGHLIGHT_GAP,
        // seja qual for o som. Os discretos (pop, clique, tecla) pontuam itens em sequência e ficam de fora.
        // Sons posicionados de propósito só cedem a outro som de propósito colado neles (1 s).
        (spec.level >= HIGHLIGHT_LEVEL && SFX_CATALOG[k.sfx].level >= HIGHLIGHT_LEVEL && Math.abs(k.peak - cue.peak) < (cue.explicit ? 1 : HIGHLIGHT_GAP)),
    );
    if (!clash) kept.push(cue);
  }

  return kept
    .map((cue) => {
      const spec: SfxSpec = SFX_CATALOG[cue.sfx];
      // O pico do arquivo cai em evento + offset; se isso exigir começar antes de 0, pula o início do arquivo.
      const begin = spec.sustained ? cue.t : cue.peak - spec.peakAt;
      return {
        start: r3(Math.max(0, begin)),
        skip: r3(spec.sustained ? spec.peakAt : Math.max(0, -begin)),
        sfx: cue.sfx,
        gain: Math.pow(10, (spec.level - spec.filePeak) / 20) * (cue.volume ?? 1),
        ...(cue.duration !== undefined ? { duration: r3(cue.duration) } : {}),
      };
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * Reserva sintetizada em código, para quando os arquivos do catálogo não
 * carregam (sem rede): quatro timbres que cobrem as famílias principais.
 */
export type SynthId = "whoosh" | "tick" | "pop" | "riser";
export const SYNTH_LEVEL_DB: Record<SynthId, number> = { whoosh: -16, tick: -20, pop: -18, riser: -15 };
export const SYNTH_FALLBACK: Partial<Record<SfxId, SynthId>> = {
  whoosh_rapido: "whoosh",
  whoosh_longo: "whoosh",
  swoosh_texto: "whoosh",
  zoom_punch: "pop",
  pop: "pop",
  click_suave: "pop",
  ding: "pop",
  tecla: "tick",
  impacto_grave: "riser",
};

/** Ruído determinístico: o mesmo efeito soa igual no preview e em toda exportação. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

/** Sintetiza um efeito em mono, já no nível de pico definido em SFX_LEVEL_DB. */
export function synthSfx(id: SynthId, sampleRate: number): Float32Array {
  const dur = { whoosh: 0.42, tick: 0.035, pop: 0.11, riser: 0.95 }[id];
  const n = Math.ceil(dur * sampleRate);
  const out = new Float32Array(n);
  const rnd = noise({ whoosh: 11, tick: 23, pop: 37, riser: 53 }[id]);
  const TAU = Math.PI * 2;
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const x = t / dur;
    if (id === "whoosh") {
      // Ruído com passa-baixa que abre e fecha: ar passando.
      const cutoff = 0.02 + 0.28 * Math.sin(Math.PI * x) ** 2;
      lp += cutoff * (rnd() - lp);
      out[i] = lp * Math.sin(Math.PI * x) ** 2;
    } else if (id === "tick") {
      // Clique seco de tecla: ruído agudo com decaimento muito rápido.
      const white = rnd();
      lp += 0.5 * (white - lp);
      out[i] = (white - lp) * Math.exp(-x * 9);
    } else if (id === "pop") {
      // Senoide que cai de ~620 Hz para ~280 Hz.
      phase += (TAU * (280 + 340 * Math.exp(-x * 7))) / sampleRate;
      out[i] = Math.sin(phase) * Math.exp(-x * 5) * Math.min(1, t / 0.004);
    } else {
      // Subida de ar por 0,45 s e um golpe grave que decai.
      const hitAt = 0.45;
      if (t < hitAt) {
        const r = t / hitAt;
        lp += (0.03 + 0.2 * r * r) * (rnd() - lp);
        out[i] = lp * r * r * 0.7;
      } else {
        const h = t - hitAt;
        phase += (TAU * (46 + 60 * Math.exp(-h * 18))) / sampleRate;
        lp += 0.2 * (rnd() - lp);
        out[i] = Math.sin(phase) * Math.exp(-h * 6) + lp * Math.exp(-h * 30) * 0.5;
      }
    }
  }
  // Normaliza o pico para o nível do efeito e garante fim em silêncio (sem estalo).
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const gain = peak > 0 ? Math.pow(10, SYNTH_LEVEL_DB[id] / 20) / peak : 0;
  const tail = Math.min(n, Math.ceil(0.004 * sampleRate));
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain * Math.min(1, (n - 1 - i) / tail);
  return out;
}
