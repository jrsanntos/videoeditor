"use client";

import { FONT_PAIRS, type BrandKit } from "@videoeditor/core";

/**
 * Fontes do Brand Kit, servidas pela própria aplicação (public/fonts) e
 * registradas pela FontFace API. O canvas só usa uma fonte depois de carregada;
 * por isso o preview e a exportação esperam `loadBrandFonts` antes de desenhar.
 */
const FILES: Record<string, { file: string; weight: string; style: "normal" | "italic" }> = {
  Inter: { file: "inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
  Montserrat: { file: "montserrat-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
  "Instrument Serif": { file: "instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  "Playfair Display": { file: "playfair-display-latin-wght-italic.woff2", weight: "400 900", style: "italic" },
};

const loading = new Map<string, Promise<void>>();

function loadFamily(family: string): Promise<void> {
  let p = loading.get(family);
  if (!p) {
    const def = FILES[family];
    p = def
      ? new FontFace(family, `url(/fonts/${def.file}) format("woff2")`, { weight: def.weight, style: def.style, display: "block" })
          .load()
          .then((face) => void document.fonts.add(face))
      : Promise.resolve();
    loading.set(family, p);
    // Falha de rede: tenta de novo na próxima vez; enquanto isso vale a fonte substituta.
    p.catch(() => loading.delete(family));
  }
  return p;
}

/** Carrega o par tipográfico do Brand Kit. Nunca rejeita: sem a fonte, o texto sai na substituta. */
export async function loadBrandFonts(brand: Pick<BrandKit, "fontPair">): Promise<void> {
  const pair = FONT_PAIRS[brand.fontPair];
  await Promise.all([loadFamily(pair.sans), loadFamily(pair.serif)]).catch((e) => console.warn("fontes do Brand Kit indisponíveis", e));
}
