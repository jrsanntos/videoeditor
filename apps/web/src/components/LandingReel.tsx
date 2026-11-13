import type { SkillId } from "@videoeditor/core";

/** Foto de fundo de cada estilo (arquivos verticais em /public/landing). */
const PHOTO: Record<SkillId, string> = {
  viral: "/landing/viral.webp",
  autoridade: "/landing/autoridade.webp",
  acao: "/landing/vsl.webp",
  limpeza: "/landing/vsl.webp",
};

/**
 * Cartão vertical com um exemplo de vídeo editado em cada estilo: a pessoa
 * falando para a câmera e, por cima, o que a edição põe na tela (título de
 * gancho, legenda, tarja, número animado), com as fontes de legenda do editor.
 * Passe `src` para trocar a foto por um vídeo (arquivo em /public).
 *
 * Os tamanhos usam `cqw`, então o cartão escala com a largura que receber.
 */
export function Reel({ style, src, className = "" }: { style: SkillId; src?: string; className?: string }) {
  return (
    <div className={`lp-reel lp-reel-${style} [container-type:inline-size] ${className}`} aria-hidden>
      {src ? <video src={src} poster={PHOTO[style]} autoPlay loop muted playsInline preload="metadata" /> : <img src={PHOTO[style]} alt="" loading="lazy" decoding="async" />}
      {LAYERS[style]}
    </div>
  );
}

const Words = ({ text, hi }: { text: string; hi: string }) => (
  <>
    {text.split(" ").map((w, i) => (
      <span key={i} className="lp-word mx-[1.2cqw]" style={{ "--i": i, "--hi": hi } as React.CSSProperties}>
        {w}
      </span>
    ))}
  </>
);

const tag = "absolute left-[6cqw] top-[6cqw] rounded-full bg-black/45 px-[4cqw] py-[1.8cqw] text-[4.6cqw] font-semibold uppercase tracking-[0.12em] text-white/90 backdrop-blur";

const LAYERS: Record<SkillId, React.ReactNode> = {
  viral: (
    <>
      <span className={tag}>Gancho</span>
      <div className="absolute inset-x-0 bottom-[17%] text-center font-['LP_Anton'] uppercase leading-[0.86] text-white [text-shadow:0_0.8cqw_3cqw_rgba(0,0,0,0.6)]">
        <div className="text-[27cqw]">3 erros</div>
        <div className="mt-[2cqw] text-[10cqw] text-[#facc15]">que ninguém vê</div>
      </div>
      <div className="absolute inset-x-[4cqw] bottom-[6%] text-center font-['LP_Anton'] text-[8.6cqw] uppercase leading-none text-white [text-shadow:0_0.6cqw_0_#000]">
        <Words text="e travam suas vendas" hi="#facc15" />
      </div>
    </>
  ),
  autoridade: (
    <>
      <span className={tag}>Tarja</span>
      <div className="absolute bottom-[19%] left-[6cqw] border-l-[0.9cqw] border-[#e8d5a8] bg-black/60 py-[2.2cqw] pl-[3.2cqw] pr-[5cqw] backdrop-blur">
        <div className="text-[5.6cqw] font-bold leading-tight text-white">Dra. Ana Silva</div>
        <div className="text-[4.4cqw] leading-tight text-white/70">Cardiologista</div>
      </div>
      <div className="absolute inset-x-[5cqw] bottom-[7%] text-center text-[6.4cqw] font-semibold leading-tight text-white/60 [text-shadow:0_0.4cqw_2cqw_rgba(0,0,0,0.8)]">
        <Words text="pressão alta não avisa" hi="#ffffff" />
      </div>
    </>
  ),
  acao: (
    <>
      <span className={tag}>Câmera lenta</span>
      {/* Barras de cinema e HUD: o tratamento do estilo, não um dado inventado. */}
      <div className="absolute inset-x-0 top-0 h-[8%] bg-black" />
      <div className="absolute inset-x-0 bottom-0 h-[8%] bg-black" />
      <div className="absolute right-[6cqw] top-[12%] rounded-[1.4cqw] bg-[#59ffcd] px-[2.6cqw] py-[1.1cqw] text-[4.4cqw] font-bold uppercase tracking-[0.1em] text-[#07030a]">0,5×</div>
      <div className="absolute inset-x-0 bottom-[22%] text-center [text-shadow:0_0.8cqw_3cqw_rgba(0,0,0,0.6)]">
        <div className="font-['LP_Bebas'] text-[30cqw] leading-[0.8] text-white">IMPACTO</div>
        <div className="mt-[2.5cqw] text-[5.2cqw] font-bold uppercase tracking-[0.12em] text-[#59ffcd]">no pico da cena</div>
      </div>
      <div className="absolute inset-x-[4cqw] bottom-[11%] text-center text-[7.6cqw] font-extrabold uppercase leading-none text-white [text-shadow:0_0.5cqw_0_#000]">
        <Words text="trilha e som no ponto exato" hi="#59ffcd" />
      </div>
    </>
  ),
  limpeza: (
    <>
      <span className={tag}>Decupagem</span>
      <div className="absolute inset-x-[6cqw] bottom-[7%]">
        <div className="font-['LP_Bebas'] text-[22cqw] leading-[0.85] text-white">−42 s</div>
        <div className="mt-[1.5cqw] text-[5.2cqw] font-medium leading-tight text-white/80">de pausas e 7 recomeços cortados</div>
        <div className="mt-[4cqw] flex h-[8cqw] gap-[1.4cqw]">
          {[30, 0, 22, 0, 26].map((w, i) =>
            w === 0 ? (
              <span key={i} className="lp-cut w-[11%] rounded-[1.6cqw] border border-dashed border-[#ff6b8b] bg-[#ff6b8b]/40" style={{ animationDelay: `${i * 0.5}s` }} />
            ) : (
              <span key={i} className="rounded-[1.6cqw] bg-white/45" style={{ width: `${w}%` }} />
            ),
          )}
        </div>
      </div>
    </>
  ),
};
