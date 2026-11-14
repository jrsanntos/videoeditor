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
  fillersFor,
  wordsToReview,
  AgentOperationSchema,
  ProjectSchema,
  safeArea,
  shiftTimedParams,
  clipEnd,
  createProject,
  agentTier,
  aiBudgetUSD,
  ECONOMICS,
  MEASURED_AI_COST_USD,
  MIN_NET_MARGIN,
  minRevenuePerCreditBRL,
  PLANS,
  SIGNUP_CREDITS,
  TOPUPS,
  creditCost,
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
  ensureLowerThird,
  findFillers,
  falseStart,
  isHesitationToken,
  speechRate,
  splitFalseStart,
  splitHesitations,
  stretchedWords,
  syllables,
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
    // Pré-roll de 150 ms e pós-roll de 220 ms: 0–0.85 (início), 2.12–3.85 (pausa), 6.62–10 (cauda) → 5.96s
    expect(projectDuration(project)).toBeCloseTo(4.04, 3);
    expect(log[0]).toContain("3 silêncio");
    expect(timelineWords(project)).toHaveLength(7);
  });

  it("silencesFromWords respeita o padding", () => {
    // O padding pedido vale como piso extra; o pós-roll nunca fica abaixo de 220 ms.
    expect(silencesFromWords([{ start: 0, end: 1 }, { start: 3, end: 4 }], 4, { padding: 0.2 })).toEqual([
      { start: 1.22, end: 2.8 },
    ]);
    expect(silencesFromWords([{ start: 0, end: 1 }, { start: 3, end: 4 }], 4, { padding: 0.3 })).toEqual([
      { start: 1.3, end: 2.7 },
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
    expect(r!.start).toBeCloseTo(1.22, 1);
    expect(r!.end).toBeCloseTo(2.85, 1);
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
    expect(creditCost({ type: "ingest", durationSec: 600 })).toBe(5);
    expect(creditCost({ type: "ingest", durationSec: 61 })).toBe(1);
    expect(creditCost({ type: "agent", tier: "full", durationSec: 37 })).toBe(13);
    expect(creditCost({ type: "agent", tier: "full", durationSec: 600 })).toBe(40);
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
    expect(SIGNUP_CREDITS).toBe(20);
    expect(videosEstimate(PLANS.creator.monthlyCredits)).toEqual({ min: 15, max: 20 });
    expect(videosEstimate(PLANS.pro.monthlyCredits)).toEqual({ min: 45, max: 60 });
    expect(videosEstimate(SIGNUP_CREDITS)).toEqual({ min: 1, max: 1 });
    expect([PLANS.free.brandKits, PLANS.creator.brandKits, PLANS.pro.brandKits]).toEqual([1, 1, 10]);
    // Toda ação paga deixa margem mesmo no crédito mais barato (Pro): a edição completa de 1 min
    // custa ~US$ 0,12 em IA (R$ 0,74 no câmbio de segurança) e precisa render mais que 3× isso.
    const cheapestCredit = PLANS.pro.priceBRL / PLANS.pro.monthlyCredits;
    expect(creditCost({ type: "agent", tier: "full", durationSec: 60 }) * cheapestCredit).toBeGreaterThan(MEASURED_AI_COST_USD.fullEditShort * ECONOMICS.usdBrl * 3);
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
    expect(() => applyOperations(withMedia(), [{ op: "add_broll", assetId: "nao_existe", start: 0, duration: 2 }])).toThrow(/não existe/);
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

// ====================================================================
// Critérios de aceite da evolução para "padrão ouro" (6 épicos)
// ====================================================================
import {
  actionRanges,
  BUILTIN_TEMPLATES,
  BrandKitSchema,
  captionAlpha,
  captionBaseY,
  captionSuppression,
  checkArtDirection,
  classifyGenre,
  createEmptyProject,
  critiqueEdit,
  cutFadeGain,
  CUT_FADE,
  depthPlacement,
  detectCuts,
  energyPeaks,
  faceBox,
  hasSpeed,
  isCloseUp,
  avoidFaces,
  faceFromDetection,
  keepLocalMeasurements,
  framingObjections,
  localTimeAt,
  mainGaps,
  MotionGraphicSchema,
  placeCaption,
  projectGenre,
  SILENCE_RULES,
  skillForGenre,
  skillOperations,
  sourceSpan,
  sourceTimeAt,
  speechProfile,
  StyleReferenceProfileSchema,
  TEMPLATE_SKILLS,
  timelineView,
  toOTIO,
  voiceRanges,
  type AssetAnalysis,
  type MediaClip,
} from "./index";

/** Vídeo de 70 s, 2 clips de teste, sem transcrição. */
const blank = (duration = 10) => addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "bruto.mp4", duration, hasAudio: true, width: 1920, height: 1080 });
const media = (p: Project) => mainClips(p).sort((a, b) => a.start - b.start);

describe("1. entrada: timeline vazia, tarja desligada, referência de estilo", () => {
  it("o link 'pular direto para o editor' abre uma timeline vazia e funcional", () => {
    const p = createEmptyProject();
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(mainClips(p)).toHaveLength(0);
    expect(projectDuration(p)).toBe(0);
    expect(p.tracks.map((t) => t.kind)).toEqual(["overlay", "fx", "main"]);
    // Composição só com texto, cards e sons: nada exige um vídeo na trilha principal.
    const { project } = applyOperations(p, [
      { op: "add_component", component: "title_card", start: 0, duration: 3, params: { title: "Abertura" } },
      { op: "add_sfx", sfx: "pop", start: 0.2 },
      { op: "set_music", music: { mood: "ambient" } },
    ]);
    expect(projectDuration(project)).toBe(3);
    // E a mídia pode entrar depois.
    const later = structuredClone(project);
    later.assets.v1 = { id: "v1", kind: "video", name: "depois.mp4", duration: 5, hasAudio: true };
    const withVideo = applyOperations(later, [{ op: "insert_clip", assetId: "v1", at: 3 }]).project;
    expect(media(withVideo)[0]).toMatchObject({ start: 3, duration: 5 });
    expect(buildAgentContext(p)).toContain("vazia: composição sem vídeo");
  });

  it("a tarja de nome/cargo nasce desligada; projetos que a ligaram continuam com ela", () => {
    expect(BrandKitSchema.parse({}).showLowerThird).toBe(false);
    expect(createProject({ name: "x" }).brand.showLowerThird).toBe(false);
    expect(BrandKitSchema.parse({ showLowerThird: true }).showLowerThird).toBe(true);
    const ctx = buildAgentContext(fixture());
    expect(ctx).toContain("Tarja de nome/cargo: DESLIGADA");
    const on = applyOperations(fixture(), [{ op: "set_brand", brand: { showLowerThird: true, displayName: "Dra. Ana" } }]).project;
    expect(buildAgentContext(on)).toContain("Tarja de nome/cargo: disponível");
  });

  it("ajustes parciais só mudam o que foi pedido (o nome da tarja não some ao trocar a cor)", () => {
    const named = applyOperations(fixture(), [
      { op: "set_brand", brand: { displayName: "Sgt. Lima", credential: "Instrutor", showLowerThird: true, vocabulary: ["taser"] } },
      { op: "set_look", look: { grade: "warm_cinematic", vignette: 0.3 } },
      { op: "set_music", music: { mood: "ambient", volume: 0.2 } },
    ]).project;
    const after = applyOperations(named, [
      { op: "set_brand", brand: { primaryColor: "#D9A441" } },
      { op: "set_look", look: { intensity: 0.5 } },
      { op: "set_music", music: { duck: true } },
    ]).project;
    expect(after.brand).toMatchObject({ displayName: "Sgt. Lima", credential: "Instrutor", showLowerThird: true, vocabulary: ["taser"], primaryColor: "#D9A441" });
    expect(after.look).toMatchObject({ grade: "warm_cinematic", vignette: 0.3, intensity: 0.5 });
    expect(after.music).toMatchObject({ mood: "ambient", volume: 0.2, duck: true });
  });

  it("o nome informado sempre vira tarja, mesmo se a IA esquecer; sem nome ou desligada, nada muda", () => {
    const named = applyOperations(fixture(), [{ op: "set_brand", brand: { showLowerThird: true, displayName: "Sgt. Lima", credential: "Instrutor" } }]).project;
    const tarjas = (p: Project) => p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "component" && c.component === "executive_lower_third");
    // Um cartão no começo: a tarja vai para a primeira janela livre depois dele.
    const busy = applyOperations(named, [{ op: "add_component", component: "kinetic_pivot_card", start: 1, duration: 2.5, params: {} }]).project;
    const out = ensureLowerThird(busy);
    expect(tarjas(out.project)).toHaveLength(1);
    expect(tarjas(out.project)[0]!.start).toBe(3.5);
    expect(out.log[0]).toContain("Sgt. Lima");
    // Já tem tarja: nada muda.
    expect(ensureLowerThird(out.project).log).toEqual([]);
    expect(tarjas(ensureLowerThird(out.project).project)).toHaveLength(1);
    // Sem nome, ou com a tarja desligada: nunca cria.
    expect(ensureLowerThird(applyOperations(fixture(), [{ op: "set_brand", brand: { showLowerThird: true } }]).project).log).toEqual([]);
    expect(ensureLowerThird(applyOperations(fixture(), [{ op: "set_brand", brand: { displayName: "Sgt. Lima" } }]).project).log).toEqual([]);
  });

  it("o StyleReferenceProfile do YouTube entra no contexto do Diretor", () => {
    const profile = StyleReferenceProfileSchema.parse({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      videoId: "abcdefghijk",
      title: "Treino tático em 60 segundos",
      channel: "Canal X",
      durationSec: 62,
      pacing: { cutsPerMin: 28, wordsPerMin: 40, avgShotSec: 2.1, energy: "alta" },
      structure: [{ t: 0, title: "Gancho" }, { t: 12, title: "Execução" }],
      cutStyle: "Cortes na batida, com speed ramps.",
      palette: ["#0B6B73", "#FF8A3D"],
      typography: "Sem serifa condensada, caixa alta.",
      guidelines: ["Use câmera lenta nos impactos."],
    });
    const { project } = applyOperations(fixture(), [{ op: "set_style_reference", profile }]);
    const ctx = buildAgentContext(project);
    expect(ctx).toContain("## Referência de inspiração (YouTube");
    expect(ctx).toContain("~28 cortes/min");
    expect(ctx).toContain("#0B6B73, #FF8A3D");
    expect(ctx).toContain("- Use câmera lenta nos impactos.");
    expect(applyOperations(project, [{ op: "set_style_reference", profile: null }]).project.styleReference).toBeUndefined();
  });
});

describe("2. gênero, playbook de ação e crítico", () => {
  /** Cena de treino: 70 s, 9 palavras, muito movimento, picos em 12 s, 31 s e 52 s. */
  const actionAnalysis = (): AssetAnalysis => {
    const motion = Array.from({ length: 140 }, (_, i) => ({ t: i * 0.5, v: [12, 31, 52].some((p) => Math.abs(i * 0.5 - p) < 1.5) ? 0.9 : 0.25 }));
    return {
      genre: "action_cinematic",
      reason: "Quase sem fala (9 palavras em 70s) e a cena é visual.",
      motion,
      cuts: [20, 40],
      peaks: [{ t: 31, kind: "both", strength: 1 }, { t: 12, kind: "visual", strength: 0.9 }, { t: 52, kind: "audio", strength: 0.7 }],
      speech: [{ start: 3, end: 5 }],
      speechRatio: 0.03,
      motionLevel: 0.09,
    };
  };
  const actionVideo = () => {
    const words = ["atenção", "preparar", "vai", "limpo", "avança", "cobertura", "alvo", "neutralizado", "encerrado"].map((text, i) => ({ id: `w${i}`, text, start: 3 + i * 7, end: 3.5 + i * 7 }));
    const p = addAssetToProject(createProject({ name: "treino" }), { id: "a1", kind: "video", name: "treino.mp4", duration: 70, hasAudio: true, width: 1920, height: 1080, transcript: { words }, analysis: actionAnalysis() });
    return p;
  };

  it("classifica o material: 9 palavras em 70 s com movimento é ação, não talking-head", () => {
    expect(classifyGenre({ duration: 70, speechRatio: 0.05, wordCount: 9, motionLevel: 0.08, cutsPerMin: 3, hasPerson: true }).genre).toBe("action_cinematic");
    expect(classifyGenre({ duration: 70, speechRatio: 0.85, wordCount: 190, motionLevel: 0.02, cutsPerMin: 0, hasPerson: true }).genre).toBe("talking_head");
    expect(classifyGenre({ duration: 120, speechRatio: 0.7, wordCount: 300, motionLevel: 0.01, cutsPerMin: 0, hasPerson: false }).genre).toBe("tutorial_demo");
    expect(classifyGenre({ duration: 60, speechRatio: 0.5, wordCount: 110, motionLevel: 0.1, cutsPerMin: 14, hasPerson: true }).genre).toBe("vlog_montage");
    expect(skillForGenre("action_cinematic")).toBe("acao");
    expect(skillForGenre("talking_head")).toBe("viral");
  });

  it("extrai picos de energia visual e acústica e mudanças de plano, não só palavras", () => {
    const motion = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.5, v: i === 20 ? 0.95 : 0.1 }));
    const audio = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.1, db: i === 100 || i === 101 ? -8 : -50 }));
    const peaks = energyPeaks(motion, audio);
    // Movimento e transiente de áudio no mesmo instante (10 s) viram um pico só, "both".
    expect(peaks[0]).toMatchObject({ kind: "both" });
    expect(peaks[0]!.t).toBeCloseTo(10, 0);
    expect(detectCuts([{ t: 0, v: 0.02 }, { t: 0.5, v: 0.03 }, { t: 1, v: 0.6 }, { t: 1.5, v: 0.02 }, { t: 2, v: 0.03 }])).toEqual([1]);
    expect(actionRanges(motion)).toEqual([{ start: 9.75, end: 10.25 }]);
  });

  it("o contexto do agente traz o gênero, o playbook de ação e os picos ancoráveis por tempo do bruto", () => {
    const ctx = buildAgentContext(actionVideo());
    expect(projectGenre(actionVideo())).toBe("action_cinematic");
    expect(ctx).toContain("Gênero: action_cinematic");
    expect(ctx).toContain("NÃO corte pausas sem fala");
    expect(ctx).toContain("atSource 31 | visual+áudio | 1");
    expect(ctx).toContain("Alta atividade visual");
  });

  it("plano de edição de ação: speed ramps, LUT/vinheta, trilha e SFX sincronizados", () => {
    const skill = SKILLS.acao;
    // Parte determinística do modelo: cor, vinheta, letterbox, trilha com ducking. Nenhum corte de silêncio.
    const local = skillOperations(skill, actionVideo());
    expect(local.some((o) => o.op === "remove_silences")).toBe(false);
    const base = applyOperations(actionVideo(), local).project;
    expect(base.look).toMatchObject({ grade: "tactical_teal_orange", vignette: 0.55 });
    expect(base.look.letterbox).toBeGreaterThan(0);
    // Nenhum modelo liga a trilha da casa (loop sintético): fica desligada, com o ducking pronto.
    expect(base.music).toMatchObject({ mood: "none", duck: true });
    expect(base.captions.style).toMatchObject({ preset: "minimal_cinema", position: "bottom" });

    // O plano que o Editor executa, só com o vocabulário do agente (âncoras por tempo do bruto).
    const plan: OperationInput[] = [
      { op: "speed_ramp", atSource: 30, untilSource: 32.5, rate: 0.5 },
      { op: "speed_ramp", atSource: 14, untilSource: 20, rate: 1.8 },
      { op: "add_sfx", sfx: "impacto_cinematico", atSource: 31 },
      { op: "add_sfx", sfx: "whoosh_rapido", atSource: 14 },
      { op: "add_impact", atSource: 31, kind: "both" },
      { op: "add_zoom", atSource: 30, duration: 2, scale: 1.2, easing: "spring", ease: 0.3 },
      { op: "add_component", component: "tactical_hud_overlay", atSource: 40, duration: 6, params: { label: "TREINO" } },
    ];
    for (const op of plan) expect(AgentOperationSchema.safeParse(op).success).toBe(true);
    const { project } = applyOperations(base, plan);

    // Rampas: câmera lenta (0,5x segura) e aceleração, com entrada e saída em 1x.
    const ramps = media(project).filter(hasSpeed);
    expect(ramps).toHaveLength(2);
    const slow = ramps.find((c) => c.speedRamp!.some((p) => p.rate === 0.5))!;
    expect(slow.speedRamp![0]!.rate).toBe(1);
    expect(slow.speedRamp![slow.speedRamp!.length - 1]!.rate).toBe(1);
    expect(sourceSpan(slow)).toBeCloseTo(2.5, 2);
    expect(slow.duration).toBeGreaterThan(2.5 * 1.4);
    // A aceleração encurta; o total fecha: 70 − 6 + 6/k_rápido − 2,5 + 2,5/k_lento.
    const fast = ramps.find((c) => c !== slow)!;
    expect(fast.duration).toBeLessThan(6);
    expect(projectDuration(project)).toBeCloseTo(70 - 6 + fast.duration - 2.5 + slow.duration, 2);
    // Nenhum trecho do bruto se perdeu nem se repetiu.
    const clips = media(project);
    clips.forEach((c, i) => i > 0 && expect(c.sourceStart).toBeCloseTo(clips[i - 1]!.sourceStart + sourceSpan(clips[i - 1]!), 2));

    // SFX sincronizado: o pico cai no mesmo instante da timeline que o pico de ação (bruto 31 s), mesmo com as rampas.
    const peakAt = slow.start + localTimeAt(slow, 31);
    const sfx = project.tracks.flatMap((t) => t.clips).filter((c) => c.type === "sfx");
    expect(sfx.map((c) => c.type === "sfx" && c.sfx)).toEqual(expect.arrayContaining(["impacto_cinematico", "whoosh_rapido"]));
    expect(sfx.find((c) => c.type === "sfx" && c.sfx === "impacto_cinematico")!.start).toBeCloseTo(peakAt, 2);
    const impact = getTrack(project, "fx").clips.find((c) => c.type === "impact")!;
    expect(impact.start).toBeCloseTo(peakAt, 2);
    // Zoom sem x/y e sem sujeito medido não inventa rastreamento.
    const zoom = getTrack(project, "fx").clips.find((c) => c.type === "zoom")!;
    expect(zoom).toMatchObject({ easing: "spring", follow: false });

    // O Crítico aprova: tem rampa, cor, trilha, sons; e o auditor de ritmo conta as rampas como tratamento.
    expect(critiqueEdit(project, { skill }).filter((i) => i.severity === "erro")).toEqual([]);
    expect(timelineView(project)).toContain("rampa");
  });

  it("o Crítico reprova o que o sistema fazia antes: zooms aleatórios e cards soltos, sem rampa, cor nem som", () => {
    const { project } = applyOperations(actionVideo(), [
      { op: "add_zoom", start: 22.3, duration: 2, scale: 1.2, x: 0.5, y: 0.5 },
      { op: "add_zoom", start: 45.1, duration: 2, scale: 1.2, x: 0.5, y: 0.5 },
      { op: "add_component", component: "title_card", start: 10, duration: 3, params: { title: "Treino" } },
    ]);
    const codes = critiqueEdit(project, { skill: SKILLS.acao }).map((i) => i.code);
    expect(codes).toContain("zoom_sem_motivo");
    expect(codes).toContain("acao_sem_tratamento");
    // Falta de trilha de fundo não é defeito: nenhum modelo a inclui.
    expect(critiqueEdit(project, { skill: SKILLS.acao }).some((i) => /trilha de fundo/.test(i.message))).toBe(false);
  });

  it("o Crítico acusa texto na tela repetindo a fala", () => {
    const { project } = applyOperations(fixture(), [{ op: "add_component", component: "text_highlight", atWord: "w2", duration: 3, params: { text: "Hoje vamos falar de vendas" } }]);
    expect(critiqueEdit(project).map((i) => i.code)).toContain("texto_repete_fala");
    const ok = applyOperations(fixture(), [{ op: "add_component", component: "text_highlight", atWord: "w2", duration: 3, params: { text: "Oferta irresistível" } }]).project;
    expect(critiqueEdit(ok).map((i) => i.code)).not.toContain("texto_repete_fala");
  });

  it("velocidade: palavras, legendas e âncoras seguem a curva do clip", () => {
    const base = fixture();
    const { project } = applyOperations(base, [{ op: "set_speed", clipId: mainClips(base)[0]!.id, speed: 2 }]);
    expect(projectDuration(project)).toBeCloseTo(5, 3);
    expect(timelineWords(project).find((w) => w.id === "w2")!.start).toBeCloseTo(2, 3);
    const clip = mainClips(project)[0] as MediaClip;
    expect(sourceTimeAt(clip, 2)).toBeCloseTo(4, 3);
    expect(localTimeAt(clip, 4)).toBeCloseTo(2, 3);
    // Cortar por palavra continua exato num clip acelerado.
    const cut = applyOperations(project, [{ op: "cut_words", cuts: [{ from: "w0", to: "w1" }] }]).project;
    expect(timelineWords(cut).map((w) => w.id)).toEqual(["w2", "w3", "w4", "w5", "w6"]);
  });
});

