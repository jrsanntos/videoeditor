/**
 * Demonstrações reais da landing (arquivos em /public/landing/demo). Cada uma
 * é um vídeo bruto e o resultado EXPORTADO pelo editor, sem retoque, com
 * autorização de quem aparece. Lista vazia = a seção "Antes e depois" não aparece.
 */
export type Demo = {
  label: string;
  style: string;
  before: string;
  beforePoster?: string;
  beforeSec: number;
  after: string;
  afterPoster?: string;
  afterSec: number;
  /** Fatos medidos nesta edição (o que saiu, quanto tempo levou). */
  facts: string[];
};

export const DEMOS: Demo[] = [];
