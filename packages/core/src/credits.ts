/**
 * Créditos de IA — moeda interna única da plataforma.
 * Regra de ouro: tudo que roda no navegador do usuário custa 0 créditos;
 * só inteligência (LLM/transcrição), mídia generativa e render em nuvem cobram.
 * Desenhar componentes, zooms e tarjas é Canvas 2D local: não entra na conta.
 *
 * A tabela parte do custo real medido com vídeo real (usage_events) e da
 * regra econômica (ECONOMICS, abaixo): o preço de cada ação dá à IA um teto
 * de custo acima do custo medido, e esse teto é só uma fatia da receita.
 * - transcrição: centavos de dólar por hora → 0,5 crédito por minuto;
 * - edição completa (Diretor no Sonnet; Editor e Crítico no Haiku): medida
 *   em US$ 0,07 a 0,11 por vídeo curto (o Diretor é ~70% disso) → base + por minuto;
 * - passada no vídeo todo (Editor, modelo principal): ~US$ 0,10 a 0,15;
 * - ajuste pontual (modelo rápido): menos de US$ 0,01 → 1 crédito.
 * O teste "economia" no core trava qualquer mudança que derrube a margem.
 */

/** Valor de referência de um crédito (plano Creator), para relatórios. */
export const CREDIT_PRICE_BRL = 0.385;

/**
 * Custo de IA MEDIDO por ação (US$) no vídeo real de teste (79 s), com o
 * Diretor no Sonnet e Editor/Crítico no Haiku: é o que o teto de cada ação
 * precisa cobrir para a IA não ser interrompida no caso comum (com folga: o
 * maior valor medido foi US$ 0,107). Remedir ao trocar modelo ou prompt.
 */
export const MEASURED_AI_COST_USD = { fullEditShort: 0.12, sweepShort: 0.12, adjust: 0.01, image: 0.04, videoClip5s: 0.35 } as const;

export const PRICING = {
  /** Upload + transcrição: por minuto de vídeo, arredondado para cima. */
  ingestPerMinute: 0.5,
  /** Edição completa pela IA: parte fixa (o custo de um vídeo curto é quase todo fixo)... */
  fullEditBase: 10,
  /** ...mais um valor por minuto de vídeo, arredondado para cima. */
  fullEditPerMinute: 3,
  /** Passada no vídeo inteiro sem replanejar (revisar erros, zoom nas ênfases, destacar números): modelo principal, sem Diretor. */
  sweepBase: 6,
  sweepPerMinute: 2,
  /** Ajuste pontual no chat (um trecho selecionado ou um comando simples). */
  adjust: 1,
  /** Vídeo gerado por IA (Gemini Omni), até 5 s: ~US$ 0,07 por segundo. */
  generativeClip: 40,
  /** Imagem gerada por IA (Gemini): ~US$ 0,04 por imagem. */
  generativeImage: 4,
  /** Render na nuvem, por minuto exportado. */
  cloudExportPerMinute: 5,
  /** Edição manual na timeline e export local via WebCodecs. */
  manualEdit: 0,
  browserExport: 0,
} as const;

/**
 * full:   direção do vídeo inteiro (skills, modelos, "edite meu vídeo") — Diretor + Editor + Crítico, modelo principal.
 * sweep:  uma tarefa aplicada ao vídeo inteiro ("revise os erros", "zoom nas ênfases", "destaque os números") — Editor, modelo principal.
 * adjust: comando pontual (um trecho, um elemento, uma propriedade) — modelo rápido.
 */
export type AgentTier = "full" | "sweep" | "adjust";
export const AGENT_TIERS: AgentTier[] = ["full", "sweep", "adjust"];
export const TIER_NAMES: Record<AgentTier, string> = { full: "Edição completa", sweep: "Passada no vídeo todo", adjust: "Ajuste" };