describe("3. timeline NLE: movimentação livre, lacunas, inserção e ripple", () => {
  const two = () => {
    const p = blank(10);
    p.assets.b1 = { id: "b1", kind: "video", name: "outro.mp4", duration: 4, hasAudio: true };
    return applyOperations(p, [{ op: "split", time: 6 }]).project;
  };

  it("depois de dividir, um trecho pode ser arrastado para a direita criando uma lacuna", () => {
    const p = two();
    const [a, b] = media(p);
    const { project, log } = applyOperations(p, [{ op: "move_clip", clipId: b!.id, start: 9 }]);
    expect(log[0]).toContain("posição livre");
    expect(media(project).map((c) => [c.start, clipEnd(c)])).toEqual([[0, 6], [9, 13]]);
    expect(mainGaps(project)).toEqual([{ start: 6, end: 9 }]);
    expect(media(project)[0]!.id).toBe(a!.id);
    // Nada força a trilha a começar em t = 0: o primeiro clip também pode sair de lá.
    const shifted = applyOperations(project, [{ op: "move_clip", clipId: a!.id, start: 1.5 }]).project;
    expect(mainGaps(shifted)).toEqual([{ start: 0, end: 1.5 }, { start: 7.5, end: 9 }]);
    expect(ProjectSchema.safeParse(shifted).success).toBe(true);
  });

  it("zooms e textos que estavam sobre o clip vão junto quando ele é movido", () => {
    const p = applyOperations(two(), [{ op: "add_zoom", start: 7, duration: 2 }]).project;
    const b = media(p)[1]!;
    const { project } = applyOperations(p, [{ op: "move_clip", clipId: b.id, start: 10 }]);
    expect(getTrack(project, "fx").clips[0]!.start).toBe(11);
  });

  it("novo vídeo solto ENTRE dois clipes abre espaço (ripple) e não sobrescreve nada", () => {
    const p = two();
    // Solto em 5,6 s: sobre o fim do primeiro clip → o ponto de corte mais próximo é 6 s.
    const { project, log } = applyOperations(p, [{ op: "insert_clip", assetId: "b1", at: 5.6 }]);
    expect(log[0]).toContain("inserido entre clipes");
    const clips = media(project);
    expect(clips.map((c) => [c.assetId, c.start, clipEnd(c)])).toEqual([["a1", 0, 6], ["b1", 6, 10], ["a1", 10, 14]]);
    // Todo o conteúdo original continua lá, na mesma ordem.
    expect(clips.filter((c) => c.assetId === "a1").map((c) => [c.sourceStart, c.duration])).toEqual([[0, 6], [6, 4]]);
    expect(mainGaps(project)).toEqual([]);
  });

  it("solto numa lacuna, encaixa; se não couber, é aparado e avisa (ou empurra, em modo insert)", () => {
    const p = two();
    const gap = applyOperations(p, [{ op: "move_clip", clipId: media(p)[1]!.id, start: 9 }]).project; // lacuna 6–9
    const fits = applyOperations(gap, [{ op: "insert_clip", assetId: "b1", at: 6, duration: 2.5 }]);
    expect(fits.log[0]).toContain("encaixado na lacuna");
    expect(media(fits.project)[1]).toMatchObject({ assetId: "b1", start: 6, duration: 2.5 });
    const trimmed = applyOperations(gap, [{ op: "insert_clip", assetId: "b1", at: 6 }]);
    expect(trimmed.log[0]).toContain("ajustado à lacuna");
    expect(media(trimmed.project)[1]).toMatchObject({ assetId: "b1", start: 6, duration: 3 });
    expect(media(trimmed.project)[2]!.start).toBe(9);
    const pushed = applyOperations(gap, [{ op: "insert_clip", assetId: "b1", at: 6, mode: "insert" }]).project;
    expect(media(pushed)[1]).toMatchObject({ duration: 4 });
    expect(media(pushed)[2]!.start).toBe(10);
  });

  it("overwrite substitui o que está embaixo; trilha de cima (b-roll) não mexe no vídeo principal", () => {
    const p = two();
    const over = applyOperations(p, [{ op: "insert_clip", assetId: "b1", at: 4, mode: "overwrite" }]).project;
    expect(media(over).map((c) => [c.assetId, c.start, clipEnd(c)])).toEqual([["a1", 0, 4], ["b1", 4, 8], ["a1", 8, 10]]);
    expect(media(over)[2]!.sourceStart).toBe(8);
    const overlay = applyOperations(p, [{ op: "add_broll", assetId: "b1", start: 4, duration: 3 }]).project;
    expect(media(overlay)).toEqual(media(p));
    expect(projectDuration(overlay)).toBe(10);
  });

  it("mover um clip para cima de outro reordena com ripple, sem sobrescrever e sem deixar buraco", () => {
    const p = applyOperations(two(), [{ op: "split", time: 3 }]).project; // A 0–3, B 3–6, C 6–10
    const [a, b, c] = media(p);
    const { project } = applyOperations(p, [{ op: "move_clip", clipId: c!.id, start: 0.5 }]);
    expect(media(project).map((x) => [x.id, x.start, clipEnd(x)])).toEqual([[c!.id, 0, 4], [a!.id, 4, 7], [b!.id, 7, 10]]);
    expect(mainGaps(project)).toEqual([]);
  });

  it("ripple delete fecha o buraco; apagar sem ripple deixa a lacuna; cortar a lacuna a fecha", () => {
    const p = applyOperations(two(), [{ op: "split", time: 3 }]).project;
    const b = media(p)[1]!;
    const ripple = applyOperations(p, [{ op: "delete_clip", clipId: b.id }]).project;
    expect(media(ripple).map((c) => [c.start, clipEnd(c)])).toEqual([[0, 3], [3, 7]]);
    const lift = applyOperations(p, [{ op: "delete_clip", clipId: b.id, ripple: false }]).project;
    expect(mainGaps(lift)).toEqual([{ start: 3, end: 6 }]);
    expect(projectDuration(lift)).toBe(10);
    const closed = applyOperations(lift, [{ op: "remove_ranges", ranges: mainGaps(lift) }]).project;
    expect(mainGaps(closed)).toEqual([]);
    expect(projectDuration(closed)).toBe(7);
  });

  it("marcadores acompanham os cortes e são pontos de snapping", () => {
    const { project } = applyOperations(blank(10), [{ op: "add_marker", time: 8, label: "clímax" }, { op: "remove_ranges", ranges: [{ start: 2, end: 4 }] }]);
    expect(project.markers).toMatchObject([{ t: 6, label: "clímax" }]);
  });

  it("exporta em OpenTimelineIO com clips, lacunas, velocidade e marcadores", () => {
    const p = two();
    const { project } = applyOperations(p, [
      { op: "move_clip", clipId: media(p)[1]!.id, start: 8 },
      { op: "set_speed", clipId: media(p)[0]!.id, speed: 2 },
      { op: "add_marker", time: 1 },
      { op: "add_broll", assetId: "b1", start: 0, duration: 2 },
    ]);
    const otio = toOTIO(project) as { OTIO_SCHEMA: string; tracks: { markers: unknown[]; children: { name: string; kind: string; children: { OTIO_SCHEMA: string; effects?: { time_scalar: number }[]; source_range: { duration: { value: number; rate: number } } }[] }[] } };
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    expect(JSON.parse(JSON.stringify(otio))).toEqual(otio);
    const video = otio.tracks.children.find((t) => t.name === "Vídeo")!;
    expect(video.children.map((c) => c.OTIO_SCHEMA)).toEqual(["Clip.2", "Gap.1", "Clip.2"]);
    expect(video.children[0]!.effects![0]!.time_scalar).toBe(2);
    // O clip acelerado referencia os 6 s de origem; a lacuna vai de 3 s a 6 s da timeline (o resto recuou 3 s).
    expect(video.children[0]!.source_range.duration).toEqual({ OTIO_SCHEMA: "RationalTime.1", value: 180, rate: 30 });
    expect(video.children[1]!.source_range.duration.value).toBe(60);
    expect(otio.tracks.children.some((t) => t.kind === "Audio")).toBe(true);
    expect(otio.tracks.markers).toHaveLength(1);
  });
});

