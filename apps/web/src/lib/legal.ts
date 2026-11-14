/**
 * Dados da empresa usados nos Termos de Uso e na Política de Privacidade.
 *
 * PLACEHOLDERS: troque os valores entre colchetes pelos dados reais antes do
 * lançamento. Enquanto houver algum colchete, as duas páginas mostram um aviso
 * de minuta. O texto descreve o que o código faz hoje (quais dados sobem e
 * para quem); precisa de revisão jurídica antes de valer como contrato.
 */
export const LEGAL = {
  product: "videoeditor",
  company: "[RAZÃO SOCIAL DA EMPRESA]",
  cnpj: "[CNPJ]",
  address: "[ENDEREÇO DA SEDE]",
  email: "[E-MAIL DE CONTATO]",
  /** Encarregado pelo tratamento de dados (LGPD, art. 41). */
  dpo: "[NOME E E-MAIL DO ENCARREGADO]",
  /** Foro para resolver disputas. */
  forum: "[CIDADE/UF]",
  updatedAt: "[DATA DE PUBLICAÇÃO]",
} as const;

export const legalIsDraft = Object.values(LEGAL).some((v) => v.includes("["));
