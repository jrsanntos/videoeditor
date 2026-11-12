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