describe("4. remover silêncios: sílabas, respiração e cenas de ação preservadas", () => {
  const words = (spans: [number, number][]) => spans.map(([start, end]) => ({ start, end }));

  it("nunca corta pausa menor que 450 ms (respiração), em nenhum modo", () => {
    const w = words([[0, 1], [1.4, 2], [2.44, 3]]);
    expect(silencesFromWords(w, 3)).toEqual([]);
    expect(silencesFromWords(w, 3, { minSilence: 0.2 })).toEqual([]);
    expect(SILENCE_RULES.minPause).toBe(0.45);
  });

  it("mantém 150 ms antes e 220 ms depois de cada palavra: nenhuma sílaba decepada", () => {
    const [cut] = silencesFromWords(words([[0, 1], [3, 4]]), 4);
    expect(cut).toEqual({ start: 1.22, end: 2.85 });
    // Cada palavra continua inteira na timeline depois do corte.
    const { project } = applyOperations(fixture(), [{ op: "remove_silences", mode: "aggressive" }]);
    const src = fixture().assets.a1!.transcript!.words;
    for (const clip of mainClips(project))
      for (const w of src)
        if (w.start >= clip.sourceStart - 0.001 && w.start < clip.sourceStart + clip.duration) {
          expect(w.start - clip.sourceStart).toBeGreaterThanOrEqual(0);
          expect(clip.sourceStart + clip.duration - w.end).toBeGreaterThanOrEqual(SILENCE_RULES.postRoll - 0.001);
        }
    expect(timelineWords(project)).toHaveLength(7);
  });

  it("descarta ilhas de corte menores que 300 ms: sem 'metralhadora' de micro-cortes", () => {
    // Pausa de 0,6 s: tirando 220 + 150 ms de proteção sobram 230 ms de corte → descartado.
    expect(silencesFromWords(words([[0, 1], [1.6, 2.6]]), 2.6)).toEqual([]);
    // Palavra curta isolada entre duas pausas longas: o trecho mantido nunca fica menor que 300 ms.
    const cuts = silencesFromWords(words([[0, 1], [3, 3.05], [5, 6]]), 6, { preRoll: 0.15, postRoll: 0.22 });
    expect(cuts).toHaveLength(2);
    expect(cuts[1]!.start - cuts[0]!.end).toBeGreaterThanOrEqual(SILENCE_RULES.minIsland - 0.001);
    for (const c of cuts) expect(c.end - c.start).toBeGreaterThanOrEqual(SILENCE_RULES.minIsland - 0.001);
  });

  it("os três modos: agressivo (>0,45 s), ritmo natural (>0,8 s) e só pausas mortas (>1,5 s)", () => {
    const w = words([[0, 1], [1.7, 2.7], [3.7, 4.7], [6.7, 7.7]]); // pausas de 0,7 / 1,0 / 2,0 s
    expect(silencesFromWords(w, 7.7, { mode: "aggressive" })).toHaveLength(3);
    expect(silencesFromWords(w, 7.7, { mode: "natural" })).toHaveLength(2);
    expect(silencesFromWords(w, 7.7, { mode: "dead" })).toHaveLength(1);
  });

  it("limiar adaptativo: calibra pelo piso de ruído (P15) e pela voz (P85) do próprio arquivo", () => {
    const sr = 2000;
    // Gravação baixa, com ruído de fundo constante: um limiar fixo de −38 dBFS classificaria tudo como silêncio.
    const quiet = new Float32Array(sr * 6);
    for (let i = 0; i < quiet.length; i++) {
      const t = i / sr;
      const speaking = (t >= 0.5 && t < 2) || (t >= 3.5 && t < 5.5);
      quiet[i] = Math.sin(i * 0.9) * (speaking ? 0.008 : 0.0008);
    }
    const profile = speechProfile(quiet, sr);
    expect(profile.reliable).toBe(true);
    expect(profile.speechDb).toBeLessThan(-38);
    expect(profile.thresholdDb).toBeGreaterThan(profile.noiseFloorDb);
    expect(profile.thresholdDb).toBeLessThan(profile.speechDb);
    expect(profile.speech).toHaveLength(2);
    const cuts = silencesFromAudio(quiet, sr);
    // O silêncio inicial (0,5 s) sai até 150 ms antes da fala; a pausa do meio perde só o miolo;
    // a cauda (0,5 s − 220 ms = 280 ms) é um micro-corte e fica.
    expect(cuts).toHaveLength(2);
    expect(cuts[0]!.start).toBe(0);
    expect(cuts[0]!.end).toBeCloseTo(0.35, 1);
    expect(cuts[1]!.start).toBeCloseTo(2.22, 1);
    expect(cuts[1]!.end).toBeCloseTo(3.35, 1);
    // Áudio sem contraste (ruído contínuo): não dá para separar voz de silêncio → não corta nada, em vez de picotar tudo.
    const flat = Float32Array.from({ length: sr * 4 }, (_, i) => Math.sin(i * 0.7) * 0.05);
    expect(silencesFromAudio(flat, sr)).toEqual([]);
  });

  it("silêncio com alta atividade visual não é cortado; vídeo de ação não é cortado", () => {
    // Pausa de 2 s (1–3 s) com movimento forte entre 1,8 e 2,4 s.
    const protectedCuts = silencesFromWords(words([[0, 1], [3, 4]]), 4, { protect: [{ start: 1.8, end: 2.4 }] });
    expect(protectedCuts).toEqual([{ start: 1.22, end: 1.8 }, { start: 2.4, end: 2.85 }]);
    const p = fixture();
    p.assets.a1!.analysis = { genre: "talking_head", reason: "", motion: Array.from({ length: 20 }, (_, i) => ({ t: i * 0.5, v: i * 0.5 >= 2 && i * 0.5 <= 3.5 ? 0.9 : 0.05 })), cuts: [], peaks: [], speech: [], speechRatio: 0.6, motionLevel: 0.02 };
    const kept = applyOperations(p, [{ op: "remove_silences" }]).project;
    const never = applyOperations(p, [{ op: "remove_silences", preserveAction: "never" }]).project;
    expect(projectDuration(kept)).toBeGreaterThan(projectDuration(never));
    // Gênero de ação: a pausa é a cena.
    p.assets.a1!.analysis.genre = "action_cinematic";
    const action = applyOperations(p, [{ op: "remove_silences" }]);
    expect(projectDuration(action.project)).toBe(10);
    expect(action.log[0]).toContain("vídeo de ação");
  });

  it("micro-fade de 30 ms em toda fronteira de corte", () => {
    expect(CUT_FADE).toBe(0.03);
    expect(cutFadeGain(0, 2)).toBe(0);
    expect(cutFadeGain(0.015, 2)).toBeCloseTo(0.5, 5);
    expect(cutFadeGain(0.03, 2)).toBe(1);
    expect(cutFadeGain(1, 2)).toBe(1);
    expect(cutFadeGain(2 - 0.015, 2)).toBeCloseTo(0.5, 5);
    expect(cutFadeGain(2, 2)).toBe(0);
    // Clip mais curto que dois fades: um quarto da duração de cada lado, sem estourar.
    expect(cutFadeGain(0.02, 0.08)).toBe(1);
  });

  it("a voz ativa sai da transcrição ou, sem ela, do VAD: é o que comanda o ducking", () => {
    expect(voiceRanges(fixture())).toEqual([{ start: 1, end: 1.9 }, { start: 4, end: 6.4 }]);
    const p = blank(10);
    p.assets.a1!.analysis = { genre: "talking_head", reason: "", motion: [], cuts: [], peaks: [], speech: [{ start: 2, end: 5 }], speechRatio: 0.3, motionLevel: 0 };
    expect(voiceRanges(p)).toEqual([{ start: 2, end: 5 }]);
  });
});

