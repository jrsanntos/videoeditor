import { describe, expect, it } from "vitest";
import {
  addAssetToProject,
  applyOperations,
  buildAgentContext,
  EditTemplateSchema,
  templateOperations,
  templatePrompt,
  type EditTemplate,
  type OperationInput,
  findRetakes,
  AgentOperationSchema,
  ProjectSchema,
  safeArea,
  shiftTimedParams,
  clipEnd,
  createProject,
  agentTier,
  creditCost,
  PLANS,
  SIGNUP_CREDITS,
  SKILLS,
  skillPrompt,
  videosEstimate,
  nextRenewal,
  renewedPlanCredits,
  splitDebit,
  getTrack,
  mainClips,
  OperationError,
  projectDuration,
  silencesFromAudio,
  silencesFromWords,
  timelineWords,
  auditPacing,
  enforcePacing,
  pacingReport,
  subjectAt,
  jumpsBefore,
  DEFAULT_PACING,
  type Project,
} from "./index";

function fixture(): Project {
  const words = ["olá", "pessoal", "hoje", "vamos", "falar", "de", "vendas"].map((text, i) => ({
    id: `w${i}`,
    text,
    // palavras de 0.4s; pausa longa (2s) entre "pessoal" e "hoje"
    start: i < 2 ? 1 + i * 0.5 : 4 + (i - 2) * 0.5,
    end: (i < 2 ? 1 + i * 0.5 : 4 + (i - 2) * 0.5) + 0.4,
  }));
  return addAssetToProject(createProject({ name: "teste" }), {
    id: "a1",
    kind: "video",
    name: "bruto.mp4",
    duration: 10,
    hasAudio: true,
    transcript: { words },
  });
}

describe("remove_ranges", () => {
  it("corta o meio do clip, divide e fecha o buraco", () => {
    const { project } = applyOperations(fixture(), [
      { op: "remove_ranges", ranges: [{ start: 2, end: 4 }] },
    ]);
    const clips = mainClips(project);
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ start: 0, duration: 2, sourceStart: 0 });
    expect(clips[1]).toMatchObject({ start: 2, duration: 6, sourceStart: 4 });
    expect(projectDuration(project)).toBe(8);
  });

  it("aplica várias faixas referentes ao mesmo estado inicial", () => {
    const { project } = applyOperations(fixture(), [
      {
        op: "remove_ranges",
        ranges: [
          { start: 8, end: 10 },
          { start: 0, end: 1 },
          { start: 3, end: 4 },
          { start: 3.5, end: 5 }, // sobrepõe a anterior → mescla
        ],
      },
    ]);
    expect(mainClips(project).map((c) => [c.start, c.duration, c.sourceStart])).toEqual([
      [0, 2, 1],
      [2, 3, 5],
    ]);
  });

  it("desloca e apara zooms e overlays junto com o corte", () => {
    const { project } = applyOperations(fixture(), [
      { op: "add_zoom", start: 1, duration: 2 }, // 1–3: cauda cortada
      { op: "add_zoom", start: 6, duration: 1 }, // 6–7: desloca
      { op: "add_component", component: "x", start: 2.5, duration: 1, params: {} }, // dentro: some
      { op: "remove_ranges", ranges: [{ start: 2, end: 4 }] },
    ]);
    expect(getTrack(project, "fx").clips.map((c) => [c.start, c.duration])).toEqual([
      [1, 1],
      [4, 1],
    ]);
    expect(getTrack(project, "overlay").clips).toHaveLength(0);
  });

  it("mantém as palavras da transcrição sincronizadas com os cortes", () => {
    const { project } = applyOperations(fixture(), [
      { op: "remove_ranges", ranges: [{ start: 2, end: 4 }] },
    ]);
    const words = timelineWords(project);
    expect(words.map((w) => w.text)).toEqual(["olá", "pessoal", "hoje", "vamos", "falar", "de", "vendas"]);
    expect(words.find((w) => w.text === "hoje")!.start).toBe(2);
  });
});