const BROAD_REQUEST =
  /(v[ií]deo (todo|inteiro|completo)|edi(te|ta|tar|[çc][ãa]o) (o |meu |esse |este |todo o )?v[ií]deo|edi(te|ta|tar) tudo|edi[çc][ãa]o completa|do (in[ií]cio|come[çc]o) ao fim|deix[ea] (o v[ií]deo )?pronto|pronto pra postar|pronto para postar|aplique o modelo|com a skill|no estilo d[eoa]|estilo (viral|autoridade|cinema|a[çc][ãa]o)|refa[çz]a (a edi[çc][ãa]o|tudo)|monte (o v[ií]deo|a edi[çc][ãa]o))/i;

/** Tarefa que varre o vídeo todo: plural, "todos/cada", ou uma revisão geral. */
const SWEEP_REQUEST =
  /(\b(todos|todas|cada|sempre que|toda vez|em todo|ao longo|nos momentos|nas partes|nos trechos|onde eu)\b|revis[ae]|erros de grava[çc][ãa]o|takes? ruins?|muletas|pausas|sil[êe]ncios|legendas?\b.*\b(todas|corrij|revis)|\bos n[úu]meros\b|\bas ênfases\b)/i;

/** Referência a um ponto específico: tempo ("0:12", "12s"), "aqui", "este trecho", um elemento. */
const POINT_REQUEST = /(\b\d{1,2}:\d{2}\b|\b\d+(,\d+)?\s?s(eg(undos?)?)?\b|\baqui\b|\bneste trecho\b|\bnesse trecho\b|\beste (zoom|card|cart[ãa]o|t[íi]tulo)\b|\bo [úu]ltimo\b|\bo primeiro\b)/i;

/**
 * Classificação determinística de um pedido ao agente. É o plano B da
 * classificação por intenção feita no servidor (que devolve um passe com o
 * nível e o preço); roda igual no navegador e no servidor.
 */
export function agentTier(message: string, hasSelection: boolean): AgentTier {
  // Com um trecho selecionado o pedido é, por definição, pontual.
  if (hasSelection) return "adjust";
  if (BROAD_REQUEST.test(message) || message.length > 400) return "full";
  if (SWEEP_REQUEST.test(message) && !POINT_REQUEST.test(message)) return "sweep";
  return "adjust";
}

export type CreditAction =
  | { type: "ingest"; durationSec: number }
  | { type: "agent"; tier: AgentTier; durationSec: number }
  | { type: "generative"; clips: number }
  | { type: "generative_image"; images: number }
  | { type: "cloud_export"; durationSec: number }
  | { type: "browser_export" }
  | { type: "manual" };

const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));

export function creditCost(action: CreditAction): number {
  switch (action.type) {
    case "ingest":
      return minutes(action.durationSec) * PRICING.ingestPerMinute;
    case "agent":
      return action.tier === "full"
        ? PRICING.fullEditBase + minutes(action.durationSec) * PRICING.fullEditPerMinute
        : action.tier === "sweep"
          ? PRICING.sweepBase + minutes(action.durationSec) * PRICING.sweepPerMinute
          : PRICING.adjust;
    case "generative":
      return action.clips * PRICING.generativeClip;
    case "generative_image":
      return action.images * PRICING.generativeImage;
    case "cloud_export":
      return minutes(action.durationSec) * PRICING.cloudExportPerMinute;
    case "browser_export":
    case "manual":
      return 0;
  }
}

/**
 * Quantos vídeos curtos (até 1 min) um saldo rende: transcrição + uma edição
 * completa + de 2 a 8 ajustes. Arredondado para baixo, para a promessa da
 * tela de planos nunca ser maior que a entrega (no mínimo 1 quando o saldo
 * cobre a edição).
 */
