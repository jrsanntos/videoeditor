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
  SFX_CATALOG,
  SYNTH_LEVEL_DB,
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

  it("o catálogo do agente traz os componentes da v1.0 e da v2, sem os legados", () => {
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

  it("deriva os efeitos do estado, com os sons e as regras do catálogo", () => {
    const events = soundEvents(scene());
    const starts = (sfx: string) => events.filter((e) => e.sfx === sfx).map((e) => e.start);
    // Pan lateral faz whoosh, com o pico 0,1 s antes do movimento (1 − 0,10 − 0,16 de ataque do arquivo).
    expect(starts("whoosh_rapido")).toEqual([0.74]);
    // Punch-in seco tem o seu punch; creep zoom fica em silêncio.
    expect(starts("zoom_punch")).toHaveLength(1);
    // Lista: pop no primeiro item, clique discreto no segundo.
    expect(starts("pop")).toEqual([1.47]);
    expect(starts("click_suave")).toEqual([2.93]);
    // Cena de tela cheia: impacto na entrada, digitação enquanto escreve, swoosh no giro.
    expect(starts("impacto_grave")).toHaveLength(1);
    expect(starts("swoosh_texto")).toHaveLength(1);
    const typing = events.filter((e) => e.sfx === "digitacao");
    expect(typing).toHaveLength(2);
    expect(typing[0]!.duration).toBeCloseTo(22 / 24, 1);
    expect(events).toEqual([...events].sort((a, b) => a.start - b.start));
  });

  it("o mais forte ganha quando dois sons caem juntos, e cada som respeita seu intervalo mínimo", () => {
    const base = addAssetToProject(createProject({ name: "regras" }), { id: "a", kind: "video", name: "v.mp4", duration: 60, hasAudio: true });
    const p = applyOperations(
      base,
      [
        // Dois whooshes a 1 s um do outro: o catálogo pede no máximo 1 a cada 3 s.
        { op: "add_zoom", start: 5, duration: 0.9, scale: 1.3, ease: 0.3, panX: 0.1 },
        { op: "add_zoom", start: 6, duration: 2, scale: 1.3, ease: 0.3, panX: -0.1 },
        // Número em dinheiro termina com a caixa registradora, não com pop.
        { op: "add_component", component: "stat_counter", start: 20, duration: 4, params: { value: 310, prefix: "R$ ", suffix: " mil" } },
      ],
      { validateComponent },
    ).project;
    const events = soundEvents(p);
    expect(events.filter((e) => e.sfx === "whoosh_rapido")).toHaveLength(1);
    expect(events.filter((e) => e.sfx === "caixa_registradora")).toHaveLength(1);
    expect(events.some((e) => e.sfx === "pop")).toBe(false);
    expect(events.filter((e) => e.sfx === "tecla").length).toBeGreaterThan(3);
  });

  it("som que precisaria começar antes de zero pula o início do arquivo", () => {
    const base = addAssetToProject(createProject({ name: "inicio" }), { id: "a", kind: "video", name: "v.mp4", duration: 10, hasAudio: true });
    const p = applyOperations(base, [{ op: "add_component", component: "depth_hook_title", start: 0, duration: 3, params: { title: "3 erros" } }], { validateComponent }).project;
    const [hit] = soundEvents(p);
    // Pico do impacto em 0,1 s; o arquivo tem 0,35 s de ataque: toca desde 0, pulando 0,25 s.
    expect(hit).toMatchObject({ sfx: "impacto_grave", start: 0, skip: 0.25 });
  });

  it("os níveis seguem o catálogo: impacto mais alto que pop, que é mais alto que tecla", () => {
    const peak = (id: keyof typeof SFX_CATALOG) => SFX_CATALOG[id].level;
    expect(peak("impacto_grave")).toBeGreaterThan(peak("pop"));
    expect(peak("pop")).toBeGreaterThan(peak("tecla"));
    for (const spec of Object.values(SFX_CATALOG)) expect(spec.file).toMatch(/^[a-z0-9_]+\.mp3$/);
  });

  it("desligar os efeitos silencia tudo", () => {
    const off = applyOperations(scene(), [{ op: "set_format", sfx: { enabled: false } }]).project;
    expect(soundEvents(off)).toEqual([]);
  });

  it("os timbres de reserva são sintetizados no nível definido e terminam em silêncio", () => {
    for (const id of ["whoosh", "tick", "pop", "riser"] as const) {
      const samples = synthSfx(id, 48000);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      expect(20 * Math.log10(peak)).toBeCloseTo(SYNTH_LEVEL_DB[id], 0);
      expect(Math.abs(samples[samples.length - 1]!)).toBe(0);
      expect(samples.length).toBeLessThan(48000);
      // Determinístico: preview e exportação tocam exatamente o mesmo som.
      expect(Array.from(synthSfx(id, 48000).slice(0, 64))).toEqual(Array.from(samples.slice(0, 64)));
    }
  });
});

