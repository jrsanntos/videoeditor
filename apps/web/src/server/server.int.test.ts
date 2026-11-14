import crypto from "node:crypto";
import type Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject, PLANS, type Project } from "@videoeditor/core";

/**
 * Testes de integração do servidor contra um Postgres de verdade: créditos,
 * projetos salvos e o webhook do Stripe (com um Stripe falso, sem rede).
 *
 * Só rodam com TEST_DATABASE_URL apontando para um banco DESCARTÁVEL (as
 * migrações são aplicadas nele). Sem a variável, são pulados:
 *
 *   TEST_DATABASE_URL=postgres://videoeditor:videoeditor@localhost:5432/videoeditor_test pnpm test
 */
const url = process.env.TEST_DATABASE_URL;

type Billing = typeof import("./billing");
type Projects = typeof import("./projects");
type StripeMod = typeof import("./stripe");
type Db = typeof import("./db");

let billing: Billing;
let projects: Projects;
let stripeMod: StripeMod;
let db: Db["db"];

beforeAll(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  ({ db } = await import("./db"));
  billing = await import("./billing");
  projects = await import("./projects");
  stripeMod = await import("./stripe");
});

const uid = (p: string) => `${p}_${crypto.randomUUID().slice(0, 12)}`;

async function newUser(opts: { plan?: "free" | "creator" | "pro"; creditsPlan?: number; customer?: string } = {}) {
  const id = uid("usr");
  await db.run("INSERT INTO users (id, email, name, plan, credits_plan, credits_cycle_grant, credits_renew_at, stripe_customer_id) VALUES ($1, $2, 'Teste', $3, $4, $4, now() + interval '30 days', $5)", [
    id,
    `${id}@example.com`,
    opts.plan ?? "free",
    opts.creditsPlan ?? 0,
    opts.customer ?? null,
  ]);
  return id;
}

const saldo = async (id: string) => (await db.one<{ credits_plan: number; credits_extra: number }>("SELECT credits_plan, credits_extra FROM users WHERE id = $1", [id]))!;
/** O ledger é o registro contábil: a soma dele tem de bater com o saldo materializado. */
const ledgerSum = async (id: string) => (await db.one<{ total: number }>("SELECT COALESCE(SUM(delta), 0) AS total FROM credit_ledger WHERE user_id = $1", [id]))!.total;
const receita = async (id: string) => (await db.one<{ total: number }>("SELECT COALESCE(SUM(amount_brl), 0) AS total FROM payments WHERE user_id = $1", [id]))!.total;

describe.skipIf(!url)("créditos", () => {
  it("concessão com a mesma referência entra uma vez só", async () => {
    const u = await newUser();
    expect(await billing.grantCredits(u, 180, "extra", "pacote", { ref: `t:${u}` })).toBe(true);
    expect(await billing.grantCredits(u, 180, "extra", "pacote", { ref: `t:${u}` })).toBe(false);
    expect((await saldo(u)).credits_extra).toBe(180);
  });

  it("a cobrança sai primeiro do saldo do plano, depois do extra, e o ledger bate com o saldo", async () => {
    const u = await newUser({ creditsPlan: 10 });
    await billing.grantCredits(u, 20, "extra", "pacote");
    expect(await billing.charge(u, 13.5, "edição")).toBe(16.5);
    expect(await saldo(u)).toEqual({ credits_plan: 0, credits_extra: 16.5 });
    // O saldo inicial do plano foi posto direto na conta (sem linha no ledger): desconta da conferência.
    expect((await ledgerSum(u)) + 10).toBe(16.5);
  });

  it("saldo insuficiente é recusado antes de gastar com o provedor", async () => {
    const u = await newUser({ creditsPlan: 5 });
    await expect(billing.assertCredits(u, 13)).rejects.toThrow(/insuficientes/);
    await expect(billing.assertCredits(u, 5)).resolves.toBeUndefined();
  });

  it("revogação por estorno: nunca deixa o saldo negativo e não repete com a mesma referência", async () => {
    const u = await newUser();
    await billing.grantCredits(u, 50, "extra", "pacote");
    expect(await billing.revokeCredits(u, 180, "extra", "estorno", `r:${u}`)).toBe(50);
    expect(await billing.revokeCredits(u, 180, "extra", "estorno", `r:${u}`)).toBe(0);
    expect((await saldo(u)).credits_extra).toBe(0);
    expect(await ledgerSum(u)).toBe(0);
  });

  it("renovação do plano: o que sobrou expira, o extra fica", async () => {
    const u = await newUser({ plan: "creator", creditsPlan: 40 });
    await billing.grantCredits(u, 30, "extra", "pacote");
    await billing.resetPlanCredits(u, "creator", new Date(Date.now() + 30 * 86400_000), { ref: `inv:${u}` });
    expect(await saldo(u)).toEqual({ credits_plan: PLANS.creator.monthlyCredits, credits_extra: 30 });
    // A mesma fatura entregue de novo não renova duas vezes.
    await billing.charge(u, 10, "uso");
    expect(await billing.resetPlanCredits(u, "creator", new Date(), { ref: `inv:${u}` })).toBe(false);
    expect((await saldo(u)).credits_plan).toBe(PLANS.creator.monthlyCredits - 10);
  });
});