describe("edição manual", () => {
  it("split + delete_clip faz ripple na trilha principal", () => {
    let { project } = applyOperations(fixture(), [
      { op: "split", time: 3 },
      { op: "split", time: 5 },
    ]);
    const middle = mainClips(project)[1]!;
    ({ project } = applyOperations(project, [{ op: "delete_clip", clipId: middle.id }]));
    expect(mainClips(project).map((c) => [c.start, c.duration, c.sourceStart])).toEqual([
      [0, 3, 0],
      [3, 5, 5],
    ]);
  });

  it("trim_clip encurta e depois recupera material empurrando o resto", () => {
    let { project } = applyOperations(fixture(), [{ op: "split", time: 5 }]);
    const [a, b] = mainClips(project);
    ({ project } = applyOperations(project, [{ op: "trim_clip", clipId: a!.id, sourceStart: 1, sourceEnd: 4 }]));
    expect(mainClips(project).map((c) => [c.start, c.duration, c.sourceStart])).toEqual([
      [0, 3, 1],
      [3, 5, 5],
    ]);
    ({ project } = applyOperations(project, [{ op: "trim_clip", clipId: a!.id, sourceStart: 0, sourceEnd: 5 }]));
    expect(mainClips(project).map((c) => [c.id, c.start, c.duration, c.sourceStart])).toEqual([
      [a!.id, 0, 5, 0],
      [b!.id, 5, 5, 5],
    ]);
  });

  it("overlays sobrepostos vão para trilhas diferentes", () => {
    const { project } = applyOperations(fixture(), [
      { op: "add_component", component: "x", start: 1, duration: 3, params: {} },
      { op: "add_component", component: "y", start: 2, duration: 3, params: {} },
    ]);
    expect(project.tracks.filter((t) => t.kind === "overlay" && t.clips.length)).toHaveLength(2);
  });
});

describe("robustez", () => {
  it("falha de forma atômica e informa o índice da operação", () => {
    const base = fixture();
    try {
      applyOperations(base, [
        { op: "split", time: 3 },
        { op: "delete_clip", clipId: "nao-existe" },
      ]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OperationError);
      expect((e as OperationError).index).toBe(1);
    }
    expect(mainClips(base)).toHaveLength(1); // entrada intacta
  });

  it("rejeita operações fora do schema", () => {
    expect(() => applyOperations(fixture(), [{ op: "add_zoom", start: 1, duration: 1, scale: 99 }])).toThrow(
      OperationError,
    );
  });
});

describe("silêncios", () => {
  it("remove_silences usa as pausas da transcrição", () => {
    const { project, log } = applyOperations(fixture(), [
      { op: "remove_silences", minSilence: 0.5, padding: 0.1 },
    ]);
    // 0–0.9 (início), 2.0–3.9 (pausa), 6.5–10 (cauda) → 0.9 + 1.9 + 3.5 = 6.3s
    expect(projectDuration(project)).toBeCloseTo(3.7, 3);
    expect(log[0]).toContain("3 silêncio");
    expect(timelineWords(project)).toHaveLength(7);
  });

  it("silencesFromWords respeita o padding", () => {
    expect(silencesFromWords([{ start: 0, end: 1 }, { start: 3, end: 4 }], 4, { padding: 0.2 })).toEqual([
      { start: 1.2, end: 2.8 },
    ]);
  });

  it("silencesFromAudio encontra trechos abaixo do limiar", () => {
    const sr = 1000;
    const samples = new Float32Array(sr * 4);
    for (let i = 0; i < samples.length; i++) {
      const t = i / sr;
      samples[i] = t >= 1 && t < 3 ? 0 : Math.sin(i) * 0.5;
    }
    const [r] = silencesFromAudio(samples, sr, { minSilence: 0.5, padding: 0.1 });
    expect(r!.start).toBeCloseTo(1.1, 1);
    expect(r!.end).toBeCloseTo(2.9, 1);
  });
});