// ====================================================================
// Critérios de aceite da evolução para "padrão ouro"
// ====================================================================
import { captionBaseY, faceBox, SKILLS, skillOperations, TEMPLATE_SKILLS, type Project } from "@videoeditor/core";
import {
  animState,
  CAPTION_PRESETS,
  captionGroups,
  captionOpacity,
  closeMask,
  DUCK_GAIN,
  duckingEnvelope,
  featherMask,
  gainAt,
  impactAt,
  interpolate,
  letterboxHeight,
  lookFilter,
  LOOKS,
  musicBeats,
  musicLoopSeconds,
  probeFrame,
  refineMask,
  screenTexts,
  spring,
  synthMusic,
  temporalSmooth,
  validateSfx,
  zoomProgress,
} from "./index";

const NEW_COMPONENTS = ["stat_counter_card", "comparison_split", "tactical_hud_overlay", "social_proof_toast", "callout_pointer", "step_progress_bar"];

/** Vídeo falado de 20 s, vertical, com transcrição e o apresentador em plano médio. */
function talking(subject = { x: 0.3, y: 0.2, w: 0.4, h: 0.8, faceX: 0.5, faceY: 0.3, faceW: 0.2, faceH: 0.16 }): Project {
  const words = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, text: i === 7 ? "30%" : `palavra${i}`, start: 0.5 + i * 0.6, end: 0.95 + i * 0.6 }));
  const p = addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "v.mp4", duration: 20, width: 1080, height: 1920, hasAudio: true, transcript: { words }, subject: [{ t: 0, ...subject }, { t: 20, ...subject }] });
  return applyOperations(p, [{ op: "set_captions", enabled: true }]).project;
}
const inside = (r: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y;

describe("novos cards nativos", () => {
  it("os seis componentes novos estão no catálogo do agente, com exemplo válido", () => {
    const text = catalogForAgent();
    for (const id of [...NEW_COMPONENTS, "custom_motion_graphic"]) {
      expect(COMPONENTS[id], id).toBeDefined();
      expect(text).toContain(`### ${id}`);
      expect(() => validateComponent(id, COMPONENTS[id]!.example as Record<string, unknown>)).not.toThrow();
    }
  });

  it("todo componente renderiza do primeiro ao último quadro, nos dois formatos, sem erro", () => {
    for (const ratio of ["9:16", "16:9"] as const) {
      for (const def of Object.values(COMPONENTS)) {
        let p = applyOperations(talking(), [{ op: "set_format", aspectRatio: ratio }, { op: "set_brand", brand: { showLowerThird: true, displayName: "Dra. Ana", credential: "CRM 123" } }]).project;
        p = applyOperations(p, [{ op: "add_component", component: def.id, start: 2, duration: def.defaultDuration, params: def.example as Record<string, unknown> }], { validateComponent }).project;
        for (const k of [0, 0.02, 0.2, 0.5, 0.9, 0.999]) expect(() => probeFrame(p, 2 + def.defaultDuration * k), `${def.id} ${ratio} ${k}`).not.toThrow();
      }
    }
  });

  it("os cards informam onde estão na tela e ficam dentro do quadro", () => {
    for (const id of NEW_COMPONENTS) {
      const def = COMPONENTS[id]!;
      const p = applyOperations(talking(), [{ op: "add_component", component: id, start: 2, duration: def.defaultDuration, params: def.example as Record<string, unknown> }], { validateComponent }).project;
      const { regions } = probeFrame(p, 2 + def.defaultDuration * 0.7);
      expect(regions.length, id).toBeGreaterThan(0);
      for (const r of regions) {
        expect(r.x, `${id}.${r.key}`).toBeGreaterThanOrEqual(-2);
        expect(r.x + r.w, `${id}.${r.key}`).toBeLessThanOrEqual(p.width + 2);
        expect(r.y).toBeGreaterThanOrEqual(-2);
        expect(r.y + r.h).toBeLessThanOrEqual(p.height + 2);
      }
    }
  });

  it("cada card tem o seu som, sincronizado com a própria animação", () => {
    const sounds = (id: string) => COMPONENTS[id]!.sounds!(COMPONENTS[id]!.schema.parse(COMPONENTS[id]!.example) as never, COMPONENTS[id]!.defaultDuration).map((c) => c.sfx);
    expect(sounds("social_proof_toast")).toEqual(["notificacao"]);
    expect(sounds("comparison_split")).toContain("whoosh_rapido");
    expect(sounds("stat_counter_card")).toContain("pop");
    // Uma etapa, um som: a barra de etapas pontua cada troca.
    expect(sounds("step_progress_bar")).toHaveLength(3);
  });
});

describe("custom_motion_graphic gerado pela IA", () => {
  /** Uma árvore como o Diretor de IA escreveria: cartão com selo, título, linha desenhada e grade de dados. */
  const tree = {
    anchor: "bottom",
    offsetY: -0.05,
    root: {
      type: "group",
      layout: "column",
      align: "start",
      gap: 18,
      padding: 40,
      radius: 32,
      fill: "background",
      blur: true,
      anim: [
        { prop: "opacity", from: 0, to: 1, duration: 0.3 },
        { prop: "translateY", from: 80, to: 0, duration: 0.6, ease: "spring" },
      ],
      children: [
        { type: "badge", text: "Método", anim: [{ prop: "scale", from: 0, to: 1, at: 0.2, duration: 0.4, ease: "back" }] },
        { type: "text", text: "Três alavancas do *lucro*", size: 72, role: "title", align: "left", maxWidth: 780 },
        { type: "line", x2: 480, y2: 0, stroke: { from: "primary", to: "secondary", angle: 0 }, width: 8, anim: [{ prop: "draw", from: 0, to: 1, at: 0.5, duration: 0.6, ease: "snap" }] },
        {
          type: "group",
          layout: "grid",
          columns: 3,
          gap: 20,
          children: [
            { type: "group", layout: "stack", children: [{ type: "circle", r: 60, stroke: "primary", strokeWidth: 6 }, { type: "text", text: "1", size: 64, weight: 900 }] },
            { type: "group", layout: "stack", children: [{ type: "rect", w: 120, h: 120, radius: 24, fill: "primary" }, { type: "text", text: "2", size: 64, weight: 900, color: "black" }] },
            { type: "path", d: "M10 110 L60 10 L110 110 Z", w: 120, h: 120, stroke: "primary", strokeWidth: 6, anim: [{ prop: "rotate", from: -20, to: 0, at: 0.8, duration: 0.5 }] },
          ],
        },
      ],
    },
  };
  const withTree = (duration = 5) => applyOperations(talking(), [{ op: "add_component", component: "custom_motion_graphic", start: 2, duration, params: tree }], { validateComponent }).project;

  it("valida, aplica defaults e renderiza a árvore em qualquer instante", () => {
    const params = validateComponent("custom_motion_graphic", tree) as { root: { children: { anim: unknown[] }[] }; backdrop: string };
    expect(params.backdrop).toBe("none");
    expect(params.root.children[1]!.anim).toEqual([]);
    const p = withTree();
    for (const t of [2, 2.1, 2.5, 3.2, 4.5, 6.9]) expect(() => probeFrame(p, t)).not.toThrow();
    // A peça ocupa uma área na base do quadro, dentro das margens seguras.
    const area = probeFrame(p, 4).regions.length;
    expect(area).toBe(0); // região sem chave não é texto editável…
    const text = screenTexts(p);
    expect(text).toEqual([]);
  });

  it("as trilhas de animação seguem tempo, propriedade e curva de easing", () => {
    const anims = [
      { prop: "opacity" as const, from: 0, to: 1, at: 0.5, duration: 1, ease: "linear" as const },
      { prop: "translateY" as const, from: 80, to: 0, at: 0, duration: 0.6, ease: "spring" as const },
      { prop: "scale" as const, from: 1, to: 1.5, at: 2, duration: 0.5, ease: "ease_out" as const },
    ];
    // Antes de começar vale o valor inicial da trilha (o elemento não "pisca" no lugar final).
    expect(animState(anims, 0)).toMatchObject({ opacity: 0, ty: 80, scale: 1 });
    expect(animState(anims, 1).opacity).toBeCloseTo(0.5, 5);
    expect(animState(anims, 3)).toMatchObject({ opacity: 1, ty: 0, scale: 1.5 });
    // A mola passa do alvo (overshoot) antes de assentar: translateY fica negativo em algum momento.
    const overshoot = Array.from({ length: 30 }, (_, i) => animState(anims, 0.02 * i).ty);
    expect(Math.min(...overshoot)).toBeLessThan(0);
  });

  it("recusa peças que ferem a direção de arte ou saem do schema", () => {
    const small = { root: { type: "text", text: "Título pequeno demais", size: 36, role: "title" } };
    expect(() => validateComponent("custom_motion_graphic", small)).toThrow(/64 px/);
    // No horizontal a regra dos 64 px não se aplica.
    expect(() => validateComponent("custom_motion_graphic", small, { vertical: false })).not.toThrow();
    expect(() => validateComponent("custom_motion_graphic", { root: { type: "text", text: "Ideias ✨", size: 80 } })).toThrow(/clichê/);
    expect(() => validateComponent("custom_motion_graphic", { root: { type: "iframe", src: "http://x" } })).toThrow(/params inválidos/);
    // E a operação inteira falha de forma atômica, com o erro para o agente corrigir.
    expect(() => applyOperations(talking(), [{ op: "add_component", component: "custom_motion_graphic", start: 1, duration: 3, params: small }], { validateComponent })).toThrow(/direção de arte/);
  });

  it("por padrão a legenda some enquanto a peça está na tela; com keepCaptions, convive", () => {
    const p = withTree();
    expect(captionOpacity(p, 4)).toBe(0);
    expect(probeFrame(p, 4).caption).toBeNull();
    const keep = applyOperations(talking(), [{ op: "add_component", component: "custom_motion_graphic", start: 2, duration: 5, params: { ...tree, keepCaptions: true } }], { validateComponent }).project;
    expect(captionOpacity(keep, 4)).toBe(1);
  });
});

describe("legendas: base do quadro, supressão com cards e desvio do rosto", () => {
  it("por padrão a legenda fica na base, entre 14% e 18% do fundo, dentro do quadro", () => {
    for (const ratio of ["9:16", "16:9"] as const) {
      const p = applyOperations(talking(), [{ op: "set_format", aspectRatio: ratio }]).project;
      const box = probeFrame(p, 1)!.caption!;
      expect(box).not.toBeNull();
      const center = (box.y + box.h / 2) / p.height;
      expect(center).toBeCloseTo(captionBaseY(ratio), 2);
      expect(1 - center).toBeGreaterThanOrEqual(0.14);
      expect(1 - center).toBeLessThanOrEqual(0.18);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(p.width);
    }
  });

  it("é ocultada automaticamente enquanto um card está ativo, e volta depois", () => {
    const p = applyOperations(talking(), [{ op: "add_component", component: "stat_counter_card", start: 4, duration: 4, params: { value: 30, suffix: "%", label: "de retorno" } }], { validateComponent }).project;
    expect(probeFrame(p, 3)!.caption).not.toBeNull();
    expect(probeFrame(p, 6)!.caption).toBeNull();
    expect(captionOpacity(p, 3.9)).toBeCloseTo(0.5, 5);
    expect(probeFrame(p, 9)!.caption).not.toBeNull();
    // Componentes discretos (HUD, barra de etapas) convivem com a legenda.
    const hud = applyOperations(talking(), [{ op: "add_component", component: "tactical_hud_overlay", start: 4, duration: 4, params: {} }], { validateComponent }).project;
    expect(probeFrame(hud, 6)!.caption).not.toBeNull();
  });

  it("nunca fica na frente do rosto: desvia para a margem segura livre", () => {
    // Apresentador sentado baixo no quadro: o rosto ocupa a faixa onde a legenda padrão cairia.
    const low = talking({ x: 0.2, y: 0.6, w: 0.6, h: 0.4, faceX: 0.46, faceY: 0.82, faceW: 0.3, faceH: 0.2 });
    const box = probeFrame(low, 1)!.caption!;
    const face = faceBox({ x: 0.2, y: 0.6, w: 0.6, h: 0.4, faceX: 0.46, faceY: 0.82, faceW: 0.3, faceH: 0.2 }, low.width / low.height);
    const facePx = { x: face.x * low.width, y: face.y * low.height, w: face.w * low.width, h: face.h * low.height };
    expect(inside(box, facePx)).toBe(false);
    // Mesmo se o usuário pedir legenda no centro e o rosto estiver lá.
    const centered = applyOperations(talking({ x: 0.2, y: 0.3, w: 0.6, h: 0.7, faceX: 0.46, faceY: 0.5, faceW: 0.3, faceH: 0.2 }), [{ op: "set_captions", style: { position: "center" } }]).project;
    const moved = probeFrame(centered, 1)!.caption!;
    const f2 = faceBox({ x: 0.2, y: 0.3, w: 0.6, h: 0.7, faceX: 0.46, faceY: 0.5, faceW: 0.3, faceH: 0.2 }, centered.width / centered.height);
    expect(inside(moved, { x: f2.x * centered.width, y: f2.y * centered.height, w: f2.w * centered.width, h: f2.h * centered.height })).toBe(false);
  });

  it("os presets novos existem, com o agrupamento de cada estilo", () => {
    for (const id of ["viral_pop", "karaoke_pill", "comic_bounce", "editorial_clean", "neon_subtitle", "minimal_cinema"] as const) {
      expect(CAPTION_PRESETS[id]).toBeDefined();
      const p = applyOperations(talking(), [{ op: "set_captions", style: { preset: id, maxWords: 8 } }]).project;
      // Do início ao fim da fala, em qualquer instante da animação.
      for (let t = 0.4; t < 19; t += 0.37) expect(() => probeFrame(p, t), `${id} ${t}`).not.toThrow();
      expect(probeFrame(p, 1)!.caption, id).not.toBeNull();
    }
    // viral_pop: blocos de 2–3 palavras, por mais que o projeto peça mais; palavras longas ficam em blocos menores.
    const viral = applyOperations(talking(), [{ op: "set_captions", style: { preset: "viral_pop", maxWords: 8 } }]).project;
    const sizes = captionGroups(viral).map((g) => g.words.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(3);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(2);
    // A legenda de cinema é a menor; a viral, a maior.
    expect(CAPTION_PRESETS.minimal_cinema.size).toBeLessThan(CAPTION_PRESETS.editorial_clean.size);
    expect(CAPTION_PRESETS.viral_pop.size).toBeGreaterThan(CAPTION_PRESETS.karaoke_pill.size);
  });
});

describe("legenda cabe no tamanho normal", () => {
  it("frase longa vira duas legendas em vez de uma legenda minúscula", () => {
    const long = "incapacitação neuromuscular também conhecidas popularmente como armas de choque".split(" ");
    const words = long.map((text, i) => ({ id: `w${i}`, text, start: i * 0.35, end: i * 0.35 + 0.3 }));
    let p = addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "v.mp4", duration: 4, hasAudio: true, transcript: { words } });
    p = applyOperations(p, [{ op: "set_captions", enabled: true, style: { preset: "editorial_clean", maxWords: 6 } }]).project;
    const groups = captionGroups(p);
    expect(groups.length).toBeGreaterThan(long.length / 6);
    for (const g of groups) expect(g.text.length).toBeLessThanOrEqual(34);
  });
});

