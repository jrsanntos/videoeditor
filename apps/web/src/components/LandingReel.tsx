import type { SkillId } from "@videoeditor/core";

/**
 * Cartão vertical que mostra o que cada estilo de edição põe na tela: título de
 * gancho, legenda, tarja, número animado. É uma ilustração tipográfica, com as
 * mesmas fontes de legenda do editor. Passe `src` para trocar o fundo por um
 * vídeo real (arquivo em /public); o texto continua por cima.
 *
 * Os tamanhos usam `cqw`, então o cartão escala com a largura que receber.
 */
export function Reel({ style, src, className = "" }: { style: SkillId; src?: string; className?: string }) {
  return (
    <div className={`lp-reel lp-reel-${style} [container-type:inline-size] ${className}`} aria-hidden>
      {src && <video src={src} autoPlay loop muted playsInline preload="metadata" />}
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
      <div className="absolute inset-x-0 top-[24%] text-center font-['LP_Anton'] uppercase leading-[0.86] text-white">
        <div className="text-[30cqw]">3 erros</div>
        <div className="mt-[2cqw] text-[11cqw] text-[#facc15]">que ninguém vê</div>
      </div>
      <div className="absolute inset-x-[4cqw] bottom-[13%] text-center font-['LP_Anton'] text-[10.5cqw] uppercase leading-none text-white [text-shadow:0_0.6cqw_0_#000]">
        <Words text="e travam suas vendas" hi="#facc15" />
      </div>
    </>
  ),
  autoridade: (
    <>
      <span className={tag}>Tarja</span>
      <div className="absolute inset-x-[7cqw] top-[27%] font-['LP_Playfair'] text-[13.5cqw] italic leading-[1.02] text-white">O que o exame não mostra</div>
      <div className="absolute bottom-[26%] left-[6cqw] border-l-[0.9cqw] border-[#e8d5a8] bg-black/55 py-[2.2cqw] pl-[3.2cqw] pr-[5cqw] backdrop-blur">
        <div className="text-[5.6cqw] font-bold leading-tight text-white">Dra. Ana Silva</div>
        <div className="text-[4.4cqw] leading-tight text-white/70">Cardiologista</div>
      </div>
      <div className="absolute inset-x-[5cqw] bottom-[10%] text-center text-[6.2cqw] font-semibold leading-tight text-white/55">
        <Words text="pressão alta não avisa" hi="#ffffff" />
      </div>
    </>
  ),
  vsl: (
    <>
      <span className={tag}>Número</span>
      <div className="absolute inset-x-0 top-[25%] text-center">
        <div className="font-['LP_Bebas'] text-[40cqw] leading-[0.8] text-white">+38%</div>
        <div className="mt-[3cqw] text-[5.4cqw] font-semibold uppercase tracking-[0.14em] text-[#59ffcd]">de conversão em 30 dias</div>
      </div>
      <div className="absolute inset-x-[4cqw] bottom-[12%] text-center text-[8.6cqw] font-extrabold uppercase leading-none text-white [text-shadow:0_0.5cqw_0_#000]">
        <Words text="sem gastar mais anúncio" hi="#59ffcd" />
      </div>
    </>
  ),
  limpeza: (
    <>
      <span className={tag}>Decupagem</span>
      <div className="absolute inset-x-[7cqw] top-[30%] space-y-[3.4cqw]">
        {[
          [34, 0, 22, 44],
          [20, 30, 0, 50],
          [46, 0, 18, 36],
        ].map((row, r) => (
          <div key={r} className="flex h-[9cqw] gap-[1.4cqw]">
            {row.map((w, i) =>
              w === 0 ? (
                <span key={i} className="lp-cut w-[16%] rounded-[1.6cqw] border border-dashed border-[#ff6b8b] bg-[#ff6b8b]/25" style={{ animationDelay: `${r * 0.7}s` }} />
              ) : (
                <span key={i} className="rounded-[1.6cqw] bg-white/25" style={{ width: `${w}%` }} />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-[7cqw] bottom-[11%]">
        <div className="font-['LP_Bebas'] text-[24cqw] leading-[0.85] text-white">−42 s</div>
        <div className="mt-[1.5cqw] text-[5.2cqw] font-medium leading-tight text-white/70">de pausas e 7 recomeços cortados</div>
      </div>
    </>
  ),
};