describe("agente e créditos", () => {
  it("contexto com seleção inclui só o trecho selecionado", () => {
    const full = buildAgentContext(fixture());
    const scoped = buildAgentContext(fixture(), { start: 4, end: 5 });
    expect(full).toContain("olá pessoal");
    expect(full).toContain("(pausa 2.1s)");
    expect(scoped).toContain("hoje");
    expect(scoped).not.toContain("olá");
    expect(scoped).toContain("SELEÇÃO ATIVA");
  });

  it("precificação: transcrição por minuto, edição completa por duração, ajuste a 1 crédito", () => {
    expect(creditCost({ type: "ingest", durationSec: 600 })).toBe(10);
    expect(creditCost({ type: "ingest", durationSec: 61 })).toBe(2);
    expect(creditCost({ type: "agent", tier: "full", durationSec: 37 })).toBe(15);
    expect(creditCost({ type: "agent", tier: "full", durationSec: 600 })).toBe(42);
    expect(creditCost({ type: "agent", tier: "adjust", durationSec: 600 })).toBe(1);
    expect(creditCost({ type: "cloud_export", durationSec: 120 })).toBe(10);
    expect(creditCost({ type: "manual" })).toBe(0);
    expect(creditCost({ type: "browser_export" })).toBe(0);
  });

  it("classifica o pedido: skills e direção do vídeo inteiro são edição completa; o resto é ajuste", () => {
    for (const id of Object.keys(SKILLS) as (keyof typeof SKILLS)[]) expect(agentTier(skillPrompt(SKILLS[id]), false)).toBe("full");
    expect(agentTier("Edite meu vídeo no estilo viral", false)).toBe("full");
    expect(agentTier("deixa o vídeo inteiro mais dinâmico", false)).toBe("full");
    expect(agentTier("Aplique o modelo de edição \"VSL dinâmica\" a este vídeo.", false)).toBe("full");
    expect(agentTier("aumenta o zoom na parte do preço", false)).toBe("adjust");
    expect(agentTier("troca a legenda para amarelo", false)).toBe("adjust");
    // Com trecho selecionado é sempre pontual, mesmo que o texto pareça amplo.
    expect(agentTier("edite o vídeo todo", true)).toBe("adjust");
  });

  it("planos: Free ganha créditos só no cadastro; estimativas de vídeos batem com a tabela", () => {
    expect(PLANS.free.monthlyCredits).toBe(0);
    expect(SIGNUP_CREDITS).toBe(60);
    expect(videosEstimate(PLANS.creator.monthlyCredits)).toEqual({ min: 35, max: 50 });
    expect(videosEstimate(PLANS.pro.monthlyCredits)).toEqual({ min: 120, max: 170 });
    expect(videosEstimate(SIGNUP_CREDITS)).toEqual({ min: 2, max: 3 });
    expect([PLANS.free.brandKits, PLANS.creator.brandKits, PLANS.pro.brandKits]).toEqual([1, 1, 10]);
    // Toda ação paga deixa margem mesmo no crédito mais barato (Pro): edição completa de 1 min
    // custa ~R$ 0,31 em IA e rende 15 créditos.
    const cheapestCredit = PLANS.pro.priceBRL / PLANS.pro.monthlyCredits;
    expect(creditCost({ type: "agent", tier: "full", durationSec: 60 }) * cheapestCredit).toBeGreaterThan(0.31 * 3);
  });

  it("débito consome o saldo do plano antes do extra", () => {
    expect(splitDebit(30, 500, 10)).toEqual({ plan: 10, extra: 0 });
    expect(splitDebit(4, 500, 10)).toEqual({ plan: 4, extra: 6 });
    expect(splitDebit(0, 500, 10)).toEqual({ plan: 0, extra: 10 });
    // Nenhum saldo cobre: o resto fica como dívida no saldo do plano.
    expect(splitDebit(3, 2, 10)).toEqual({ plan: 8, extra: 2 });
    expect(splitDebit(-5, 0, 10)).toEqual({ plan: 10, extra: 0 });
  });

  it("renovação repõe o saldo do plano sem acumular e desconta dívida", () => {
    expect(renewedPlanCredits(120, 1000)).toBe(1000);
    expect(renewedPlanCredits(0, 30)).toBe(30);
    expect(renewedPlanCredits(-8, 30)).toBe(22);
  });

  it("próxima renovação mantém o dia do mês e não acumula meses perdidos", () => {
    const iso = (a: string, n: string) => nextRenewal(new Date(a), new Date(n)).toISOString();
    expect(iso("2026-01-15T10:00:00.000Z", "2026-01-15T10:00:00.000Z")).toBe("2026-02-15T10:00:00.000Z");
    expect(iso("2026-01-15T10:00:00.000Z", "2026-02-20T00:00:00.000Z")).toBe("2026-03-15T10:00:00.000Z");
    expect(iso("2026-01-15T10:00:00.000Z", "2026-06-14T00:00:00.000Z")).toBe("2026-06-15T10:00:00.000Z");
    expect(iso("2026-01-31T10:00:00.000Z", "2026-02-01T00:00:00.000Z")).toBe("2026-02-28T10:00:00.000Z");
    expect(iso("2026-11-30T10:00:00.000Z", "2026-12-31T00:00:00.000Z")).toBe("2027-01-30T10:00:00.000Z");
  });
});