describe("texto atrás da cabeça (depth_hook_title)", () => {
  const hook = (p: Project) => applyOperations(p, [{ op: "add_component", component: "depth_hook_title", start: 0, duration: 3, params: { title: "3 erros", left: "que travam", right: "*suas vendas*" } }], { validateComponent }).project;
  const title = (p: Project, hasMask: boolean) => probeFrame(p, 1.5, { hasMask }).regions.find((r) => r.key === "title")!;
  const facePx = (p: Project, s: Parameters<typeof faceBox>[0]) => {
    const f = faceBox(s, p.width / p.height);
    return { x: f.x * p.width, y: f.y * p.height, w: f.w * p.width, h: f.h * p.height };
  };

  it("em plano médio, com recorte, o título fica gigante atrás da pessoa", () => {
    const p = hook(talking());
    const r = title(p, true);
    // Largura de título gigante: mais da metade do quadro.
    expect(r.w).toBeGreaterThan(p.width * 0.5);
  });

  it("em close-up (rosto > 35% da altura) vira cartão em primeiro plano, redimensionado, fora do rosto", () => {
    const close = { x: 0.05, y: 0.1, w: 0.9, h: 0.9, faceX: 0.5, faceY: 0.36, faceW: 0.6, faceH: 0.42 };
    const p = hook(talking(close));
    const r = title(p, true);
    expect(inside(r, facePx(p, close))).toBe(false);
    // O cartão inteiro (título + textos de apoio) também fica fora do rosto e dentro do quadro.
    for (const region of probeFrame(p, 1.5, { hasMask: true }).regions) {
      expect(inside(region, facePx(p, close)), region.key).toBe(false);
      expect(region.y + region.h).toBeLessThanOrEqual(p.height);
    }
    // Menor que o título gigante do plano médio: foi redimensionado para a área livre.
    expect(r.w).toBeLessThan(title(hook(talking()), true).w);
  });

  it("com o rosto cortado na borda superior, idem; e sem recorte nunca cobre o rosto", () => {
    const cropped = { x: 0.2, y: 0, w: 0.6, h: 1, faceX: 0.5, faceY: 0.1, faceW: 0.3, faceH: 0.2 };
    const p = hook(talking(cropped));
    expect(inside(title(p, true), facePx(p, cropped))).toBe(false);
    const medium = { x: 0.3, y: 0.2, w: 0.4, h: 0.8, faceX: 0.5, faceY: 0.3, faceW: 0.2, faceH: 0.16 };
    const noMask = hook(talking());
    expect(inside(title(noMask, false), facePx(noMask, medium))).toBe(false);
  });
});

