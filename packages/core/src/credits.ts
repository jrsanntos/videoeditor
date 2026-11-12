/**
 * Créditos de IA — moeda interna única da plataforma.
 * Regra de ouro: tudo que roda no navegador do usuário custa 0 créditos;
 * só inteligência (LLM/transcrição), mídia generativa e render em nuvem cobram.
 * Desenhar componentes, zooms e tarjas é Canvas 2D local: não entra na conta.
 *
 * A tabela segue o custo real medido por chamada (ver usage_events):
 * - transcrição custa centavos → 1 crédito por minuto;
 * - uma edição completa (skill ou direção do vídeo inteiro) usa o modelo
 *   principal e custa mais quanto mais longo o vídeo → base + por minuto;
 * - um ajuste pontual vai para o modelo rápido, ~20× mais barato → 1 crédito.
 * Com isso um Reel de até 1 minuto, do bruto ao pronto, sai por 20 a 28
 * créditos, e cada linha da tabela fica com margem em todos os planos.
 */

export const CREDIT_PRICE_BRL = 0.15;

export const PRICING = {
  /** Upload + transcrição: por minuto de vídeo, arredondado para cima. */
  ingestPerMinute: 1,
  /** Edição completa pela IA: parte fixa... */
  fullEditBase: 12,
  /** ...mais um valor por minuto de vídeo, arredondado para cima. */
  fullEditPerMinute: 3,
  /** Ajuste pontual no chat (um trecho selecionado ou um comando simples). */
  adjust: 1,
  /** Clipe generativo (b-roll/áudio IA) de ~5s. */
  generativeClip: 40,
  /** Render na nuvem, por minuto exportado. */
  cloudExportPerMinute: 5,
  /** Edição manual na timeline e export local via WebCodecs. */
  manualEdit: 0,
  browserExport: 0,
} as const;

/**
 * full: direção do vídeo inteiro (skills, modelos, "edite meu vídeo") — modelo principal.
 * adjust: comando pontual — modelo rápido.
 */
export type AgentTier = "full" | "adjust";

const BROAD_REQUEST =
  /(v[ií]deo (todo|inteiro|completo)|edi(te|ta|tar|[çc][ãa]o) (o |meu |esse |este |todo o )?v[ií]deo|edi[çc][ãa]o completa|do (in[ií]cio|come[çc]o) ao fim|deix[ea] (o v[ií]deo )?pronto|aplique o modelo|com a skill)/i;

/**
 * Classifica um pedido ao agente. É determinístico e roda igual no navegador e
 * no servidor: o usuário vê o preço antes de enviar e é exatamente o cobrado.
 */
export function agentTier(message: string, hasSelection: boolean): AgentTier {
  // Com um trecho selecionado o pedido é, por definição, pontual.
  if (hasSelection) return "adjust";
  return BROAD_REQUEST.test(message) || message.length > 400 ? "full" : "adjust";
}

export type CreditAction =
  | { type: "ingest"; durationSec: number }
  | { type: "agent"; tier: AgentTier; durationSec: number }
  | { type: "generative"; clips: number }
  | { type: "cloud_export"; durationSec: number }
  | { type: "browser_export" }
  | { type: "manual" };

const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));

export function creditCost(action: CreditAction): number {
  switch (action.type) {
    case "ingest":
      return minutes(action.durationSec) * PRICING.ingestPerMinute;
    case "agent":
      return action.tier === "full" ? PRICING.fullEditBase + minutes(action.durationSec) * PRICING.fullEditPerMinute : PRICING.adjust;
    case "generative":
      return action.clips * PRICING.generativeClip;
    case "cloud_export":
      return minutes(action.durationSec) * PRICING.cloudExportPerMinute;
    case "browser_export":
    case "manual":
      return 0;
  }
}

/**
 * Quantos vídeos curtos (até 1 min) um saldo rende: transcrição + uma edição
 * completa + de 4 a 12 ajustes. Arredondado para baixo, para a promessa da
 * tela de planos nunca ser maior que a entrega.
 */