describe("5. legendas e texto atrás da cabeça: guardrails espaciais", () => {
  const safe = { top: 0.13, right: 0.14, bottom: 0.21, left: 0.06 };
  const medium = { x: 0.3, y: 0.2, w: 0.4, h: 0.8, faceX: 0.5, faceY: 0.3, faceW: 0.2, faceH: 0.16 };
  const closeUp = { x: 0.05, y: 0.1, w: 0.9, h: 0.9, faceX: 0.5, faceY: 0.36, faceW: 0.6, faceH: 0.42 };

  it("a posição padrão é a base do quadro, dentro da zona segura (14–18% do fundo)", () => {
    expect(ProjectSchema.parse(createProject({ name: "x" })).captions.style.position).toBe("bottom");
    for (const ratio of ["9:16", "16:9"] as const) {
      const fromBottom = 1 - captionBaseY(ratio);
      expect(fromBottom).toBeGreaterThanOrEqual(0.14);
      expect(fromBottom).toBeLessThanOrEqual(0.18);
    }
    // Os três modelos prontos usam legenda na base.
    for (const id of TEMPLATE_SKILLS) {
      const caps = SKILLS[id].local.find((o) => o.op === "set_captions");
      expect(caps?.op === "set_captions" && caps.style?.position).toBe("bottom");
    }
  });

  it("a legenda some (com fade) enquanto um card ou texto cinético está na tela", () => {
    const { project } = applyOperations(fixture(), [
      { op: "add_component", component: "stat_counter", start: 4, duration: 2, params: { value: 30 } },
      { op: "add_component", component: "executive_lower_third", start: 7, duration: 2, params: { name: "Ana" } },
      { op: "set_brand", brand: { showLowerThird: true } },
    ]);
    // O card suprime; a tarja (discreta) convive com a legenda.
    const ranges = captionSuppression(project);
    expect(ranges).toEqual([{ start: 4, end: 6 }]);
    expect(captionAlpha(ranges, 5)).toBe(0);
    expect(captionAlpha(ranges, 3.9)).toBeCloseTo(0.5, 5);
    expect(captionAlpha(ranges, 6.1)).toBeCloseTo(0.5, 5);
    expect(captionAlpha(ranges, 3)).toBe(1);
    expect(captionAlpha(ranges, 7.5)).toBe(1);
  });

  it("colisão com o rosto: a legenda desvia para a margem segura livre e nunca fica na frente dele", () => {
    const base = { cx: 0.46, half: 0.03, width: 0.7, safeTop: 0.13, maxBottom: 0.9, busy: [] };
    const face = faceBox(medium);
    // Sem colisão: fica onde foi pedida.
    expect(placeCaption({ ...base, cy: 0.835, face })).toBe(0.835);
    // Legenda centralizada à mão sobre um rosto: sai de cima dele.
    const low = { x: 0.3, y: 0.42, w: 0.4, h: 0.2 };
    const y = placeCaption({ ...base, cy: 0.5, face: low });
    expect(y - base.half >= low.y + low.h || y + base.half <= low.y).toBe(true);
    // Rosto na parte de baixo do quadro (legenda padrão colidiria): sobe para a margem superior livre.
    const bottomFace = { x: 0.3, y: 0.7, w: 0.4, h: 0.25 };
    const up = placeCaption({ ...base, cy: 0.835, face: bottomFace });
    expect(up + base.half).toBeLessThanOrEqual(bottomFace.y);
    // E também desvia do texto de um componente.
    const busy = [{ x: 0.1, y: 0.78, w: 0.8, h: 0.1 }];
    const moved = placeCaption({ ...base, cy: 0.835, face, busy });
    expect(moved + base.half <= busy[0]!.y || moved - base.half >= busy[0]!.y + busy[0]!.h).toBe(true);
  });

  it("o rosto do detector vira a caixa do rosto, com folga para cabelo e queixo", () => {
    const d = { x: 0.3, y: 0.25, w: 0.4, h: 0.3 };
    const s = { x: 0, y: 0, w: 1, h: 1, ...faceFromDetection(d) };
    const f = faceBox(s);
    expect(f.x).toBeLessThan(d.x);
    expect(f.x + f.w).toBeGreaterThan(d.x + d.w);
    expect(f.y).toBeLessThan(d.y);
    expect(f.y + f.h).toBeGreaterThanOrEqual(d.y + d.h - 1e-3);
    expect(isCloseUp(s)).toBe(true);
  });

  it("a resposta da IA não apaga a análise do vídeo que chegou durante o pedido", () => {
    const sent = fixture();
    const id = Object.keys(sent.assets)[0]!;
    // Enquanto a IA editava, o navegador mediu o vídeo e reenquadrou as faixas pretas.
    const current = structuredClone(sent);
    current.assets[id]!.subject = [{ t: 0, x: 0.3, y: 0.1, w: 0.4, h: 0.9, faceX: 0.5, faceY: 0.3 }];
    current.framing = { x: 0.42, y: 0.5 };
    // A IA devolve o projeto de quando o pedido saiu, com a edição dela.
    const incoming = applyOperations(sent, [{ op: "add_marker", time: 1 }]).project;
    const merged = keepLocalMeasurements(incoming, current, sent);
    expect(merged.assets[id]!.subject).toEqual(current.assets[id]!.subject);
    expect(merged.framing).toEqual({ x: 0.42, y: 0.5 });
    expect(merged.markers).toEqual(incoming.markers);
    // Se a IA mudou o enquadramento, vale o dela.
    const moved = applyOperations(sent, [{ op: "set_format", framing: { x: 0.2 } }]).project;
    expect(keepLocalMeasurements(moved, current, sent).framing.x).toBe(0.2);
  });

  it("bloco de texto sai do rosto pelo menor caminho e fica dentro da área segura", () => {
    const bounds = { x: 0.05, y: 0.08, w: 0.9, h: 0.8 };
    const f = { x: 0.27, y: 0.14, w: 0.46, h: 0.33 };
    const list = { x: 0.55, y: 0.45, w: 0.38, h: 0.12 };
    const n = avoidFaces(list, [f], bounds, 0.01);
    const moved = { x: list.x + n.dx, y: list.y + n.dy, w: list.w, h: list.h };
    expect(moved.y).toBeGreaterThanOrEqual(f.y + f.h);
    expect(moved.y + moved.h).toBeLessThanOrEqual(bounds.y + bounds.h + 1e-9);
    // Sem colisão: não mexe.
    expect(avoidFaces({ ...list, y: 0.7 }, [f], bounds, 0.01)).toEqual({ dx: 0, dy: 0, scale: 1 });
  });

  it("o título gigante atrás da cabeça é recusado em close-up, com o porquê; em plano aberto passa", () => {
    const withSubject = (s: typeof medium) => {
      const p = fixture();
      const asset = Object.values(p.assets)[0]!;
      asset.width = 1080;
      asset.height = 1920;
      asset.subject = [{ t: 0, ...s }, { t: 10, ...s }];
      return applyOperations(p, [{ op: "set_format", aspectRatio: "9:16" }, { op: "add_component", component: "depth_hook_title", start: 0, duration: 2.5, params: { title: "Taser" } }]).project;
    };
    const tight = framingObjections(withSubject({ ...medium, faceW: 0.46, faceH: 0.3 }));
    expect(tight).toHaveLength(1);
    expect(tight[0]!.message).toContain("close-up");
    expect(framingObjections(withSubject(medium))).toEqual([]);
    expect(critiqueEdit(withSubject({ ...medium, faceW: 0.46, faceH: 0.3 })).some((i) => i.code === "sem_espaco_no_quadro")).toBe(true);
  });

  it("texto atrás da cabeça: em close-up (> 35% da altura) ou rosto cortado, vira cartão na área livre", () => {
    expect(isCloseUp(medium)).toBe(false);
    expect(isCloseUp(closeUp)).toBe(true);
    // Rosto cortado na borda de cima também conta.
    expect(isCloseUp({ ...medium, y: 0, faceY: 0.06 })).toBe(true);
    // Rosto largo (gravação de celular reenquadrada) também é close-up, mesmo sem passar de 35% da altura.
    expect(isCloseUp({ ...medium, faceW: 0.45, faceH: 0.3 })).toBe(true);
    expect(depthPlacement(medium, true, safe)).toEqual({ mode: "behind" });
    const placed = depthPlacement(closeUp, true, safe);
    expect(placed.mode).toBe("card");
    if (placed.mode === "card") {
      expect(placed.reason).toBe("close_up");
      // A área escolhida fica inteira fora da caixa do rosto e dentro das margens seguras.
      const f = faceBox(closeUp);
      const a = placed.area;
      const overlap = a.x < f.x + f.w && a.x + a.w > f.x && a.y < f.y + f.h && a.y + a.h > f.y;
      expect(overlap).toBe(false);
      expect(a.y).toBeGreaterThanOrEqual(safe.top - 1e-9);
      expect(a.y + a.h).toBeLessThanOrEqual(1 - safe.bottom + 1e-9);
      expect(a.w * a.h).toBeGreaterThan(0.03);
    }
    // Sem recorte da pessoa não há "atrás": também vira cartão.
    expect(depthPlacement(medium, false, safe).mode).toBe("card");
    expect(buildAgentContext((() => {
      const p = fixture();
      Object.assign(p.assets.a1!, { width: 1080, height: 1920, subject: [{ t: 2, ...closeUp }] });
      return p;
    })())).toContain("CLOSE-UP");
  });
});