describe("tratamento visual, câmera e física", () => {
  it("cada grade de cor tem a sua curva; a intensidade escala; 'none' não filtra", () => {
    const look = (grade: keyof typeof LOOKS | "none", intensity = 1) => ({ grade, intensity, vignette: 0, letterbox: 0 });
    expect(lookFilter(look("none"))).toBe("none");
    const filters = (Object.keys(LOOKS) as (keyof typeof LOOKS)[]).map((g) => lookFilter(look(g)));
    expect(new Set(filters).size).toBe(4);
    expect(lookFilter(look("bleach_bypass"))).toContain("contrast(1.400) saturate(0.420)");
    expect(lookFilter(look("bleach_bypass", 0.5))).toContain("contrast(1.200) saturate(0.710)");
    expect(lookFilter(look("warm_cinematic"))).toContain("sepia(");
    expect(LOOKS.tactical_teal_orange.layers.map((l) => l.op)).toEqual(["soft-light", "overlay"]);
  });

  it("letterbox animado: as barras entram no começo e saem no fim", () => {
    expect(letterboxHeight(0, 1080, 5, 20)).toBe(0);
    expect(letterboxHeight(0.1, 1080, 0, 20)).toBe(0);
    expect(letterboxHeight(0.1, 1080, 0.3, 20)).toBeGreaterThan(0);
    expect(letterboxHeight(0.1, 1080, 5, 20)).toBe(108);
    expect(letterboxHeight(0.1, 1080, 19.9, 20)).toBeLessThan(108);
  });

  it("impacto de câmera: flash curto e tremida que decai, sem nunca mostrar borda", () => {
    const base = addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "v.mp4", duration: 10, width: 1920, height: 1080, hasAudio: true });
    const p = applyOperations(base, [{ op: "add_impact", start: 2, duration: 0.5, kind: "both" }]).project;
    expect(impactAt(p, 1.9)).toMatchObject({ flash: 0, shake: 0 });
    expect(impactAt(p, 2).flash).toBeGreaterThan(0.7);
    expect(impactAt(p, 2.3).flash).toBe(0);
    expect(impactAt(p, 2.05).shake).toBeGreaterThan(impactAt(p, 2.4).shake);
    for (let t = 2; t < 2.5; t += 0.03) {
      const r = cameraAt(p, t, 1920, 1080);
      expect(r.x).toBeLessThanOrEqual(0);
      expect(r.y).toBeLessThanOrEqual(0);
      expect(r.x + r.w).toBeGreaterThanOrEqual(p.width);
      expect(r.y + r.h).toBeGreaterThanOrEqual(p.height);
    }
  });

  it("curvas físicas: a mola passa do alvo e assenta; cada easing de zoom tem o seu caráter", () => {
    expect(spring(0)).toBe(0);
    expect(spring(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => spring(i / 50)))).toBeGreaterThan(1.02);
    expect(interpolate(5, 0, 10, 100, 200)).toBe(150);
    expect(interpolate(-3, 0, 10, 100, 200)).toBe(100);
    const z = { mode: "hold" as const, ease: 0.4, duration: 3 };
    const at = (easing: "swift" | "ease_out" | "spring", t: number) => zoomProgress({ ...z, easing }, t);
    // ease_out chega mais rápido que o in-out; a mola ultrapassa.
    expect(at("ease_out", 0.1)).toBeGreaterThan(at("swift", 0.1));
    expect(Math.max(...Array.from({ length: 40 }, (_, i) => at("spring", i * 0.01)))).toBeGreaterThan(1);
    for (const e of ["swift", "ease_out", "spring"] as const) {
      expect(at(e, 0)).toBe(0);
      expect(at(e, 1.5)).toBeCloseTo(1, 5);
      expect(at(e, 3)).toBe(0);
    }
  });

  it("zoom sem foco explícito rastreia o sujeito que se move, em vez de mirar o centro", () => {
    // Sujeito pequeno (plano aberto) que atravessa o quadro da esquerda para a direita.
    const p0 = addAssetToProject(createProject({ name: "t", aspectRatio: "16:9" }), {
      id: "a1", kind: "video", name: "v.mp4", duration: 10, width: 1920, height: 1080, hasAudio: true,
      subject: [{ t: 0, x: 0.1, y: 0.4, w: 0.15, h: 0.4, faceX: 0.17, faceY: 0.45 }, { t: 10, x: 0.75, y: 0.4, w: 0.15, h: 0.4, faceX: 0.82, faceY: 0.45 }],
    });
    const p = applyOperations(p0, [{ op: "add_zoom", start: 1, duration: 8, scale: 1.6, ease: 0.3 }]).project;
    const zoom = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "zoom")!;
    expect(zoom).toMatchObject({ follow: true });
    // Plano aberto: o foco é o centro de massa do corpo, não o rosto.
    if (zoom.type === "zoom") expect(zoom.y).toBeCloseTo(0.58, 1);
    const early = cameraAt(p, 2, 1920, 1080);
    const late = cameraAt(p, 8, 1920, 1080);
    // A câmera acompanha: no começo enquadra a esquerda do vídeo; no fim, a direita.
    expect(early.x).toBeGreaterThan(late.x + 200);
    // Com foco fixo escolhido à mão, o rastreamento desliga.
    const fixed = applyOperations(p, [{ op: "update_clip", clipId: zoom.id, x: 0.5 }]).project;
    expect(fixed.tracks.flatMap((t) => t.clips).find((c) => c.id === zoom.id)).toMatchObject({ follow: false });
  });
});