export function videosEstimate(credits: number): { min: number; max: number } {
  const base = creditCost({ type: "ingest", durationSec: 60 }) + creditCost({ type: "agent", tier: "full", durationSec: 60 });
  const round = (n: number) => (n >= 100 ? Math.floor(n / 10) * 10 : n >= 20 ? Math.floor(n / 5) * 5 : Math.floor(n));
  return { min: round(credits / (base + 12 * PRICING.adjust)), max: round(credits / (base + 4 * PRICING.adjust)) };
}

export type PlanId = "free" | "creator" | "pro";

/**
 * Créditos de boas-vindas do plano Free: dados uma vez, no cadastro, e não
 * renovam — o suficiente para editar dois ou três vídeos curtos e ver o
 * resultado (com marca d'água). Crédito grátis todo mês cria usuário que nunca paga.
 */
export const SIGNUP_CREDITS = 60;

export const PLANS: Record<
  PlanId,
  {
    name: string;
    priceBRL: number;
    /** Créditos do plano por ciclo; não acumulam. */
    monthlyCredits: number;
    maxUploadMinutes: number;
    /** Lado menor máximo do vídeo exportado (720 = HD, 1080 = Full HD, 2160 = 4K). */
    maxExportHeight: number;
    watermark: boolean;
    rawRetentionDays: number;
    /** Quantos Brand Kits a conta pode salvar (um por cliente, para quem edita para terceiros). */
    brandKits: number;
    xmlExport: boolean;
  }
> = {
  free: {
    name: "Free",
    priceBRL: 0,
    monthlyCredits: 0,
    maxUploadMinutes: 3,
    maxExportHeight: 720,
    watermark: true,
    rawRetentionDays: 3,
    brandKits: 1,
    xmlExport: false,
  },
  creator: {
    name: "Creator",
    priceBRL: 127,
    monthlyCredits: 1000,
    maxUploadMinutes: 60,
    maxExportHeight: 1080,
    watermark: false,
    rawRetentionDays: 15,
    brandKits: 1,
    xmlExport: false,
  },
  pro: {
    name: "Pro / Studio",
    priceBRL: 347,
    monthlyCredits: 3500,
    maxUploadMinutes: 180,
    maxExportHeight: 2160,
    watermark: false,
    rawRetentionDays: 30,
    brandKits: 10,
    xmlExport: true,
  },
};

export const TOPUPS = [{ credits: 500, priceBRL: 79, expiresInDays: 90 }] as const;

/**
 * Dois saldos por conta:
 * - "plan": créditos do plano; não acumulam — a cada renovação mensal voltam ao valor do plano.
 * - "extra": top-ups e créditos concedidos; sobrevivem às renovações.
 * O consumo sai primeiro do saldo do plano (que expira antes) e depois do extra.
 */
export type CreditBucket = "plan" | "extra";

/**
 * Divide um débito entre os dois saldos. Se nenhum cobre (corrida rara entre
 * checagem e cobrança), o resto vai para o saldo do plano, que fica negativo.
 */
export function splitDebit(plan: number, extra: number, amount: number): { plan: number; extra: number } {
  const fromPlan = Math.min(Math.max(plan, 0), amount);
  const fromExtra = Math.min(Math.max(extra, 0), amount - fromPlan);
  return { plan: amount - fromExtra, extra: fromExtra };
}

/** Saldo do plano após a renovação: volta ao valor mensal; dívida (saldo negativo) é descontada. */
export function renewedPlanCredits(current: number, monthly: number): number {
  return monthly + Math.min(current, 0);
}

function addMonthsUTC(d: Date, months: number): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return r;
}

/**
 * Próxima renovação depois de `now`, mantendo o dia do mês de `anchor`
 * (31 vira o último dia nos meses curtos). Meses perdidos não acumulam.
 */
export function nextRenewal(anchor: Date, now: Date): Date {
  const months = Math.max(1, (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth());
  const next = addMonthsUTC(anchor, months);
  return next > now ? next : addMonthsUTC(anchor, months + 1);
}

/** Créditos para exibição: "396,5", "30". */
export const formatCredits = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
