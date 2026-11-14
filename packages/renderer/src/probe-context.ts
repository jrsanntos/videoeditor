import type { Ctx2D } from "./draw";

/** Contexto 2D de mentira: não pinta nada, mas acompanha as transformações e mede texto por estimativa. */
type M = [number, number, number, number, number, number];

export function createProbeContext(width: number, height: number): Ctx2D {
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: { m: M; font: string; alpha: number }[] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif", globalAlpha: 1, filter: "none", canvas: { width, height } };
  const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const gradient = { addColorStop() {} };
  const methods: Record<string, (...args: number[]) => unknown> = {
    save: () => void stack.push({ m: [...m] as M, font: state.font as string, alpha: state.globalAlpha as number }),
    restore: () => {
      const s = stack.pop();
      if (s) {
        m = s.m;
        state.font = s.font;
        state.globalAlpha = s.alpha;
      }
    },
    translate: (x, y) => void (m = mul(m, [1, 0, 0, 1, x!, y!])),
    scale: (x, y) => void (m = mul(m, [x!, 0, 0, y!, 0, 0])),
    rotate: (a) => void (m = mul(m, [Math.cos(a!), Math.sin(a!), -Math.sin(a!), Math.cos(a!), 0, 0])),
    setTransform: (a, b, c, d, e, f) => void (m = [a ?? 1, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0]),
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    measureText: (text) => {
      // Largura média de um caractere em fonte sem serifa de peso forte: ~0,56 do corpo.
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(state.font as string)?.[1] ?? 10);
      return { width: String(text).length * px * 0.56 };
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(state, {
    get: (target, key: string) => (key in methods ? methods[key] : key in target ? target[key] : () => undefined),
    set: (target, key: string, value) => ((target[key] = value), true),
  }) as unknown as Ctx2D;
}

