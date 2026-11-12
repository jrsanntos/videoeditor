/**
 * Créditos de IA — moeda interna única da plataforma.
 * Regra de ouro: tudo que roda no navegador do usuário custa 0 créditos;
 * só inteligência (LLM/transcrição), mídia generativa e render em nuvem cobram.
 *
 * Valores iniciais derivados da planilha de unit economics; calibrar com
 * telemetria real de custo antes do lançamento.
 */

export const CREDIT_PRICE_BRL = 0.15;

export const PRICING = {
  /** Upload + transcrição + corte bruto: por minuto de vídeo (10 min ≈ 10 créditos). */
  ingestPerMinute: 1,
  /** Prompt de edição ao agente (cortes, zooms, legendas). */
  agentEdit: 2,
  /** Cada cena de motion design criada pelo agente. */
  motionScene: 15,
  /** Clipe generativo (b-roll/áudio IA) de ~5s. */
  generativeClip: 40,
  /** Render na nuvem, por minuto exportado. */
  cloudExportPerMinute: 5,
  /** Edição manual na timeline e export local via WebCodecs. */
  manualEdit: 0,
  browserExport: 0,
} as const;

export type CreditAction =
  | { type: "ingest"; durationSec: number }
  | { type: "agent"; motionScenes: number }
  | { type: "generative"; clips: number }
  | { type: "cloud_export"; durationSec: number }
  | { type: "browser_export" }
  | { type: "manual" };

export function creditCost(action: CreditAction): number {
  switch (action.type) {
    case "ingest":
      return Math.max(1, Math.ceil((action.durationSec / 60) * PRICING.ingestPerMinute));
    case "agent":
      return PRICING.agentEdit + action.motionScenes * PRICING.motionScene;
    case "generative":
      return action.clips * PRICING.generativeClip;
    case "cloud_export":
      return Math.max(1, Math.ceil((action.durationSec / 60) * PRICING.cloudExportPerMinute));
    case "browser_export":
    case "manual":
      return 0;
  }
}

export type PlanId = "free" | "creator" | "pro";

export const PLANS: Record<
  PlanId,
  {
    name: string;
    priceBRL: number;
    monthlyCredits: number;
    maxUploadMinutes: number;
    maxExportHeight: number;
    watermark: boolean;
    rawRetentionDays: number;
    brandKits: boolean;
    xmlExport: boolean;
  }
> = {
  free: {
    name: "Free",
    priceBRL: 0,
    monthlyCredits: 30,
    maxUploadMinutes: 3,
    maxExportHeight: 720,
    watermark: true,
    rawRetentionDays: 3,
    brandKits: false,
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
    brandKits: false,
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
    brandKits: true,
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