export function videosEstimate(credits: number): { min: number; max: number } {
  const base = creditCost({ type: "ingest", durationSec: 60 }) + creditCost({ type: "agent", tier: "full", durationSec: 60 });
  const round = (n: number) => (n >= 100 ? Math.floor(n / 10) * 10 : n >= 20 ? Math.floor(n / 5) * 5 : Math.floor(n));
  const floor = credits >= base ? 1 : 0;
  return { min: Math.max(floor, round(credits / (base + 8 * PRICING.adjust))), max: Math.max(floor, round(credits / (base + 2 * PRICING.adjust))) };
}

/**
 * Economia da plataforma: de cada real cobrado, quanto vai para taxas,
 * impostos e despesas, e quanto PODE ir para IA. O custo de IA de um pedido
 * nunca passa do teto que estes números dão para o preço dele (a rota do
 * agente para antes), então a margem existe por construção, mesmo no pior
 * caso (todos os créditos gastos, nos pedidos mais caros, no câmbio alto).
 */
export const ECONOMICS = {
  /** Cartão no Stripe Brasil (~3,99% + R$ 0,39) com folga. */
  paymentFee: 0.05,
  /** Simples Nacional (anexo V, faixa inicial ~15,5%) com folga. */
  taxes: 0.17,
  /** Infra, banco, e-mail, transcrição, estornos e suporte. */
  overhead: 0.1,
  /** Teto do custo de IA sobre a receita bruta de cada crédito. */
  aiShare: 0.3,
  /** Câmbio de segurança para o teto (a cotação real fica no painel; o teto usa esta, mais alta). */
  usdBrl: 6.2,
} as const;

/** Margem líquida mínima garantida (pior caso), depois de taxas, impostos, despesas e IA. */
export const MIN_NET_MARGIN = 1 - ECONOMICS.paymentFee - ECONOMICS.taxes - ECONOMICS.overhead - ECONOMICS.aiShare;

export type PlanId = "free" | "creator" | "pro";

/**
 * Créditos de boas-vindas do plano Free: dados uma vez, no cadastro, e não
 * renovam — o suficiente para UMA edição completa de um vídeo de até 2 minutos
 * e alguns ajustes, com marca d'água. É custo de aquisição (pior caso: o teto
 * de IA desses créditos, ~R$ 3 por cadastro); crédito grátis todo mês cria
 * usuário que nunca paga.
 */
export const SIGNUP_CREDITS = 20;

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
    maxUploadMinutes: 2,
    maxExportHeight: 720,
    watermark: true,
    rawRetentionDays: 3,
    brandKits: 1,
    xmlExport: false,
  },
  creator: {
    name: "Creator",
    priceBRL: 127,
    monthlyCredits: 330,
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
    monthlyCredits: 1000,
    maxUploadMinutes: 180,
    maxExportHeight: 2160,
    watermark: false,
    rawRetentionDays: 30,
    brandKits: 10,
    xmlExport: true,
  },
};

export const TOPUPS = [{ credits: 180, priceBRL: 79, expiresInDays: 90 }] as const;

/** Menor receita por crédito entre tudo que se vende (plano mais barato por crédito ou pacote). */
export function minRevenuePerCreditBRL(): number {
  const paid = (Object.values(PLANS) as (typeof PLANS)[PlanId][]).filter((p) => p.priceBRL > 0 && p.monthlyCredits > 0).map((p) => p.priceBRL / p.monthlyCredits);
  return Math.min(...paid, ...TOPUPS.map((t) => t.priceBRL / t.credits));
}

/**
 * Teto de custo de IA (US$) por crédito cobrado: a fatia de IA da receita do
 * crédito mais barato, no câmbio de segurança. A rota do agente multiplica pelo
 * preço do pedido e para antes de passar disso.
 */
export function aiBudgetUSDPerCredit(): number {
  return (minRevenuePerCreditBRL() * ECONOMICS.aiShare) / ECONOMICS.usdBrl;
}

/** Teto de custo de IA (US$) de um pedido que cobra `credits`. */
export const aiBudgetUSD = (credits: number) => credits * aiBudgetUSDPerCredit();

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