describe("som: SFX sincronizados, trilha e ducking", () => {
  const base = () => addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "v.mp4", duration: 30, hasAudio: true, transcript: { words: [{ id: "w0", text: "atenção", start: 10, end: 11 }, { id: "w1", text: "vai", start: 11.2, end: 12 }] } });

  it("efeito posicionado: o PICO do som cai no instante pedido, e ids inválidos são recusados", () => {
    const p = applyOperations(base(), [{ op: "add_sfx", sfx: "impacto_cinematico", start: 8 }, { op: "add_sfx", sfx: "sub_drop", start: 15 }], { validateSfx }).project;
    const events = soundEvents(p);
    const hit = events.find((e) => e.sfx === "impacto_cinematico")!;
    expect(hit.start + SFX_CATALOG.impacto_cinematico.peakAt).toBeCloseTo(8, 2);
    expect(events.find((e) => e.sfx === "sub_drop")!.start + SFX_CATALOG.sub_drop.peakAt).toBeCloseTo(15, 2);
    expect(() => applyOperations(base(), [{ op: "add_sfx", sfx: "nao_existe", start: 1 }], { validateSfx })).toThrow(/não existe/);
  });

  it("rampas de velocidade ganham som próprio: queda grave na câmera lenta, whoosh na aceleração", () => {
    const p = applyOperations(base(), [{ op: "speed_ramp", start: 20, duration: 4, rate: 1.8 }, { op: "speed_ramp", start: 4, duration: 2, rate: 0.5 }]).project;
    const sfx = soundEvents(p).map((e) => e.sfx);
    expect(sfx).toContain("sub_drop");
    expect(sfx).toContain("whoosh_rapido");
  });

  it("auto-ducking: a trilha desce 14 dB sob a voz, com rampas suaves, e volta nas pausas", () => {
    const p = applyOperations(base(), [{ op: "set_music", music: { mood: "action" } }]).project;
    const env = duckingEnvelope(p);
    expect(20 * Math.log10(DUCK_GAIN)).toBeCloseTo(-14, 5);
    expect(gainAt(env, 5)).toBe(1);
    expect(gainAt(env, 10.5)).toBeCloseTo(DUCK_GAIN, 5);
    // A pausa de 200 ms entre as duas palavras não faz a trilha subir e descer.
    expect(gainAt(env, 11.1)).toBeCloseTo(DUCK_GAIN, 5);
    expect(gainAt(env, 14)).toBe(1);
    // Descida e subida são rampas, não degraus.
    const down = gainAt(env, 9.91);
    expect(down).toBeGreaterThan(DUCK_GAIN);
    expect(down).toBeLessThan(1);
    const up = gainAt(env, 12.2);
    expect(up).toBeGreaterThan(DUCK_GAIN);
    expect(up).toBeLessThan(1);
    // Sem ducking, a trilha fica cheia.
    const off = applyOperations(p, [{ op: "set_music", music: { duck: false } }]).project;
    expect(gainAt(duckingEnvelope(off), 10.5)).toBe(1);
  });

  it("a trilha da casa é um loop determinístico por clima, no nível certo e sem estalo na emenda", () => {
    const sr = 8000;
    for (const mood of ["action", "ambient", "upbeat"] as const) {
      const a = synthMusic(mood, sr);
      expect(a.length).toBe(Math.round(musicLoopSeconds(mood) * sr));
      let peak = 0;
      for (const v of a) peak = Math.max(peak, Math.abs(v));
      expect(20 * Math.log10(peak)).toBeCloseTo(-12, 1);
      expect(Math.abs(a[0]!)).toBeLessThan(1e-9);
      expect(Math.abs(a[a.length - 1]!)).toBeLessThan(1e-6);
      expect(synthMusic(mood, sr)).toEqual(a);
    }
    expect(synthMusic("action", sr)).not.toEqual(synthMusic("upbeat", sr).slice(0, synthMusic("action", sr).length));
    // As batidas da trilha de ação (110 bpm) servem de grade para sincronizar cortes.
    expect(musicBeats("action", 2).slice(0, 3)).toEqual([0, 0.545, 1.091]);
    expect(musicBeats("none", 10)).toEqual([]);
  });

  it("os 3 modelos prontos aplicam acabamento que o renderer sabe tocar e desenhar", () => {
    for (const id of TEMPLATE_SKILLS) {
      const p = applyOperations(talking(), skillOperations(SKILLS[id], talking()), { validateComponent, validateSfx }).project;
      expect(lookFilter(p.look)).not.toBe("none");
      expect(CAPTION_PRESETS[p.captions.style.preset]).toBeDefined();
      for (const sfx of SKILLS[id].recipe.sfx) expect(() => validateSfx(sfx)).not.toThrow();
      for (const card of SKILLS[id].recipe.cards) expect(COMPONENTS[card], card).toBeDefined();
      // A legenda do modelo aparece na base e o quadro renderiza com cor, vinheta e letterbox.
      const frame = probeFrame(p, 1);
      expect((frame.caption!.y + frame.caption!.h / 2) / p.height).toBeGreaterThan(0.75);
    }
  });
});