describe("referências estáveis por palavra", () => {
  /** Palavras de 0.4s a cada 0.5s a partir de 1s: w{i} começa em 1 + i*0.5. */
  function withWords(texts: string[]): Project {
    const words = texts.map((text, i) => ({ id: `w${i}`, text, start: 1 + i * 0.5, end: 1.4 + i * 0.5 }));
    return addAssetToProject(createProject({ name: "rep" }), {
      id: "a1",
      kind: "video",
      name: "bruto.mp4",
      duration: 1 + texts.length * 0.5 + 1,
      hasAudio: true,
      transcript: { words },
    });
  }
  const talk = () => withWords(["Olá", "pessoal.", "O", "segredo", "do", "o", "segredo", "do", "sucesso", "é", "constância", "todo", "dia."]);
  const spoken = (p: Project) => timelineWords(p).map((w) => w.id).join(" ");

  it("cut_words corta do início da primeira palavra ao início da seguinte à última", () => {
    const { project, log } = applyOperations(talk(), [{ op: "cut_words", cuts: [{ from: "w2", to: "w4" }] }]);
    expect(spoken(project)).toBe("w0 w1 w5 w6 w7 w8 w9 w10 w11 w12");
    // w2 começa em 2s e w5 em 3.5s: saem exatamente 1.5s, e w5 passa a começar onde w2 começava.
    expect(timelineWords(project).find((w) => w.id === "w5")!.start).toBe(2);
    expect(log[0]).toContain('"O segredo do"');
  });

  it("zoom e componente ancorados em palavra não se deslocam, em qualquer ordem de operações", () => {
    const cut: OperationInput = { op: "cut_words", cuts: [{ from: "w2", to: "w4" }] };
    const zoom: OperationInput = { op: "add_zoom", atWord: "w8", untilWord: "w10" };
    const comp: OperationInput = { op: "add_component", component: "x", atWord: "w9", duration: 2, params: { items: [{ atWord: "w10" }, { atWord: "w12" }] } };
    const a = applyOperations(talk(), [zoom, comp, cut]).project;
    const b = applyOperations(talk(), [cut, zoom, comp]).project;
    for (const p of [a, b]) {
      const words = timelineWords(p);
      const at = (id: string) => words.find((w) => w.id === id)!;
      const z = getTrack(p, "fx").clips[0]!;
      expect(z.start).toBe(at("w8").start);
      expect(clipEnd(z)).toBe(at("w10").end);
      const c = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "component")!;
      expect(c.start).toBe(at("w9").start);
      if (c.type !== "component") throw new Error("esperado componente");
      // atWord vira `at` relativo ao início do componente: w10 está 0.5s depois de w9, w12 a 1.5s.
      expect(c.params).toEqual({ items: [{ at: 0.5 }, { at: 1.5 }] });
    }
  });

  it("cortar de novo o mesmo trecho não faz nada; ancorar em palavra cortada é erro claro", () => {
    const cut: OperationInput = { op: "cut_words", cuts: [{ from: "w2", to: "w4" }] };
    const { project, log } = applyOperations(talk(), [cut, cut]);
    expect(log[1]).toContain("nada a cortar");
    expect(() => applyOperations(project, [{ op: "add_zoom", atWord: "w3", duration: 2 }])).toThrow(/w3 não está na timeline/);
  });

  it("o vocabulário do agente não aceita tempo de timeline", () => {
    expect(AgentOperationSchema.safeParse({ op: "remove_ranges", ranges: [{ start: 1, end: 2 }] }).success).toBe(false);
    expect(AgentOperationSchema.safeParse({ op: "add_zoom", start: 3, duration: 2 }).success).toBe(false);
    expect(AgentOperationSchema.safeParse({ op: "add_zoom", atWord: "w3", duration: 2 }).success).toBe(true);
  });

  it("o contexto do agente usa ids de palavra e tempo do vídeo bruto, mesmo depois de cortes", () => {
    const before = buildAgentContext(talk());
    expect(before).toContain("[w0–w1 | 1–1.9 | 1–1.9] Olá pessoal.");
    const { project } = applyOperations(talk(), [{ op: "cut_words", cuts: [{ from: "w0", to: "w1" }] }]);
    const after = buildAgentContext(project);
    // "O" continua sendo w2 em 2s do bruto, embora agora esteja no início da timeline.
    expect(after).toMatch(/\[w2–w\d+ \| 2–/);
    expect(after).not.toContain("Olá");
  });
});

