import { describe, expect, it } from "vitest";
import { addAssetToProject, applyOperations, createProject } from "@videoeditor/core";
import {
  cameraAt,
  cameraSpeed,
  catalogForAgent,
  COMPONENTS,
  cubicBezier,
  EASE,
  parseRich,
  plainText,
  SFX_LEVEL_DB,
  soundEvents,
  synthSfx,
  typewriter,
  validateComponent,
} from "./index";

describe("biblioteca de componentes", () => {
  it("todo exemplo do catálogo passa na própria validação", () => {
    for (const def of Object.values(COMPONENTS)) {
      expect(() => validateComponent(def.id, def.example as Record<string, unknown>)).not.toThrow();
    }
  });

  it("aplica defaults e rejeita params inválidos ou componentes inexistentes", () => {
    expect(validateComponent("counter", { to: 10 })).toMatchObject({ from: 0 });
    expect(() => validateComponent("bar_chart", { bars: [{ label: "a", value: 1 }] })).toThrow(/params inválidos/);
    expect(() => validateComponent("nao_existe", {})).toThrow(/não existe/);
  });

  it("o catálogo do agente traz só os seis componentes da v1.0", () => {
    const text = catalogForAgent();
    const v1 = ["depth_hook_title", "kinetic_pivot_card", "step_progress", "acronym_list", "executive_lower_third", "stat_counter"];
    for (const id of v1) expect(text).toContain(`### ${id}`);
    for (const id of ["lower_third", "title_card", "bar_chart", "counter", "text_highlight", "bullet_list"]) {
      expect(text).not.toContain(`### ${id} `);
      // ...mas continuam válidos para o menu manual e projetos antigos.
      expect(COMPONENTS[id]).toBeDefined();
    }
  });
});

describe("curvas e câmera", () => {
  it("cubic-bezier bate com os extremos e com a curva linear", () => {
    const linear = cubicBezier(0.25, 0.25, 0.75, 0.75);
    for (const x of [0, 0.2, 0.5, 0.9, 1]) expect(linear(x)).toBeCloseTo(x, 3);
    expect(EASE.snap(0)).toBe(0);
    expect(EASE.snap(1)).toBe(1);
    // snap dispara no começo; swift é simétrica.
    expect(EASE.snap(0.2)).toBeGreaterThan(0.6);
    expect(EASE.swift(0.5)).toBeCloseTo(0.5, 2);
  });

  const withZoom = (zoom: Record<string, unknown>, opts: { aspectRatio?: "9:16" | "16:9" } = {}) => {
    const p = addAssetToProject(createProject({ name: "cam", ...opts }), { id: "a", kind: "video", name: "v.mp4", duration: 20, hasAudio: true });
    return applyOperations(p, [{ op: "add_zoom", start: 2, duration: 4, ...zoom }]).project;
  };
  const covers = (r: { x: number; y: number; w: number; h: number }, p: { width: number; height: number }) =>
    r.x <= 0.001 && r.y <= 0.001 && r.x + r.w >= p.width - 0.001 && r.y + r.h >= p.height - 0.001;

  it("vídeo horizontal preenche o quadro vertical e o enquadramento escolhe o lado", () => {
    const p = withZoom({});
    expect([p.width, p.height]).toEqual([1080, 1920]);
    const centered = cameraAt(p, 0, 1920, 1080);
    expect(centered.h).toBeCloseTo(1920);
    expect(centered.x).toBeCloseTo((1080 - centered.w) / 2);
    const left = cameraAt(applyOperations(p, [{ op: "set_format", framing: { x: 0 } }]).project, 0, 1920, 1080);
    expect(left.x).toBeCloseTo(0);
  });

  it("pan lateral desloca o quadro sem nunca mostrar borda", () => {
    const base = cameraAt(withZoom({ scale: 1.3, ease: 0 }, { aspectRatio: "16:9" }), 3, 1920, 1080);
    const right = withZoom({ scale: 1.3, ease: 0, panX: 0.12 }, { aspectRatio: "16:9" });
    const r = cameraAt(right, 3, 1920, 1080);
    expect(r.x - base.x).toBeCloseTo(0.12 * 1920, 0);
    expect(covers(r, right)).toBe(true);
    // Pan maior que a folga do zoom é limitado à borda.
    const extreme = withZoom({ scale: 1.1, ease: 0, panX: 0.5 }, { aspectRatio: "16:9" });
    expect(covers(cameraAt(extreme, 3, 1920, 1080), extreme)).toBe(true);
  });

  it("creep avança continuamente até a escala final; hold entra, segura e sai", () => {
    const creep = withZoom({ scale: 1.1, mode: "creep" }, { aspectRatio: "16:9" });
    const widths = [2, 3, 4, 5, 5.99].map((t) => cameraAt(creep, t, 1920, 1080).w);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    expect(widths[widths.length - 1]!).toBeCloseTo(1920 * 1.1, 0);
    const hold = withZoom({ scale: 1.2, ease: 0.5 }, { aspectRatio: "16:9" });
    expect(cameraAt(hold, 4, 1920, 1080).w).toBeCloseTo(1920 * 1.2);
    expect(cameraAt(hold, 2, 1920, 1080).w).toBeCloseTo(1920);
    expect(cameraAt(hold, 7, 1920, 1080).w).toBeCloseTo(1920);
  });

  it("só o movimento rápido tem velocidade para motion blur", () => {
    const fast = withZoom({ scale: 1.3, ease: 0.35, panX: 0.12 }, { aspectRatio: "16:9" });
    const slow = withZoom({ scale: 1.08, mode: "creep" }, { aspectRatio: "16:9" });
    const speed = (p: typeof fast, t: number) => cameraSpeed(cameraAt(p, t, 1920, 1080), cameraAt(p, t - 1 / 30, 1920, 1080));
    expect(speed(fast, 2.18)).toBeGreaterThan(20);
    expect(speed(slow, 4)).toBeLessThan(7);
    expect(speed(fast, 4)).toBe(0);
  });
});