describe.skipIf(!url)("projetos salvos na conta", () => {
  const sample = (name = "Meu vídeo"): Project => createProject({ name, aspectRatio: "9:16" });
  const save = (userId: string, p: Project) => projects.saveProject(userId, p.id, JSON.parse(JSON.stringify(p)), 1000);

  it("salvar duas vezes atualiza o mesmo projeto; abrir devolve o que foi salvo", async () => {
    const u = await newUser();
    const p = sample();
    await save(u, p);
    await save(u, { ...p, name: "Renomeado" });
    const list = await projects.listProjects(u);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: p.id, name: "Renomeado" });
    expect((await projects.getProject(u, p.id)).name).toBe("Renomeado");
  });

  it("uma conta não lê nem apaga o projeto de outra", async () => {
    const a = await newUser();
    const b = await newUser();
    const p = sample();
    await save(a, p);
    await expect(projects.getProject(b, p.id)).rejects.toThrow(/não encontrado/);
    await expect(projects.deleteProject(b, p.id)).rejects.toThrow(/não encontrado/);
    expect(await projects.listProjects(b)).toEqual([]);
    await projects.deleteProject(a, p.id);
    expect(await projects.listProjects(a)).toEqual([]);
  });

  it("recusa JSON que não é um projeto, id trocado e projeto grande demais", async () => {
    const u = await newUser();
    const p = sample();
    await expect(projects.saveProject(u, p.id, { nada: true }, 10)).rejects.toThrow(/inválido/);
    await expect(projects.saveProject(u, "outro_id", JSON.parse(JSON.stringify(p)), 10)).rejects.toThrow(/inválido/);
    await expect(projects.saveProject(u, p.id, JSON.parse(JSON.stringify(p)), projects.MAX_PROJECT_BYTES + 1)).rejects.toThrow(/grande demais/);
  });
});