describe("takes ruins", () => {
  const takes = (texts: string[], gaps: Record<number, number> = {}) => {
    let t = 1;
    const words = texts.map((text, i) => {
      t += gaps[i] ?? 0;
      const w = { id: `w${i}`, text, start: Math.round(t * 100) / 100, end: Math.round((t + 0.4) * 100) / 100, clipId: "c", assetId: "a" };
      t += 0.5;
      return w;
    });
    return findRetakes(words);
  };

  it("frase abandonada e recomeçada: corta até o recomeço, com confiança alta", () => {
    const r = takes(["Olá.", "O", "segredo", "do", "o", "segredo", "do", "sucesso", "é", "constância."]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "restart", confidence: "alta", from: "w1", to: "w3", cutText: "O segredo do" });
    expect(r[0]!.keepText).toMatch(/^o segredo do sucesso/);
  });

  it("recomeço com palavras no meio também é encontrado", () => {
    const r = takes(["Hoje", "eu", "vou", "mostrar", "como", "é", "hoje", "eu", "vou", "mostrar", "três", "passos."]);
    expect(r[0]).toMatchObject({ kind: "restart", confidence: "alta", from: "w0", to: "w5" });
  });

  it("gaguejo de uma palavra conta; artigo repetido não", () => {
    const r = takes(["é", "é", "preciso", "mudar", "mudar", "a", "oferta."]);
    expect(r.map((x) => [x.kind, x.cutText])).toEqual([["stutter", "mudar"]]);
  });

  it("paralelismo com frases completas fica como dúvida, não como erro certo", () => {
    const r = takes(["Você", "precisa", "de", "foco.", "Você", "precisa", "de", "método."]);
    expect(r).toHaveLength(1);
    expect(r[0]!.confidence).toBe("media");
  });

  it("aviso de erro corta a frase até o aviso", () => {
    const r = takes(["Tudo", "certo.", "O", "preço", "é", "cem,", "errei.", "Custa", "duzentos", "reais."]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "marker", confidence: "alta", from: "w2", to: "w6" });
  });

  it("'de novo' no meio de uma frase normal não é aviso de erro", () => {
    expect(takes(["Faça", "de", "novo", "amanhã", "cedo."])).toEqual([]);
  });

  it("remove_retakes corta só os de confiança alta por padrão", () => {
    const words = ["Olá.", "O", "segredo", "do", "o", "segredo", "do", "sucesso.", "Você", "precisa", "de", "foco.", "Você", "precisa", "de", "método."].map(
      (text, i) => ({ id: `w${i}`, text, start: 1 + i * 0.5, end: 1.4 + i * 0.5 }),
    );
    const p = addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "v.mp4", duration: 12, hasAudio: true, transcript: { words } });
    const { project } = applyOperations(p, [{ op: "remove_retakes" }]);
    expect(timelineWords(project).map((w) => w.text).join(" ")).toBe("Olá. o segredo do sucesso. Você precisa de foco. Você precisa de método.");
  });
});

