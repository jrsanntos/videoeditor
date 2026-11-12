"use client";

import { FONT_PAIRS, type BrandKit, type FontPairId, type Project } from "@videoeditor/core";

/**
 * Fontes do Brand Kit, servidas pela própria aplicação (public/fonts) e
 * registradas pela FontFace API. O canvas só usa uma fonte depois de carregada;
 * por isso o preview e a exportação esperam `loadBrandFonts` antes de desenhar.
 */
type Face = { file: string; weight: string; style: "normal" | "italic" };
// Fontes de peso único são declaradas para a faixa inteira: o canvas pede 900 e
// recebe o arquivo como está, sem negrito sintético.
const FILES: Record<string, Face[]> = {
  Inter: [{ file: "inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  Montserrat: [{ file: "montserrat-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  Poppins: [
    { file: "poppins-latin-600-normal.woff2", weight: "100 700", style: "normal" },
    { file: "poppins-latin-800-normal.woff2", weight: "701 900", style: "normal" },
  ],
  "Bebas Neue": [{ file: "bebas-neue-latin-400-normal.woff2", weight: "100 900", style: "normal" }],
  Anton: [{ file: "anton-latin-400-normal.woff2", weight: "100 900", style: "normal" }],
  Oswald: [{ file: "oswald-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  "Instrument Serif": [{ file: "instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" }],
  "Playfair Display": [{ file: "playfair-display-latin-wght-italic.woff2", weight: "400 900", style: "italic" }],
};

const loading = new Map<string, Promise<void>>();

function loadFamily(family: string): Promise<void> {
  let p = loading.get(family);
  if (!p) {
    p = Promise.all(
      (FILES[family] ?? []).map((def) =>
        new FontFace(family, `url(/fonts/${def.file}) format("woff2")`, { weight: def.weight, style: def.style, display: "block" })
          .load()
          .then((face) => void document.fonts.add(face)),
      ),
    ).then(() => undefined);
    loading.set(family, p);
    // Falha de rede: tenta de novo na próxima vez; enquanto isso vale a fonte substituta.
    p.catch(() => loading.delete(family));
  }
  return p;
}

/** Carrega um par tipográfico pelo id (Brand Kit ou escolha de um clip). Nunca rejeita. */
export async function loadFontPair(id: string | undefined): Promise<void> {
  const pair = id ? FONT_PAIRS[id as FontPairId] : undefined;
  if (!pair) return;
  await Promise.all([loadFamily(pair.sans), loadFamily(pair.serif)]).catch((e) => console.warn("fontes indisponíveis", e));
}

/** Carrega o par do Brand Kit e os escolhidos em clips do projeto. */
export async function loadProjectFonts(project: Project): Promise<void> {
  const ids = new Set<string>([project.brand.fontPair]);
  for (const t of project.tracks) for (const c of t.clips) if (c.type === "component" && c.style?.fontPair) ids.add(c.style.fontPair);
  await Promise.all([...ids].map(loadFontPair));
}

/** Carrega o par tipográfico do Brand Kit. Nunca rejeita: sem a fonte, o texto sai na substituta. */
export async function loadBrandFonts(brand: Pick<BrandKit, "fontPair">): Promise<void> {
  const pair = FONT_PAIRS[brand.fontPair];
  await Promise.all([loadFamily(pair.sans), loadFamily(pair.serif)]).catch((e) => console.warn("fontes do Brand Kit indisponíveis", e));
}