describe("6. motion generativo e os 3 modelos prontos", () => {
  const spec = {
    anchor: "bottom" as const,
    root: {
      type: "group" as const,
      layout: "column" as const,
      children: [
        { type: "badge" as const, text: "Regra 80/20" },
        { type: "text" as const, text: "Poucos clientes, *quase todo* o lucro", size: 68, role: "title" as const, anim: [{ prop: "opacity" as const, from: 0, to: 1, duration: 0.4 }] },
        { type: "line" as const, x2: 400, y2: 0, anim: [{ prop: "draw" as const, from: 0, to: 1, at: 0.4, duration: 0.6, ease: "spring" as const }] },
      ],
    },
  };

  it("custom_motion_graphic: a árvore declarativa da IA é validada por schema, com limites", () => {
    const parsed = MotionGraphicSchema.safeParse(spec);
    expect(parsed.success).toBe(true);
    // Defaults preenchidos; nada de campos desconhecidos virando código.
    expect(parsed.data!.root).toMatchObject({ gap: 16, align: "center" });
    expect(MotionGraphicSchema.safeParse({ root: { type: "script", src: "x" } }).success).toBe(false);
    expect(MotionGraphicSchema.safeParse({ root: { type: "path", d: "M0 0 L10 10; alert(1)", w: 10, h: 10 } }).success).toBe(false);
    // Profundidade máxima de 4 níveis.
    const deep = (n: number): unknown => (n === 0 ? { type: "rect", w: 10, h: 10 } : { type: "group", children: [deep(n - 1)] });
    expect(MotionGraphicSchema.safeParse({ root: deep(3) }).success).toBe(true);
    expect(MotionGraphicSchema.safeParse({ root: deep(4) }).success).toBe(false);
  });

  it("direção de arte: título ≥ 64 px no 9:16, pausa final limpa, sem clichê de IA", () => {
    const ok = MotionGraphicSchema.parse(spec);
    expect(checkArtDirection(ok, { vertical: true, duration: 4 })).toEqual([]);
    const small = MotionGraphicSchema.parse({ root: { type: "text", text: "Título pequeno", size: 40, role: "title" } });
    expect(checkArtDirection(small, { vertical: true }).map((i) => i.code)).toEqual(["titulo_pequeno"]);
    expect(checkArtDirection(small, { vertical: false })).toEqual([]);
    // Animação que só termina em cima da saída: falta a pausa final.
    expect(checkArtDirection(ok, { vertical: true, duration: 1.6 }).map((i) => i.code)).toEqual(["sem_pausa_final"]);
    const cliche = MotionGraphicSchema.parse({ root: { type: "group", fill: { from: "#8B5CF6", to: "#3B82F6" }, children: [{ type: "text", text: "Decole 🚀", size: 80 }] } });
    expect(checkArtDirection(cliche, { vertical: true }).map((i) => i.code)).toEqual(["cliche", "cliche"]);
  });

  it("os 3 modelos prontos são arquiteturas distintas: legenda, cor, trilha, ritmo e cards próprios", () => {
    expect(TEMPLATE_SKILLS).toEqual(["viral", "acao", "autoridade"]);
    expect(SKILLS.viral.name).toBe("Retenção Viral & Creator Pro");
    expect(SKILLS.acao.name).toBe("Ação & Cinematográfico");
    expect(SKILLS.autoridade.name).toBe("Autoridade & Documentário Moderno");
    const recipes = TEMPLATE_SKILLS.map((id) => SKILLS[id].recipe);
    for (const key of ["captions", "look"] as const) expect(new Set(recipes.map((r) => r[key])).size).toBe(3);
    for (const r of recipes) expect(r.music).toBe("none");
    expect(new Set(TEMPLATE_SKILLS.map((id) => SKILLS[id].brand.fontPair)).size).toBe(3);
    expect(new Set(TEMPLATE_SKILLS.map((id) => SKILLS[id].brand.primaryColor)).size).toBe(3);

    expect(SKILLS.viral.recipe).toMatchObject({ captions: "viral_pop", cutZoom: true, speedRamps: false });
    expect(SKILLS.viral.recipe.sfx).toEqual(expect.arrayContaining(["pop", "whoosh_rapido", "riser"]));
    expect(SKILLS.viral.direction).toContain("2 s");

    expect(SKILLS.acao.recipe).toMatchObject({ captions: "minimal_cinema", speedRamps: true, music: "none" });
    expect(SKILLS.acao.recipe.sfx).toEqual(expect.arrayContaining(["impacto_cinematico", "sub_drop"]));
    expect(SKILLS.acao.recipe.cards).toContain("tactical_hud_overlay");
    expect(SKILLS.acao.local.some((o) => o.op === "remove_silences")).toBe(false);

    expect(SKILLS.autoridade.recipe).toMatchObject({ captions: "editorial_clean", look: "warm_cinematic", music: "none" });
    expect(SKILLS.autoridade.recipe.cards).toEqual(expect.arrayContaining(["stat_counter_card", "comparison_split"]));
    // A tarja de cargo é opcional e fica desligada: nenhum modelo a liga sozinho.
    for (const id of TEMPLATE_SKILLS) expect(JSON.stringify(SKILLS[id].local)).not.toContain("showLowerThird");
  });

  it("aplicar um modelo: acabamento determinístico válido, marca do usuário preservada, formato respeitado", () => {
    for (const id of TEMPLATE_SKILLS) {
      const ops = skillOperations(SKILLS[id], fixture());
      const { project } = applyOperations(fixture(), ops);
      expect(project.captions.style.preset).toBe(SKILLS[id].recipe.captions);
      expect(project.look.grade).toBe(SKILLS[id].recipe.look);
      expect(project.music).toMatchObject({ mood: SKILLS[id].recipe.music, duck: true });
      expect(project.brand.fontPair).toBe(SKILLS[id].brand.fontPair);
      expect(project.brand.showLowerThird).toBe(false);
      expect(skillPrompt(SKILLS[id])).toContain(SKILLS[id].name);
    }
    // Quem já tem Brand Kit próprio não tem as cores trocadas pelo modelo.
    const branded = applyOperations(fixture(), [{ op: "set_brand", brand: { primaryColor: "#00FF88" } }]).project;
    expect(applyOperations(branded, skillOperations(SKILLS.acao, branded)).project.brand.primaryColor).toBe("#00FF88");
    // No vertical o letterbox do modelo de ação é contido.
    expect(applyOperations(fixture(), skillOperations(SKILLS.acao, fixture())).project.look.letterbox).toBeLessThanOrEqual(0.05);
    // Vídeo sem fala: nada de limpeza de fala nem legenda.
    const silent = skillOperations(SKILLS.viral, blank(10)).map((o) => o.op);
    expect(silent).not.toContain("remove_silences");
    expect(silent).not.toContain("set_captions");
  });

  it("os modelos prontos também existem como EditTemplate, com a receita completa", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.data.name)).toEqual(["Retenção Viral & Creator Pro", "Ação & Cinematográfico", "Autoridade & Documentário Moderno"]);
    for (const t of BUILTIN_TEMPLATES) {
      expect(EditTemplateSchema.safeParse(t.data).success).toBe(true);
      expect(templateOperations(t.data, fixture())).toEqual(skillOperations(SKILLS[t.skill], fixture()));
      expect(templatePrompt(t.data)).toContain(t.data.name);
    }
    const action = BUILTIN_TEMPLATES[1]!.data;
    expect(action).toMatchObject({ speedRamps: true, music: "none", silence: { remove: false } });
    expect(templatePrompt(action)).toContain("Rampas de velocidade");
  });
});

