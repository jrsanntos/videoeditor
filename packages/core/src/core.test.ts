import { describe, expect, it } from "vitest";
import {
  addAssetToProject,
  applyOperations,
  buildAgentContext,
  findRepetitions,
  shiftTimedParams,
  createProject,
  creditCost,
  getTrack,
  mainClips,
  OperationError,
  projectDuration,
  silencesFromAudio,
  silencesFromWords,
  timelineWords,
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

  it("precificação segue a tabela de unit economics", () => {
    expect(creditCost({ type: "ingest", durationSec: 600 })).toBe(10);
    expect(creditCost({ type: "agent", motionScenes: 1 })).toBe(17);
    expect(creditCost({ type: "cloud_export", durationSec: 120 })).toBe(10);
    expect(creditCost({ type: "manual" })).toBe(0);
    expect(creditCost({ type: "browser_export" })).toBe(0);
  });
});

describe("precisão por palavra para o agente", () => {
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

  it("detecta retomadas e ignora artigos repetidos", () => {
    const p = withWords(["O", "segredo,", "o", "segredo", "foi", "é", "é", "mudar", "mudar", "a", "oferta"]);
    const reps = findRepetitions(timelineWords(p));
    expect(reps.map((r) => r.phrase)).toEqual(["O segredo", "mudar"]);
    expect(reps[0]).toMatchObject({ firstIndex: 0, secondIndex: 2, length: 2 });
  });

  it("o contexto do vídeo inteiro traz as repetições com tempo por palavra", () => {
    const ctx = buildAgentContext(withWords(["Olá.", "O", "segredo,", "o", "segredo", "foi", "mudar."]));
    expect(ctx).toContain("read_words");
    expect(ctx).toContain('"O segredo" repetido — corte: {"start": 1.5, "end": 2.5}');
    // a primeira ocorrência começa em 1.5s; a segunda, em 2.5s
    expect(ctx).toMatch(/w1 \| 1\.5–1\.9 \| O/);
    expect(ctx).toMatch(/w3 \| 2\.5–2\.9 \| o/);
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