describe("formato e áreas seguras", () => {
  it("projeto novo é vertical 1080×1920; projeto antigo sem o campo continua horizontal", () => {
    const p = createProject({ name: "x" });
    expect([p.aspectRatio, p.width, p.height]).toEqual(["9:16", 1080, 1920]);
    const { aspectRatio: _a, framing: _f, sfx: _s, ...old } = createProject({ name: "x", aspectRatio: "16:9" });
    expect(ProjectSchema.parse(old)).toMatchObject({ aspectRatio: "16:9", framing: { x: 0.5, y: 0.5 }, sfx: { enabled: true } });
  });

  it("set_format troca as dimensões e preserva a edição", () => {
    const { project } = applyOperations(fixture(), [{ op: "add_zoom", start: 1, duration: 2 }, { op: "set_format", aspectRatio: "16:9", framing: { x: 0.3 } }]);
    expect([project.width, project.height, project.framing.x, project.framing.y]).toEqual([1920, 1080, 0.3, 0.5]);
    expect(getTrack(project, "fx").clips).toHaveLength(1);
  });

  it("no vertical as margens cobrem a interface dos apps: mais embaixo e à direita", () => {
    const v = safeArea(createProject({ name: "v" }));
    const h = safeArea(createProject({ name: "h", aspectRatio: "16:9" }));
    expect(v.bottom).toBeGreaterThan(v.top);
    expect(v.right).toBeGreaterThan(v.left);
    expect(v.bottom / 1920).toBeGreaterThan(0.2);
    expect(h.bottom / 1080).toBeLessThan(0.1);
  });
});

describe("brand kit", () => {
  it("projeto novo nasce com o padrão; projeto antigo sem brand continua abrindo", () => {
    const p = createProject({ name: "x" });
    expect(p.brand).toMatchObject({ backgroundColor: "#0B0F19", textColor: "#F8FAFC" });
    const { brand: _, ...old } = p;
    expect(ProjectSchema.parse(old).brand.primaryColor).toBe("#FACC15");
  });

  it("set_brand mescla e valida as cores", () => {
    const { project } = applyOperations(createProject({ name: "x" }), [{ op: "set_brand", brand: { primaryColor: "#FF0055", displayName: "Dra. Ana Silva", credential: "CRM 12345" } }]);
    expect(project.brand).toMatchObject({ primaryColor: "#FF0055", secondaryColor: "#38BDF8", displayName: "Dra. Ana Silva" });
    expect(() => applyOperations(project, [{ op: "set_brand", brand: { primaryColor: "vermelho" } }])).toThrow();
  });
});

describe("instantes internos de componentes (at)", () => {
  it("um corte dentro do componente recua os instantes posteriores", () => {
    const { project } = applyOperations(fixture(), [
      {
        op: "add_component",
        component: "bar_chart",
        start: 1,
        duration: 6,
        params: { bars: [{ label: "a", value: 1, at: 0.5 }, { label: "b", value: 2, at: 2.5 }, { label: "c", value: 3, at: 4 }] },
      },
      { op: "remove_ranges", ranges: [{ start: 2, end: 3 }] },
    ]);
    const comp = getTrack(project, "overlay")!.clips[0]!;
    expect(comp.duration).toBe(5);
    if (comp.type !== "component") throw new Error("esperado componente");
    // corte em 1s–2s relativo ao componente: 0.5 fica, 2.5 → 1.5, 4 → 3
    expect((comp.params.bars as { at: number }[]).map((b) => b.at)).toEqual([0.5, 1.5, 3]);
  });

  it("instante dentro do trecho cortado vai para o ponto do corte", () => {
    expect(shiftTimedParams({ bars: [{ at: 1.2 }] }, 1, 0.5)).toEqual({ bars: [{ at: 1 }] });
  });
});