describe("takes ruins com transcrições reais (Groq Whisper)", () => {
  // Formato "palavra[início-fim]", copiado da saída do serviço de transcrição.
  const real = (s: string) =>
    findRetakes(
      s
        .trim()
        .split(/\s+/)
        .map((tok, i) => {
          const m = /^(.*)\[(.*)-(.*)\]$/.exec(tok)!;
          return { id: `w${i}`, text: m[1]!, start: Number(m[2]), end: Number(m[3]), clipId: "c", assetId: "a" };
        }),
    );

  it("aviso de erro seguido de recomeço é erro certo, mesmo com o take truncado virando outra palavra", () => {
    const r = real(
      "Eu[0.00-0.16] vou[0.16-0.38] mostrar[0.38-0.84] como[0.84-1.24] abre.[1.24-1.80] Aprender[1.92-2.54] inglês[2.54-3.02] rápido.[3.02-3.78] Não,[3.96-4.60] pera,[4.60-5.10] errei.[5.10-5.64] Eu[5.86-6.06] vou[6.06-6.32] mostrar[6.32-6.76] como[6.76-7.14] aprender[7.14-7.64] inglês[7.64-8.28] em[8.28-8.52] 30[8.52-8.88] dias.[8.88-9.32]",
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "marker", confidence: "alta", from: "w0", to: "w10" });
    expect(r[0]!.keepText).toBe("Eu vou mostrar como aprender inglês");
  });

  it("autocorreção nunca é corte automático e o corte sugerido mantém a informação corrigida", () => {
    const r = real(
      "Hoje[0.0-0.3] eu[0.3-0.4] vou[0.4-0.6] te[0.6-0.7] ensinar[0.7-1.2] três[1.2-1.5] formas[1.5-1.9] de[1.9-2.0] ganhar,[2.0-2.5] quer[3.4-3.6] dizer,[3.6-3.9] na[3.9-4.0] verdade[4.0-4.4] são[4.4-4.6] quatro[4.6-5.0] formas[5.0-5.4] de[5.4-5.5] ganhar[5.5-5.9] dinheiro[5.9-6.4] com[6.4-6.6] vídeo.[6.6-7.1]",
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "correction", confidence: "media", cutText: "três formas de ganhar, quer dizer, na verdade são" });
    expect(r[0]!.keepText).toMatch(/^quatro formas de ganhar dinheiro/);
  });

  it("frase recomeçada logo em seguida continua sendo corte certo", () => {
    const r = real(
      "Então,[0.00-0.56] o[0.56-0.86] segredo[0.86-1.52] do[1.52-1.68] sucesso,[1.68-2.34] o[2.34-2.56] segredo[2.56-3.10] do[3.10-3.28] sucesso[3.28-3.70] é[3.70-3.96] consistência.[3.96-5.44]",
    );
    expect(r[0]).toMatchObject({ kind: "restart", confidence: "alta", cutText: "o segredo do sucesso," });
  });
});

describe("muletas", () => {
  const words = (s: string) =>
    s.split(" ").map((text, i) => ({ id: `w${i}`, text, start: i * 0.4, end: i * 0.4 + 0.3, clipId: "c", assetId: "a" }));
  const cut = (s: string, level: "hesitations" | "all" = "all") => fillersFor(words(s), level).map((f) => f.text);

  it("hesitações saem sempre; 'é' verbo fica", () => {
    expect(cut("Hum, eu acho que é... é, é importante, ahn, medir. Isso é fácil.")).toEqual(["Hum,", "é...", "é,", "ahn,"]);
  });

  it("'tipo' e 'né' soltos saem; com função na frase ficam", () => {
    expect(cut("a gente precisa, tipo, vender mais, né? Esse tipo de produto vende. Faça assim todo dia.")).toEqual(["tipo,", "né?"]);
  });

  it("no nível 'hesitations' as palavras de apoio ficam", () => {
    expect(cut("Hum, a gente precisa, tipo, vender mais, né?", "hesitations")).toEqual(["Hum,"]);
  });

  it("remove_fillers corta da timeline", () => {
    const w = words("Hum, a gente precisa, tipo, vender mais.").map(({ clipId: _c, assetId: _a, ...x }) => x);
    const p = addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "v.mp4", duration: 4, hasAudio: true, transcript: { words: w } });
    const { project } = applyOperations(p, [{ op: "remove_fillers" }]);
    expect(timelineWords(project).map((x) => x.text).join(" ")).toBe("a gente precisa, vender mais.");
  });
});

