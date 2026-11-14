import { LEGAL, legalIsDraft } from "@/lib/legal";
import { Logo } from "./ui";

export type LegalSection = { title: string; body: (string | string[])[] };

/** Página de texto jurídico (Termos, Privacidade): mesma moldura, seções numeradas. */
export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  return (
    <div className="stage-bg min-h-screen px-5 py-10">
      <div className="mx-auto w-full max-w-[760px]">
        <a href="/" aria-label="Página inicial">
          <Logo size={28} />
        </a>
        {legalIsDraft && (
          <p className="mt-6 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13.5px] leading-relaxed text-amber-100" role="note" data-testid="legal-draft">
            Minuta: os dados da empresa ainda não foram preenchidos e este texto não passou por revisão jurídica. Não vale como documento final.
          </p>
        )}
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-2 text-[13px] text-zinc-500">Última atualização: {LEGAL.updatedAt}</p>
        <p className="mt-6 text-[15px] leading-relaxed text-zinc-300">{intro}</p>
        {sections.map((s, i) => (
          <section key={s.title} className="mt-9">
            <h2 className="text-[18px] font-semibold text-white">
              {i + 1}. {s.title}
            </h2>
            {s.body.map((b, k) =>
              Array.isArray(b) ? (
                <ul key={k} className="mt-3 list-disc space-y-2 pl-5 text-[14.5px] leading-relaxed text-zinc-300">
                  {b.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={k} className="mt-3 text-[14.5px] leading-relaxed text-zinc-300">
                  {b}
                </p>
              ),
            )}
          </section>
        ))}
        <footer className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-[13.5px] text-zinc-400">
          <a href="/termos" className="hover:text-white">
            Termos de Uso
          </a>
          <a href="/privacidade" className="hover:text-white">
            Política de Privacidade
          </a>
          <a href="/" className="hover:text-white">
            Página inicial
          </a>
        </footer>
      </div>
    </div>
  );
}