describe.skipIf(!url)("webhook do Stripe: estorno e contestação", () => {
  /** Stripe falso: só o que o webhook lê. `topups` liga o payment_intent ao checkout do pacote. */
  const fakeStripe = (o: { topups?: Record<string, number>; charges?: Record<string, Partial<Stripe.Charge>> } = {}) =>
    ({
      subscriptions: { retrieve: async () => { throw new Error("não esperado neste teste"); } },
      checkout: {
        sessions: {
          list: async ({ payment_intent }: { payment_intent: string }) => ({
            data: o.topups?.[payment_intent] ? [{ mode: "payment", metadata: { kind: "topup", credits: String(o.topups[payment_intent]) } }] : [],
          }),
        },
      },
      charges: { retrieve: async (id: string) => o.charges?.[id] },
    }) as unknown as Stripe;

  const refund = (o: { charge: string; customer: string; pi: string; amount: number; refunded: number }) =>
    ({ id: uid("evt"), type: "charge.refunded", data: { object: { id: o.charge, customer: o.customer, payment_intent: o.pi, amount: o.amount, amount_refunded: o.refunded, currency: "brl" } } }) as unknown as Stripe.Event;

  it("estorno total de um pacote: tira os créditos, abate a receita, e a reentrega do evento não repete", async () => {
    const customer = uid("cus");
    const u = await newUser({ customer });
    await billing.grantCredits(u, 180, "extra", "pacote de 180 créditos");
    const pi = uid("pi");
    const event = refund({ charge: uid("ch"), customer, pi, amount: 7900, refunded: 7900 });
    await stripeMod.handleStripeEvent(fakeStripe({ topups: { [pi]: 180 } }), event);
    await stripeMod.handleStripeEvent(fakeStripe({ topups: { [pi]: 180 } }), event);
    expect((await saldo(u)).credits_extra).toBe(0);
    expect(await receita(u)).toBe(-79);
    expect(await ledgerSum(u)).toBe(0);
  });

  it("estorno parcial tira a parte proporcional; o segundo estorno tira só a diferença", async () => {
    const customer = uid("cus");
    const u = await newUser({ customer });
    await billing.grantCredits(u, 180, "extra", "pacote de 180 créditos");
    const pi = uid("pi");
    const charge = uid("ch");
    const stripe = fakeStripe({ topups: { [pi]: 180 } });
    await stripeMod.handleStripeEvent(stripe, refund({ charge, customer, pi, amount: 7900, refunded: 3950 }));
    expect((await saldo(u)).credits_extra).toBe(90);
    expect(await receita(u)).toBe(-39.5);
    await stripeMod.handleStripeEvent(stripe, refund({ charge, customer, pi, amount: 7900, refunded: 7900 }));
    expect((await saldo(u)).credits_extra).toBe(0);
    expect(await receita(u)).toBe(-79);
  });

  it("créditos já usados não deixam o saldo negativo, e os do plano não são tocados", async () => {
    const customer = uid("cus");
    const u = await newUser({ customer, plan: "creator", creditsPlan: 100 });
    await billing.grantCredits(u, 40, "extra", "resto do pacote");
    const pi = uid("pi");
    await stripeMod.handleStripeEvent(fakeStripe({ topups: { [pi]: 180 } }), refund({ charge: uid("ch"), customer, pi, amount: 7900, refunded: 7900 }));
    expect(await saldo(u)).toEqual({ credits_plan: 100, credits_extra: 0 });
  });

  it("assinatura: só o estorno TOTAL da fatura zera os créditos do ciclo", async () => {
    const customer = uid("cus");
    const u = await newUser({ customer, plan: "creator", creditsPlan: 300 });
    await billing.grantCredits(u, 25, "extra", "pacote antigo");
    const charge = uid("ch");
    const pi = uid("pi");
    await stripeMod.handleStripeEvent(fakeStripe(), refund({ charge, customer, pi, amount: 12700, refunded: 2000 }));
    expect((await saldo(u)).credits_plan).toBe(300);
    await stripeMod.handleStripeEvent(fakeStripe(), refund({ charge, customer, pi, amount: 12700, refunded: 12700 }));
    expect(await saldo(u)).toEqual({ credits_plan: 0, credits_extra: 25 });
    expect(await receita(u)).toBe(-127);
  });

  it("contestação no cartão é tratada como dinheiro devolvido", async () => {
    const customer = uid("cus");
    const u = await newUser({ customer });
    await billing.grantCredits(u, 180, "extra", "pacote de 180 créditos");
    const pi = uid("pi");
    const charge = uid("ch");
    const event = { id: uid("evt"), type: "charge.dispute.created", data: { object: { id: uid("dp"), charge, amount: 7900 } } } as unknown as Stripe.Event;
    await stripeMod.handleStripeEvent(fakeStripe({ topups: { [pi]: 180 }, charges: { [charge]: { id: charge, customer, payment_intent: pi, amount: 7900, amount_refunded: 0, currency: "brl" } } }), event);
    expect((await saldo(u)).credits_extra).toBe(0);
    expect(await receita(u)).toBe(-79);
  });

  it("estorno de cliente desconhecido não quebra o webhook", async () => {
    await expect(stripeMod.handleStripeEvent(fakeStripe(), refund({ charge: uid("ch"), customer: uid("cus"), pi: uid("pi"), amount: 7900, refunded: 7900 }))).resolves.toBeUndefined();
  });
});