describe("tipografia mista", () => {
  it("separa as palavras de ênfase e ignora asterisco sem par", () => {
    expect(parseRich("isso *muda tudo* hoje")).toEqual([
      { text: "isso", emph: false },
      { text: "muda", emph: true },
      { text: "tudo", emph: true },
      { text: "hoje", emph: false },
    ]);
    expect(parseRich("5 * 3 dá quinze").every((w) => !w.emph)).toBe(true);
    expect(plainText("a *oferta* é")).toBe("a oferta é");
  });

  it("máquina de escrever: cursor aceso enquanto digita e piscando depois", () => {
    expect(typewriter(0.5, 24, 24)).toMatchObject({ reveal: 12, cursor: true, done: false });
    expect(typewriter(1, 24, 24)).toMatchObject({ reveal: 24, done: true });
    const blink = [1.05, 1.3, 1.55, 1.8].map((t) => typewriter(t, 24, 24).cursor);
    expect(blink).toEqual([true, false, true, false]);
    expect(typewriter(-0.2, 24, 24)).toMatchObject({ reveal: 0, cursor: false });
  });
});

describe("design sonoro", () => {
  const scene = () => {
    const p = addAssetToProject(createProject({ name: "sfx" }), { id: "a", kind: "video", name: "v.mp4", duration: 30, hasAudio: true });
    return applyOperations(
      p,
      [
        { op: "add_zoom", start: 1, duration: 4, scale: 1.3, ease: 0.35, panX: -0.12 },
        { op: "add_zoom", start: 8, duration: 3, scale: 1.15, ease: 0 },
        { op: "add_zoom", start: 12, duration: 4, scale: 1.08, mode: "creep" },
        { op: "add_component", component: "acronym_list", start: 1, duration: 6, params: { items: [{ text: "um", at: 0.5 }, { text: "dois", at: 2 }] } },
        { op: "add_component", component: "kinetic_pivot_card", start: 16, duration: 5, params: { setup: "Preço não é o problema", punchline: "A oferta é", pivot: { at: 2 } } },
      ],
      { validateComponent },
    ).project;
  };

  it("deriva os efeitos do estado: whoosh no pan, pop nos itens, golpe e teclas na cena de tela cheia", () => {
    const events = soundEvents(scene());
    const at = (sfx: string) => events.filter((e) => e.sfx === sfx).map((e) => e.t);
    // Pan lateral faz whoosh; punch-in seco e creep não. O giro do cartão (16 + 2) também.
    expect(at("whoosh")).toEqual([1, 18]);
    expect(at("pop")).toEqual([1.5, 3]);
    expect(at("riser")).toEqual([16]);
    expect(at("tick").length).toBeGreaterThan(5);
    expect(events).toEqual([...events].sort((a, b) => a.t - b.t));
  });

  it("desligar os efeitos silencia tudo", () => {
    const off = applyOperations(scene(), [{ op: "set_format", sfx: { enabled: false } }]).project;
    expect(soundEvents(off)).toEqual([]);
  });

  it("cada efeito é sintetizado no nível de pico definido e termina em silêncio", () => {
    for (const id of ["whoosh", "tick", "pop", "riser"] as const) {
      const samples = synthSfx(id, 48000);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      expect(20 * Math.log10(peak)).toBeCloseTo(SFX_LEVEL_DB[id], 0);
      expect(Math.abs(samples[samples.length - 1]!)).toBe(0);
      expect(samples.length).toBeLessThan(48000);
      // Determinístico: preview e exportação tocam exatamente o mesmo som.
      expect(Array.from(synthSfx(id, 48000).slice(0, 64))).toEqual(Array.from(samples.slice(0, 64)));
    }
  });
});