describe("revisão de legenda", () => {
  const project = () => {
    const words = [
      { id: "w0", text: "Oi,", start: 0, end: 0.3, confidence: 0.9 },
      { id: "w1", text: "Primo", start: 0.4, end: 0.7, confidence: 0.4 },
      { id: "w2", text: "Hico.", start: 0.7, end: 1, confidence: 0.4 },
    ];
    return addAssetToProject(createProject({ name: "t" }), { id: "a1", kind: "video", name: "v.mp4", duration: 2, hasAudio: true, transcript: { words } });
  };

  it("palavra de baixa confiança vai para a revisão até ser conferida ou corrigida", () => {
    expect(wordsToReview(project()).map((w) => w.id)).toEqual(["w1", "w2"]);
    const confirmed = applyOperations(project(), [{ op: "review_words", wordIds: ["w1"] }]).project;
    expect(wordsToReview(confirmed).map((w) => w.id)).toEqual(["w2"]);
    const fixed = applyOperations(project(), [{ op: "edit_caption", wordIds: ["w1", "w2"], text: "Primo Rico." }]).project;
    expect(wordsToReview(fixed)).toEqual([]);
  });
});

describe("nível do pedido (regra local)", () => {
  it.each([
    ["edita tudo pra mim", "full"],
    ["quero esse vídeo no estilo do Primo Rico", "full"],
    ["Revise os erros de gravação e corte os takes ruins", "sweep"],
    ["Aplique zoom nos momentos de ênfase", "sweep"],
    ["muda a cor da legenda para amarelo", "adjust"],
    ["tira o zoom do 0:12", "adjust"],
  ] as const)("%s → %s", (message, tier) => {
    expect(agentTier(message, false)).toBe(tier);
  });

  it("passada no vídeo todo custa entre o ajuste e a edição completa", () => {
    const at = (tier: "full" | "sweep" | "adjust") => creditCost({ type: "agent", tier, durationSec: 60 });
    expect(at("adjust")).toBeLessThan(at("sweep"));
    expect(at("sweep")).toBeLessThan(at("full"));
  });
});

describe("repetição natural não é erro de gravação (vídeo real, fala fluente)", () => {
  const take = (text: string) =>
    findRetakes(text.split(" ").map((t, i) => ({ id: `w${i}`, text: t, start: i * 0.3, end: i * 0.3 + 0.25, clipId: "c", assetId: "a" })));

  it.each([
    "estão causando problemas para a guarnição, evitando que a guarnição entre em confronto físico direto.",
    "Aquele indivíduo em surto psicótico, aquele indivíduo agressor, aquele indivíduo que recusa a obediência",
    "indivíduos que estão causando distúrbios e estão causando problemas para a guarnição",
    "jamais poderá ser utilizada em manifestações públicas e não deve ser utilizada quando há risco à vida",
  ])("%s", (text) => {
    expect(take(text).filter((r) => r.confidence === "alta")).toEqual([]);
  });
});