describe("segmentação: recorte limpo de estúdio", () => {
  const W = 20;
  const H = 20;
  const blob = (hole = false) => {
    const m = new Float32Array(W * H);
    for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) m[y * W + x] = 1;
    if (hole) for (let y = 9; y < 11; y++) for (let x = 9; x < 11; x++) m[y * W + x] = 0;
    return m;
  };

  it("fechamento morfológico elimina buracos internos sem engordar a silhueta", () => {
    const closed = closeMask(blob(true), W, H, 2);
    expect(closed[9 * W + 9]).toBe(1);
    expect(closed[10 * W + 10]).toBe(1);
    expect(closed[2 * W + 2]).toBe(0);
    expect(Array.from(closed)).toEqual(Array.from(blob()));
  });

  it("feathering suaviza a borda alfa e preserva o miolo e o fundo", () => {
    const soft = featherMask(blob(), W, H, 1.75);
    expect(soft[10 * W + 10]).toBeCloseTo(1, 2);
    expect(soft[0]).toBeCloseTo(0, 2);
    // Na borda (x = 4) o degrau 0 → 1 vira uma rampa.
    const edge = [2, 3, 4, 5].map((x) => soft[10 * W + x]!);
    expect(edge[0]!).toBeGreaterThan(0);
    expect(edge[3]!).toBeLessThan(1);
    for (let i = 1; i < edge.length; i++) expect(edge[i]!).toBeGreaterThan(edge[i - 1]!);
  });

  it("suavização temporal segura o tremor da borda, sem deixar rastro quando a pessoa se move", () => {
    const prev = new Float32Array([0.5, 0.5, 1, 0]);
    const cur = new Float32Array([0.7, 0.3, 0, 1]);
    const out = temporalSmooth(cur, prev, 0.4);
    // Tremor pequeno: a máscara fica entre os dois quadros.
    expect(out[0]).toBeCloseTo(0.62, 5);
    expect(out[1]).toBeCloseTo(0.38, 5);
    // Mudança grande (movimento real): o quadro atual manda.
    expect(out[2]!).toBeLessThan(0.15);
    expect(out[3]!).toBeGreaterThan(0.85);
    expect(temporalSmooth(cur, null)).toBe(cur);
  });

  it("o pipeline completo devolve alfa entre 0 e 1 e a confiança suavizada para o próximo quadro", () => {
    const conf = blob(true).map((v) => (v ? 0.9 : 0.1));
    const { alpha, smoothed } = refineMask(conf, W, H, { featherPx: 1.75, scale: 0.5 });
    expect(smoothed).toBe(conf);
    expect(Math.min(...alpha)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...alpha)).toBeLessThanOrEqual(1.0001);
    expect(alpha[10 * W + 10]!).toBeGreaterThan(0.95);
  });
});