describe("modelos de edição", () => {
  const template: EditTemplate = {
    name: "VSL dinâmica",
    description: "Cortes rápidos e gráfico nos números.",
    captions: { enabled: true, preset: "bold", position: "center" },
    silence: { remove: true, minSilence: 0.4, padding: 0.1 },
    zoom: { perMinute: 4, scale: 1.25, duration: 3, focusY: 0.38 },
    motion: [{ component: "bar_chart", when: "quando citar números comparáveis" }],
    pacing: "rápido",
    instructions: "Corte pausas e dê zoom nas ênfases.",
  };

  it("legendas do modelo são aplicadas localmente quando há transcrição", () => {
    const ops = templateOperations(template, fixture());
    expect(ops).toEqual([{ op: "set_captions", enabled: true, style: { preset: "bold", position: "center" } }]);
    const { project } = applyOperations(fixture(), ops);
    expect(project.captions.style).toMatchObject({ preset: "bold", position: "center" });
  });

  it("sem transcrição não há operação local", () => {
    const empty = addAssetToProject(createProject({ name: "x" }), { id: "a1", kind: "video", name: "v.mp4", duration: 5, hasAudio: true });
    expect(templateOperations(template, empty)).toEqual([]);
  });

  it("a receita para o agente traz pausas, zooms e motion", () => {
    const prompt = templatePrompt(template);
    expect(prompt).toContain("acima de 0.4s");
    expect(prompt).toContain("cerca de 4 por minuto");
    expect(prompt).toContain("- bar_chart: quando citar números comparáveis");
    expect(EditTemplateSchema.safeParse(template).success).toBe(true);
  });
});

describe("ritmo da edição", () => {
  const base = () => {
    const p = fixture();
    p.assets.a1!.duration = 40;
    getTrack(p, "main").clips[0]!.duration = 40;
    return p;
  };

  it("acusa vídeo sub-editado: gancho nu, trecho parado, zoom imperceptível", () => {
    const { project } = applyOperations(base(), [{ op: "add_zoom", start: 10, duration: 4, scale: 1.08, mode: "creep" }]);
    const audit = auditPacing(project);
    const codes = audit.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["hook", "estatico", "zoom_fraco", "poucos_zooms", "poucos_componentes"]));
    expect(audit.longestStatic).toBe(26);
    expect(pacingReport(audit)).toContain("Corrija (obrigatório)");
  });

  it("acusa excesso e colisão, e a poda determinística resolve o que colide", () => {
    const { project } = applyOperations(base(), [
      { op: "add_zoom", start: 0, duration: 3, scale: 1.2, ease: 0 },
      { op: "add_zoom", start: 2, duration: 3, scale: 1.2, ease: 0 },
      { op: "add_component", component: "kinetic_pivot_card", start: 1, duration: 5, params: {} },
      { op: "add_component", component: "kinetic_pivot_card", start: 2, duration: 5, params: {} },
      { op: "add_component", component: "stat_counter", start: 3, duration: 3, params: { fullscreen: true } },
    ]);
    const codes = auditPacing(project).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["densidade", "sobreposicao", "zoom_sobreposto"]));
    const pruned = enforcePacing(project);
    expect(pruned.log.length).toBeGreaterThan(0);
    const after = auditPacing(pruned.project).issues.map((i) => i.code);
    for (const gone of ["densidade", "sobreposicao", "zoom_sobreposto", "componentes_colados"]) expect(after).not.toContain(gone);
    // A entrada não é mutada.
    expect(auditPacing(project).issues.map((i) => i.code)).toContain("sobreposicao");
  });

  it("três punch-ins seguidos pedem outra modalidade", () => {
    const { project } = applyOperations(base(), [0, 4, 8].map((start) => ({ op: "add_zoom" as const, start, duration: 2, scale: 1.2, ease: 0 })));
    expect(auditPacing(project, { ...DEFAULT_PACING, maxPunchStreak: 2 }).issues.map((i) => i.code)).toContain("punch_repetido");
  });
});