describe("muletas: o numeral fica", () => {
  it("'um' é palavra (número um, um produto); só 'uum'/'hum' é hesitação", () => {
    const words = ["três", "momentos", "são", "número", "um,", "utilização", "uum", "de", "um", "produto", "hum"].map((text, i) => ({ id: `w${i}`, text, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const p = addAssetToProject(createProject({ name: "f" }), { id: "a1", kind: "video", name: "v.mp4", duration: 10, hasAudio: true, transcript: { words } });
    const cut = findFillers(timelineWords(p)).map((f) => f.text);
    expect(cut).toContain("uum");
    expect(cut).toContain("hum");
    expect(cut).not.toContain("um,");
    expect(cut).not.toContain("um");
  });
});

describe("hesitações escondidas pela transcrição (equilíbrio: na dúvida, não corta)", () => {
  // Ritmo de ~0,17 s por sílaba, como no vídeo de teste.
  const normal = ["As", "armas", "de", "choque", "são", "utilizadas", "em", "momentos", "muito", "específicos", "durante", "o", "patrulhamento", "ostensivo"].map((text, i) => ({ id: `n${i}`, text, start: i, end: i + syllables(text) * 0.17 }));
  const rate = speechRate(normal);
  // Envelope (dB, quadros de 20 ms): voz = -20, silêncio = -60.
  const env = (parts: [number, number][]) => parts.flatMap(([db, sec]) => Array(Math.round(sec / 0.02)).fill(db) as number[]);

  it("mede o ritmo da pessoa e só olha palavras muito mais longas que ele", () => {
    expect(rate).toBeGreaterThan(0.14);
    expect(rate).toBeLessThan(0.2);
    expect(stretchedWords(normal, rate)).toEqual([]);
    const long = { id: "x", text: "incapacitação", start: 8.4, end: 10.64 };
    expect(stretchedWords([long], rate)).toHaveLength(1);
  });

  it("engasgo de verdade (tentativa de 0,7 s, pausa, palavra inteira): corta só a tentativa", () => {
    const w = { id: "x", text: "incapacitação", start: 8.4, end: 10.64 };
    const cut = falseStart(w, env([[-20, 0.7], [-60, 0.24], [-20, 1.3]]), rate)!;
    expect(cut.start).toBe(8.4);
    expect(cut.end).toBeGreaterThan(9.2);
    expect(cut.end).toBeLessThan(9.4);
    const [mark, kept] = splitFalseStart(w, cut);
    expect(mark!.disfluency).toBe("false_start");
    expect(kept!.text).toBe("incapacitação");
  });

  it("NÃO corta: fim da palavra anterior + respiro, palavra curta + pausa, palavra lenta sem pausa", () => {
    // "causando | distúrbios": 0,16 s do "-do" mal alinhado, respiro, a palavra.
    expect(falseStart({ id: "a", text: "distúrbios", start: 27.24, end: 28.6 }, env([[-20, 0.16], [-60, 0.22], [-20, 0.98]]), rate)).toBeNull();
    // "em [pausa] confronto": palavra curta, a pausa é o respiro antes da próxima.
    expect(falseStart({ id: "b", text: "em", start: 37.92, end: 38.9 }, env([[-20, 0.2], [-60, 0.6], [-20, 0.18]]), rate)).toBeNull();
    // Palavra dita devagar, de uma vez (sem silêncio no meio).
    expect(falseStart({ id: "c", text: "patrulhamento", start: 0, end: 2.6 }, env([[-20, 2.6]]), rate)).toBeNull();
    // Palavra no ritmo normal nunca é analisada.
    expect(falseStart({ id: "d", text: "incapacitação", start: 0, end: 1.1 }, env([[-20, 0.4], [-60, 0.2], [-20, 0.5]]), rate)).toBeNull();
  });

  it("segunda escuta: o 'hum' e o 'é' alongado viram hesitação; o 'e' conjunção e palavras inventadas ficam", () => {
    const estao = { id: "w1", text: "estão", start: 29.14, end: 31.84 };
    const split = splitHesitations(estao, [{ text: "E,", start: 0, end: 0.24 }, { text: "hum,", start: 0.24, end: 2.48 }, { text: "estão", start: 2.48, end: 3.02 }], 28.91);
    expect(split.map((w) => w.disfluency ?? w.text)).toEqual(["hesitation", "estão"]);
    expect(split[1]!.start).toBeCloseTo(31.39, 2);
    const guarnicao = { id: "w2", text: "guarnição,", start: 33.82, end: 35.86 };
    const g = splitHesitations(guarnicao, [{ text: "guarnição,", start: 0.14, end: 1.02 }, { text: "é,", start: 1.02, end: 1.94 }], 33.57);
    expect(g.map((w) => w.disfluency ?? w.text)).toEqual(["guarnição,", "hesitation"]);
    // "E não deve": o "e" reouvido é a própria palavra.
    const e = { id: "w3", text: "e", start: 47.64, end: 48.42 };
    expect(splitHesitations(e, [{ text: "E", start: 0, end: 0.6 }, { text: "não", start: 0.6, end: 1.2 }], 47.39)).toEqual([e]);
    // Um "é" curto é o verbo, não hesitação; frases inventadas pelo transcritor não contam.
    expect(isHesitationToken("é", 0.15)).toBe(false);
    expect(isHesitationToken("é", 0.6)).toBe(true);
    expect(splitHesitations(estao, [{ text: "vou", start: 0.3, end: 1.5 }, { text: "fazer", start: 1.5, end: 2.4 }], 28.91)).toEqual([estao]);
  });

  it("'É,' alongado e solto entre frases sai; o verbo 'é' dentro da frase fica", () => {
    const mk = (list: [string, number, number][]) => addAssetToProject(createProject({ name: "e" }), { id: "a1", kind: "video", name: "v.mp4", duration: 10, hasAudio: true, transcript: { words: list.map(([text, start, end], i) => ({ id: `w${i}`, text, start, end })) } });
    const solto = findFillers(timelineWords(mk([["guarnição.", 0, 0.5], ["É,", 1.2, 1.7], ["evitando", 2, 2.5]])));
    expect(solto.map((f) => f.text)).toEqual(["É,"]);
    const verbo = findFillers(timelineWords(mk([["Esse", 0, 0.3], ["é,", 0.3, 0.8], ["sem", 0.9, 1.1], ["dúvida", 1.1, 1.5]])));
    expect(verbo).toEqual([]);
    const curto = findFillers(timelineWords(mk([["Pronto.", 0, 0.5], ["É,", 1, 1.15], ["assim", 1.2, 1.5]])));
    expect(curto.filter((f) => f.text === "É,")).toEqual([]);
  });

  it("a limpeza corta o que foi marcado, como hesitação de confiança alta", () => {
    const words = [{ id: "a", text: "e", start: 0, end: 0.2 }, { id: "b", text: "…", start: 0.2, end: 2, disfluency: "hesitation" as const }, { id: "c", text: "estão", start: 2, end: 2.4 }];
    const p = addAssetToProject(createProject({ name: "d" }), { id: "a1", kind: "video", name: "v.mp4", duration: 3, hasAudio: true, transcript: { words } });
    expect(findFillers(timelineWords(p)).map((f) => [f.from, f.confidence])).toEqual([["b", "alta"]]);
  });
});

describe("economia: lucro real depois de taxas, impostos e despesas", () => {
  it("a margem líquida no pior caso fica acima de 35%", () => {
    expect(MIN_NET_MARGIN).toBeGreaterThanOrEqual(0.35);
  });

  it("todo plano pago e todo pacote rende pelo menos a receita por crédito usada no teto", () => {
    const floor = minRevenuePerCreditBRL();
    for (const plan of Object.values(PLANS)) if (plan.priceBRL > 0) expect(plan.priceBRL / plan.monthlyCredits).toBeGreaterThanOrEqual(floor);
    for (const t of TOPUPS) expect(t.priceBRL / t.credits).toBeGreaterThanOrEqual(floor);
  });

  it("o teto de custo de cada ação cobre o custo medido (a IA não é interrompida no caso comum)", () => {
    const at = (tier: "full" | "sweep" | "adjust") => aiBudgetUSD(creditCost({ type: "agent", tier, durationSec: 60 }));
    expect(at("full")).toBeGreaterThanOrEqual(MEASURED_AI_COST_USD.fullEditShort);
    expect(at("sweep")).toBeGreaterThanOrEqual(MEASURED_AI_COST_USD.sweepShort);
    expect(at("adjust")).toBeGreaterThanOrEqual(MEASURED_AI_COST_USD.adjust);
    // Mídia gerada por IA: o preço em créditos cobre o custo do Gemini com a mesma margem.
    expect(aiBudgetUSD(creditCost({ type: "generative_image", images: 1 }))).toBeGreaterThanOrEqual(MEASURED_AI_COST_USD.image);
    expect(aiBudgetUSD(creditCost({ type: "generative", clips: 1 }))).toBeGreaterThanOrEqual(MEASURED_AI_COST_USD.videoClip5s);
  });

  it("o Diretor cabe na metade do teto da edição completa (o maior gasto medido dele foi US$ 0,087)", () => {
    expect(aiBudgetUSD(creditCost({ type: "agent", tier: "full", durationSec: 60 })) * 0.5).toBeGreaterThanOrEqual(0.1);
  });

  it("os créditos grátis cobrem uma edição completa de um vídeo do tamanho máximo do Free", () => {
    const sec = PLANS.free.maxUploadMinutes * 60;
    expect(SIGNUP_CREDITS).toBeGreaterThanOrEqual(creditCost({ type: "ingest", durationSec: sec }) + creditCost({ type: "agent", tier: "full", durationSec: sec }));
  });
});

import { snapWordOnsets } from "./onsets";

describe("fronteiras de palavra conferidas no áudio (cortes sem comer consoante)", () => {
  const RATE = 16000;
  /** Voz sintética: tom nos trechos indicados, ruído baixo no resto. */
  const audio = (total: number, voiced: [number, number][]) => {
    const s = new Float32Array(Math.round(total * RATE));
    let seed = 7;
    for (let i = 0; i < s.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const t = i / RATE;
      const on = voiced.some(([a, b]) => t >= a && t < b);
      s[i] = (seed / 2147483648 - 1) * 0.002 + (on ? Math.sin(2 * Math.PI * 180 * t) * 0.3 : 0);
    }
    return s;
  };
  const word = (id: string, start: number, end: number) => ({ id, text: id, start, end });

  it("com pausa antes: o início recua até onde a voz começa, sem invadir a palavra anterior", () => {
    // A voz de "b" começa em 0,80 s; o transcritor disse 0,88 s.
    const samples = audio(2, [[0, 0.5], [0.8, 1.4], [1.7, 2]]);
    const out = snapWordOnsets([word("a", 0, 0.5), word("b", 0.88, 1.4), word("c", 1.7, 2)], samples, RATE);
    expect(out[1]!.start).toBeGreaterThan(0.74);
    expect(out[1]!.start).toBeLessThanOrEqual(0.8);
    expect(out[0]!.end).toBe(0.5);
    // Início já em silêncio (folga de sobra) fica como veio.
    const early = snapWordOnsets([word("a", 0, 0.5), word("b", 0.7, 1.4), word("c", 1.7, 2)], samples, RATE);
    expect(early[1]!.start).toBe(0.7);
  });

  it("palavras coladas: a fronteira vai para o vale de energia; fala contínua não muda", () => {
    // Micro-pausa real entre 0,50 e 0,54 s; o transcritor pôs a fronteira em 0,60 s.
    const samples = audio(2, [[0, 0.5], [0.54, 1.2], [1.6, 2]]);
    const out = snapWordOnsets([word("a", 0, 0.6), word("b", 0.6, 1.2), word("c", 1.6, 2)], samples, RATE);
    expect(out[1]!.start).toBeGreaterThan(0.5);
    expect(out[1]!.start).toBeLessThanOrEqual(0.54);
    expect(out[0]!.end).toBe(out[1]!.start);
    const flat = audio(2, [[0, 1.2], [1.6, 2]]);
    const same = snapWordOnsets([word("a", 0, 0.6), word("b", 0.6, 1.2), word("c", 1.6, 2)], flat, RATE);
    expect(same[1]!.start).toBe(0.6);
    expect(same[0]!.end).toBe(0.6);
  });

  it("áudio sem contraste e marcas de hesitação ficam intactos", () => {
    const loud = audio(2, [[0, 2]]);
    const words = [word("a", 0, 0.6), word("b", 0.9, 1.2)];
    expect(snapWordOnsets(words, loud, RATE)).toEqual(words);
    const samples = audio(2, [[0, 0.5], [0.8, 1.4]]);
    const marked = [word("a", 0, 0.5), { ...word("b", 0.88, 1.4), disfluency: "hesitation" as const }];
    expect(snapWordOnsets(marked, samples, RATE)[1]!.start).toBe(0.88);
  });
});

import { agentCharge, creditCost as cost } from "./credits";
import { concatFloat32, createResampler } from "./resample";

describe("cobrança de um pedido ao agente", () => {
  it("cheio se terminou, metade se foi interrompido, nada se a timeline não mudou", () => {
    const price = cost({ type: "agent", tier: "full", durationSec: 60 });
    expect(agentCharge(price, { changed: true, interrupted: false })).toBe(13);
    expect(agentCharge(price, { changed: true, interrupted: true })).toBe(6.5);
    expect(agentCharge(price, { changed: false, interrupted: true })).toBe(0);
    // Ajuste de 1 crédito interrompido: meio crédito, nunca uma fração que o saldo não representa.
    expect(agentCharge(1, { changed: true, interrupted: true })).toBe(0.5);
    expect(agentCharge(16, { changed: true, interrupted: true }) * 2).toBe(16);
  });
});

describe("reamostragem em streaming (áudio de arquivos grandes, pedaço a pedaço)", () => {
  const tone = (hz: number, rate: number, sec: number) => Float32Array.from({ length: Math.round(rate * sec) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate) * 0.5);
  const rms = (x: Float32Array, from = 0, to = x.length) => Math.sqrt(x.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  const run = (input: Float32Array, inRate: number, outRate: number, chunk: number) => {
    const r = createResampler(inRate, outRate);
    const parts: Float32Array[] = [];
    for (let i = 0; i < input.length; i += chunk) parts.push(r.push(input.subarray(i, i + chunk)));
    parts.push(r.flush());
    return concatFloat32(parts);
  };

  it("48 kHz → 16 kHz: a voz passa inteira, o que viraria chiado é barrado, a duração bate", () => {
    const voice = run(tone(1000, 48000, 1), 48000, 16000, 4096);
    expect(voice.length).toBe(16000);
    // Fora das bordas, a amplitude do tom de 1 kHz é a mesma (0,5 de pico = 0,354 RMS).
    expect(rms(voice, 2000, 14000)).toBeCloseTo(0.3536, 2);
    // 11 kHz está acima da metade da taxa nova: sem filtro voltaria como um tom de 5 kHz.
    const hiss = run(tone(11000, 48000, 1), 48000, 16000, 4096);
    expect(rms(hiss, 2000, 14000)).toBeLessThan(0.005);
  });

  it("o resultado não depende do tamanho dos pedaços, e taxas não inteiras funcionam", () => {
    const input = tone(440, 44100, 0.5);
    const a = run(input, 44100, 16000, 1024);
    const b = run(input, 44100, 16000, 7);
    expect(a.length).toBe(b.length);
    expect(Math.abs(a.length - 8000)).toBeLessThanOrEqual(1);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
    expect(diff).toBeLessThan(1e-6);
    expect(rms(a, 1000, 7000)).toBeCloseTo(0.3536, 2);
  });
});
