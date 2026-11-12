import { type Project } from "@videoeditor/core";
import { COMPONENTS, type SfxId } from "./components/library";

/**
 * Design sonoro: efeitos curtos e discretos, derivados do estado da timeline
 * (função pura) e sintetizados em código — sem arquivos de áudio. O preview e
 * a exportação usam a mesma lista de eventos e as mesmas amostras.
 */
export type SoundEvent = { t: number; sfx: SfxId };

/** Nível de pico de cada efeito, em dB (referência: voz em 0 dB). */
export const SFX_LEVEL_DB: Record<SfxId, number> = { whoosh: -16, tick: -20, pop: -18, riser: -15 };

/** Eventos sonoros do projeto, em tempo de timeline, em ordem. */
export function soundEvents(project: Project): SoundEvent[] {
  if (!project.sfx.enabled) return [];
  const out: SoundEvent[] = [];
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.type === "zoom") {
        // Só movimentos rápidos de câmera: pan lateral ou rampa curta. Punch-in seco é um corte, não faz som.
        const fast = c.mode === "hold" && c.ease > 0 && c.ease <= 0.45 && (Math.abs(c.panX) >= 0.05 || Math.abs(c.panY) >= 0.05 || c.scale >= 1.2);
        if (fast) out.push({ t: c.start, sfx: "whoosh" });
      } else if (c.type === "component") {
        const def = COMPONENTS[c.component];
        const parsed = def?.sounds ? def.schema.safeParse(c.params) : null;
        if (!def?.sounds || !parsed?.success) continue;
        for (const cue of def.sounds(parsed.data, c.duration))
          if (cue.at >= 0 && cue.at < c.duration) out.push({ t: Math.round((c.start + cue.at) * 1000) / 1000, sfx: cue.sfx });
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  // Dois efeitos iguais quase juntos soam como defeito: fica o primeiro.
  const last: Partial<Record<SfxId, number>> = {};
  return out.filter((e) => {
    const min = e.sfx === "tick" ? 0.05 : 0.2;
    if (last[e.sfx] !== undefined && e.t - last[e.sfx]! < min) return false;
    last[e.sfx] = e.t;
    return true;
  });
}

/** Ruído determinístico: o mesmo efeito soa igual no preview e em toda exportação. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

/** Sintetiza um efeito em mono, já no nível de pico definido em SFX_LEVEL_DB. */
export function synthSfx(id: SfxId, sampleRate: number): Float32Array {
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
  const gain = peak > 0 ? Math.pow(10, SFX_LEVEL_DB[id] / 20) / peak : 0;
  const tail = Math.min(n, Math.ceil(0.004 * sampleRate));
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain * Math.min(1, (n - 1 - i) / tail);
  return out;
}