describe("enquadramento e legendas editáveis", () => {
  it("zoom sem foco fecha no rosto medido, convertido para o quadro do projeto", () => {
    const p = fixture();
    Object.assign(p.assets.a1!, { width: 1920, height: 1080, subject: [{ t: 1, x: 0.4, y: 0.1, w: 0.2, h: 0.9, faceX: 0.5, faceY: 0.25 }] });
    const s = subjectAt(p, 1)!;
    expect(s.faceX).toBeCloseTo(0.5, 2);
    expect(s.faceY).toBeCloseTo(0.25, 2);
    const { project } = applyOperations(p, [{ op: "add_zoom", start: 0, duration: 2 }, { op: "add_zoom", start: 3, duration: 1, x: 0.1, y: 0.9 }]);
    const zooms = getTrack(project, "fx").clips;
    expect(zooms[0]).toMatchObject({ x: s.faceX, y: s.faceY });
    expect(zooms[1]).toMatchObject({ x: 0.1, y: 0.9 });
    expect(buildAgentContext(project)).toContain("Enquadramento (medido no vídeo");
  });

  it("edit_caption reescreve, esconde e desloca sem mexer nas outras palavras", () => {
    const { project } = applyOperations(fixture(), [
      { op: "edit_caption", wordIds: ["w0", "w1", "w2"], text: "oi gente" },
      { op: "edit_caption", wordIds: ["w3", "w4"], hidden: true, shift: 0.4 },
    ]);
    const words = project.assets.a1!.transcript!.words;
    expect(words.slice(0, 3).map((w) => w.text)).toEqual(["oi", "gente", ""]);
    expect(words[3]).toMatchObject({ hidden: true, shift: 0.4 });
    expect(words[5]!.hidden).toBeUndefined();
    const back = applyOperations(project, [{ op: "edit_caption", wordIds: ["w3", "w4"], hidden: false, shift: 0 }]).project;
    expect(back.assets.a1!.transcript!.words[3]).not.toHaveProperty("hidden");
    expect(back.assets.a1!.transcript!.words[3]).not.toHaveProperty("shift");
  });

  it("a energia da voz aparece no contexto do agente", () => {
    const p = fixture();
    p.assets.a1!.transcript!.words[6]!.energy = 6.2;
    expect(buildAgentContext(p)).toMatch(/forte: w6 "vendas" \+6dB/);
  });
});

describe("mídia de contexto (b-roll)", () => {
  const withMedia = () => {
    const p = fixture();
    p.assets.b1 = { id: "b1", kind: "video", name: "academia.mp4", duration: 3, hasAudio: false, role: "context", description: "pessoa levantando peso" };
    return p;
  };

  it("entra numa trilha própria, presa à duração do material, e segue os cortes", () => {
    const { project, log } = applyOperations(withMedia(), [{ op: "add_broll", assetId: "b1", atWord: "w2", duration: 8 }]);
    const track = project.tracks.find((t) => t.kind === "broll")!;
    expect(track.clips[0]).toMatchObject({ type: "broll", start: 4, duration: 3, layout: "full" });
    expect(log[0]).toContain("academia.mp4");
    // A trilha fica entre o motion e o zoom.
    expect(project.tracks.map((t) => t.kind)).toEqual(["overlay", "broll", "fx", "main"]);
    const cut = applyOperations(project, [{ op: "remove_ranges", ranges: [{ start: 1, end: 3 }] }]).project;
    expect(cut.tracks.find((t) => t.kind === "broll")!.clips[0]!.start).toBe(2);
  });

  it("recusa asset que não é de contexto e aparece para o agente e para o auditor", () => {
    expect(() => applyOperations(withMedia(), [{ op: "add_broll", assetId: "a1", start: 0, duration: 2 }])).toThrow(/não existe/);
    expect(AgentOperationSchema.safeParse({ op: "add_broll", assetId: "b1", atWord: "w2", untilWord: "w4" }).success).toBe(true);
    const { project } = applyOperations(withMedia(), [{ op: "add_broll", assetId: "b1", start: 0, duration: 3 }]);
    expect(buildAgentContext(project)).toContain("b1 | vídeo de 3s | academia.mp4 — pessoa levantando peso");
    expect(auditPacing(project).issues.map((i) => i.code)).not.toContain("hook");
  });
});

describe("acabamento", () => {
  it("conta só cortes de verdade: dividir um clip não é um salto", () => {
    const split = applyOperations(fixture(), [{ op: "split", time: 5 }]).project;
    const [a, b] = mainClips(split);
    expect(jumpsBefore(split, a!.id)).toBe(0);
    expect(jumpsBefore(split, b!.id)).toBe(0);
    const cut = applyOperations(fixture(), [{ op: "remove_ranges", ranges: [{ start: 2, end: 4 }, { start: 6, end: 7 }] }]).project;
    expect(mainClips(cut).map((c) => jumpsBefore(cut, c.id))).toEqual([0, 1, 2]);
    expect(cut.finish).toEqual({ cutZoom: true, voice: true });
  });
});
