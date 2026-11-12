import { describe, expect, it } from "vitest";
import { COMPONENTS, catalogForAgent, validateComponent } from "./index";

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

  it("gera o catálogo para o agente com schema de cada componente", () => {
    const text = catalogForAgent();
    for (const id of Object.keys(COMPONENTS)) expect(text).toContain(`### ${id}`);
  });
});
