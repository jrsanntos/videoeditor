import { PLANS, SIGNUP_CREDITS, SKILLS, TOPUPS, videosEstimate, type PlanId } from "@videoeditor/core";
import { Icon } from "./icons";
import { LandingStyles } from "./LandingStyles";
import { LandingUpload } from "./LandingUpload";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const videos = (credits: number) => {
  const { min, max } = videosEstimate(credits);
  return min === max ? String(max) : `${min} a ${max}`;
};

const wrap = "mx-auto w-full max-w-[1240px] px-4 sm:px-6";
const h2 = "lp-display mt-4 text-[32px] font-semibold leading-[1.08] sm:text-[46px]";
const lead = "mt-5 max-w-xl text-[17.5px] leading-relaxed text-haze";

const STEPS = [
  { title: "Envie aqui mesmo", text: "Arraste o vídeo gravado no celular ou na câmera para esta página. Em segundos você vê o seu vídeo no estilo escolhido e as pausas que vão sair, sem conta e sem custo." },
  { title: "Crie a conta e deixe a IA editar", text: `Com Google em um clique ou e-mail. Você ganha ${SIGNUP_CREDITS} créditos e a IA começa na hora: limpa a fala, planeja o ritmo e monta zooms, legendas e motion design.` },
  { title: "Ajuste e exporte", text: "Mude o que quiser na timeline ou direto no vídeo, sem gastar créditos, e exporte em MP4 pelo próprio navegador." },
];

const DIRECTOR = [
  { title: "Assiste", text: "Lê a fala inteira, mede a força da voz em cada palavra e vê onde você está no quadro." },
  { title: "Planeja", text: "Divide o vídeo em capítulos, cada um com o seu orçamento de efeitos." },
  { title: "Executa", text: "Corta, enquadra e anima seguindo o plano, com cada elemento entrando na palavra exata." },
  { title: "Revisa", text: "Audita o próprio resultado: nada de efeitos empilhados, trechos parados demais ou texto sobre o seu rosto." },
];

const CHAPTERS = [
  { name: "Gancho", plan: "título gigante + punch-in", width: 14, color: "bg-neon-pink text-night-950" },
  { name: "Desenvolvimento", plan: "lista lateral, câmera lenta", width: 44, color: "bg-white/12" },
  { name: "Virada", plan: "cartão de tela cheia", width: 22, color: "bg-neon-mint text-night-950" },
  { name: "Fecho", plan: "destaque na chamada", width: 20, color: "bg-white/20" },
];

const FAQ = [
  {
    q: "Preciso saber editar vídeo?",
    a: "Não. Você envia o vídeo, escolhe um estilo e a IA entrega editado. Se preferir fazer do seu jeito, abra direto no editor: clique num bloco da timeline ou arraste o texto no próprio vídeo.",
  },
  {
    q: "O meu vídeo é enviado para algum servidor?",
    a: "O arquivo de vídeo fica no seu navegador. Só o áudio comprimido sobe para a transcrição, e a IA trabalha com o texto da fala e alguns quadros em baixa resolução para entender o enquadramento.",
  },
  {
    q: "Como funcionam os créditos?",
    a: "Créditos pagam o que usa inteligência artificial: transcrição, edição completa e ajustes por texto. Tudo que você faz à mão na timeline e a exportação no navegador são gratuitos. Um vídeo curto, do bruto ao pronto, costuma gastar de 20 a 28 créditos.",
  },
  {
    q: "Posso testar sem pagar?",
    a: `Sim. Envie o vídeo nesta página e veja a prévia do estilo e as pausas encontradas sem criar conta. Para a IA editar, crie a conta grátis (com Google ou e-mail): você ganha ${SIGNUP_CREDITS} créditos, sem cartão, o suficiente para os primeiros vídeos.`,
  },
  {
    q: "Para que tipo de vídeo serve?",
    a: "Vídeo falado para a câmera: Reels, Shorts e TikTok, aulas, vídeos de vendas e conteúdo de especialistas como médicos, advogados, consultores e criadores.",
  },
  {
    q: "E se eu não gostar do que a IA fez?",
    a: "Um Ctrl+Z desfaz o pedido inteiro. Você também pode pedir um ajuste só num trecho: selecione na timeline e diga o que quer mudar.",
  },
];

const NAV = [
  ["#enviar", "Testar agora"],
  ["#estilos", "Estilos"],
  ["#como-funciona", "Como funciona"],
  ["#recursos", "Recursos"],
  ["#planos", "Planos"],
  ["#duvidas", "Dúvidas"],
];

/** Página inicial pública: abertura, estilos, como funciona, recursos, planos e perguntas frequentes. */
export function Landing({ loggedIn, google }: { loggedIn: boolean; google: boolean }) {
  return (
    <div className="lp min-h-screen overflow-x-clip pt-3 sm:pt-5">
      <header className={`${wrap} sticky top-3 z-40`}>
        <nav className="flex h-[68px] items-center gap-3 rounded-[20px] border border-edge bg-night-950/80 px-4 shadow-[0_20px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:px-6" aria-label="Principal">
          <a href="/" aria-label="videoeditor, página inicial">
            <Mark />
          </a>
          <div className="ml-5 hidden items-center gap-7 text-[15px] font-medium text-haze lg:flex">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="transition hover:text-white">
                {label}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!loggedIn && (
              <a href="/login" className="lp-btn lp-btn-ghost hidden !px-5 !py-3 text-[14.5px] sm:inline-flex">
                Entrar
              </a>
            )}
            <a href={loggedIn ? "/app" : "/login?modo=cadastro"} className="lp-btn lp-btn-primary !px-5 !py-3 text-[14.5px]" data-testid="nav-cta">
              {loggedIn ? "Abrir o editor" : "Criar conta grátis"}
            </a>
          </div>
        </nav>
      </header>

      <main>
        {/* Abertura: o envio do vídeo é o próprio chamado */}
        <section className={`${wrap} relative mt-10 sm:mt-16`}>
          <div className="pointer-events-none absolute inset-x-0 -top-10 -z-10 mx-auto h-[420px] max-w-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(246,76,255,0.22),transparent)] blur-2xl" aria-hidden />
          <div className="mx-auto max-w-[880px] text-center">
            <p className="lp-overline">Editor de vídeo com IA · para quem fala para a câmera</p>
            <h1 className="lp-display mt-5 text-[42px] font-semibold leading-[1.02] sm:text-[66px]">
              Envie o vídeo bruto.
              <br />
              <span className="bg-[linear-gradient(100deg,#f64cff,#ffd1ff_45%,#59ffcd)] bg-clip-text text-transparent">Receba pronto para postar.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[640px] text-[18px] leading-relaxed text-haze sm:text-[19px]">
              Cortes, legendas, zooms e motion design montados a partir da sua fala, no estilo que você escolher. Teste agora com o seu próprio vídeo, sem sair desta página.
            </p>
            <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14.5px] text-haze">
              {[`${SIGNUP_CREDITS} créditos grátis`, "Sem cartão", "Entre com Google", "O vídeo não sai do seu navegador"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon.check size={16} className="text-neon-mint" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto mt-10 max-w-[1080px] sm:mt-12">
            <LandingUpload loggedIn={loggedIn} google={google} />
          </div>
          <dl className="mx-auto mt-12 grid max-w-[760px] grid-cols-3 gap-4 text-center">
            {[
              ["Créditos grátis", String(SIGNUP_CREDITS)],
              ["Estilos de edição", String(Object.keys(SKILLS).length)],
              ["Para exportar", "R$ 0"],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col-reverse">
                <dt className="mt-2 text-[11.5px] uppercase leading-snug tracking-[0.18em] text-haze">{k}</dt>
                <dd className="lp-display text-[32px] font-semibold leading-none sm:text-[40px]">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Estilos */}
        <section id="estilos" className={`${wrap} scroll-mt-28 pt-24 sm:pt-32`}>
          <p className="lp-overline">Estilos de edição</p>
          <h2 className={`${h2} max-w-3xl`}>O mesmo vídeo bruto, quatro jeitos de editar.</h2>
          <p className={lead}>Cada estilo é um conjunto de decisões de ritmo, câmera e texto. Escolha um e a IA edita o vídeo inteiro seguindo essas regras.</p>
          <div className="mt-10">
            <LandingStyles />
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className={`${wrap} scroll-mt-28 pt-24 sm:pt-32`}>
          <p className="lp-overline">Como funciona</p>
          <h2 className={`${h2} max-w-2xl`}>Três passos entre gravar e publicar.</h2>
          <ol className="mt-12 grid border-t border-edge md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`border-edge py-8 md:py-10 ${i > 0 ? "border-t md:border-l md:border-t-0 md:pl-9" : ""} ${i < 2 ? "md:pr-9" : ""}`}>
                <span className="lp-display block text-[76px] font-bold leading-none text-transparent [-webkit-text-stroke:1.5px_rgba(247,243,255,0.4)]">{i + 1}</span>
                <h3 className="lp-display mt-6 text-[23px] font-semibold">{s.title}</h3>
                <p className="mt-3 text-[16.5px] leading-relaxed text-haze">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Recursos */}
        <section id="recursos" className={`${wrap} scroll-mt-28 pt-24 sm:pt-32`}>
          <p className="lp-overline">Recursos</p>
          <h2 className={`${h2} max-w-3xl`}>Um editor completo, com a parte chata automatizada.</h2>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <Tile className="lg:col-span-2" title="Timeline de editor profissional" text="Selecione um trecho e corte, divida num clique, desfaça à vontade. Edição manual é sempre gratuita.">
              <TimelineArt />
            </Tile>
            <Tile title="Legendas que você controla" text="Geradas da sua fala, aparecem na timeline: reescreva, mova, esconda ou arraste no vídeo.">
              <div className="flex h-full flex-col items-center justify-center gap-2.5">
                <span className="rounded-lg border border-dashed border-neon-mint/70 px-3 py-1.5 font-['LP_Anton'] text-[24px] uppercase leading-none">
                  travam suas <span className="text-[#facc15]">vendas</span>
                </span>
                <span className="text-[13px] text-haze">arraste para reposicionar</span>
              </div>
            </Tile>
            <Tile title="Limpeza automática" text="Erros de gravação, recomeços, “hum”, “tipo”, “né” e pausas longas saem em um clique. A fala fica contínua e natural." />
            <Tile title="Câmera virtual" text="Punch-ins, avanços lentos e pans fechados no seu rosto, na palavra em que a voz enfatiza." />
            <Tile title="Motion design pronto" text="Título de gancho com profundidade, listas, números animados e cartões cinéticos nas cores da sua marca." />
            <Tile className="lg:col-span-3" wide title="Sua marca em todo vídeo" text="Cores, fontes, nome e credencial definidos uma vez. Cada vídeo novo já nasce com a sua identidade.">
              <div className="flex h-full flex-wrap items-center gap-x-8 gap-y-4">
                <div className="flex -space-x-2">
                  {["#facc15", "#f64cff", "#59ffcd", "#f7f3ff"].map((c) => (
                    <span key={c} className="h-12 w-12 rounded-full border-2 border-night-900" style={{ background: c }} />
                  ))}
                </div>
                <span className="font-['LP_Anton'] text-[34px] uppercase leading-none">Aa</span>
                <span className="font-['LP_Playfair'] text-[36px] italic leading-none">Aa</span>
                <span className="font-['LP_Bebas'] text-[40px] leading-none">Aa</span>
              </div>
            </Tile>
          </div>
        </section>

        {/* Diretor de IA */}
        <section id="diretor" className={`${wrap} scroll-mt-28 pt-24 sm:pt-32`}>
          <div className="grid items-end gap-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="lp-overline">Diretor de IA</p>
              <h2 className={h2}>Não joga efeitos. Edita com um plano.</h2>
            </div>
            <p className="text-[17.5px] leading-relaxed text-haze">
              A diferença entre um vídeo profissional e um vídeo “com efeitos” é o ritmo: saber onde acelerar, onde limpar a tela e o que merece destaque. Por isso a IA assiste ao vídeo inteiro antes de mexer em qualquer coisa.
            </p>
          </div>

          <div className="lp-panel mt-12 rounded-[28px] p-5 sm:p-8">
            <p className="text-[12px] uppercase tracking-[0.2em] text-haze">Plano de edição · vídeo de 48 s</p>
            <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
              {CHAPTERS.map((c) => (
                <div key={c.name} className={`min-w-[150px] rounded-2xl px-4 py-4 ${c.color}`} style={{ flex: `${c.width} 0 0` }}>
                  <div className="lp-display text-[17px] font-semibold leading-tight">{c.name}</div>
                  <div className="mt-1 text-[13.5px] leading-snug opacity-75">{c.plan}</div>
                </div>
              ))}
            </div>
            <ol className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
              {DIRECTOR.map((d, i) => (
                <li key={d.title} className="border-t border-edge pt-5">
                  <span className="lp-display text-[13px] font-semibold text-neon-pink">0{i + 1}</span>
                  <h3 className="lp-display mt-1.5 text-[20px] font-semibold">{d.title}</h3>
                  <p className="mt-2 text-[15.5px] leading-relaxed text-haze">{d.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Faixas cruzadas */}
        <div className="relative mt-24 h-[150px] sm:mt-32" aria-hidden>
          <div className="absolute inset-x-[-5%] top-1/2 -translate-y-1/2 rotate-[3deg]">
            <Ribbon items={["O vídeo original fica no seu navegador", "Tudo que a IA faz pode ser desfeito"]} />
          </div>
          <div className="absolute inset-x-[-5%] top-1/2 -translate-y-1/2 -rotate-[4deg]">
            <Ribbon solid reverse items={["Exportação gratuita, sem fila de render", "Edição manual sem gastar créditos"]} />
          </div>
        </div>
        <ul className="sr-only">
          <li>O vídeo original fica no seu navegador</li>
          <li>Tudo que a IA faz pode ser desfeito</li>
          <li>Exportação gratuita, sem fila de render</li>
          <li>Edição manual sem gastar créditos</li>
        </ul>

        {/* Planos */}
        <section id="planos" className={`${wrap} scroll-mt-28 pt-20 sm:pt-28`}>
          <p className="lp-overline">Planos</p>
          <h2 className={`${h2} max-w-2xl`}>Comece grátis. Pague quando fizer sentido.</h2>
          <p className={lead}>Créditos pagam só o que usa IA. Edição manual e exportação no navegador são gratuitas em todos os planos.</p>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {(Object.keys(PLANS) as PlanId[]).map((id) => {
              const plan = PLANS[id];
              const featured = id === "creator";
              return (
                <div key={id} className={`flex flex-col rounded-[28px] p-7 sm:p-8 ${featured ? "border border-neon-pink/70 bg-[linear-gradient(160deg,rgba(246,76,255,0.16),rgba(89,255,205,0.06))] shadow-[0_30px_70px_-30px_rgba(246,76,255,0.55)]" : "lp-panel"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="lp-display text-[20px] font-semibold">{plan.name}</h3>
                    {featured && <span className="rounded-full bg-neon-mint px-3 py-1 text-[11.5px] font-bold uppercase tracking-[0.08em] text-night-950">Para criadores</span>}
                  </div>
                  <p className="mt-5 flex items-baseline gap-1.5">
                    <span className="lp-display text-[48px] font-semibold leading-none">{plan.priceBRL ? brl(plan.priceBRL) : "Grátis"}</span>
                    {plan.priceBRL > 0 && <span className="text-haze">/mês</span>}
                  </p>
                  <p className="mt-3 text-[15px] leading-snug text-haze">
                    {id === "free" ? `${SIGNUP_CREDITS} créditos de boas-vindas: ${videos(SIGNUP_CREDITS)} vídeos curtos para testar` : `${plan.monthlyCredits.toLocaleString("pt-BR")} créditos por mês: cerca de ${videos(plan.monthlyCredits)} vídeos curtos`}
                  </p>
                  <ul className="mt-7 flex-1 space-y-3 border-t border-edge pt-6 text-[15.5px]">
                    {[
                      `Vídeos de até ${plan.maxUploadMinutes} minutos`,
                      `Exportação em ${plan.maxExportHeight >= 2160 ? "4K" : plan.maxExportHeight >= 1080 ? "Full HD (1080p)" : "HD (720p)"}`,
                      plan.watermark ? "Com marca d'água" : "Sem marca d'água",
                      plan.brandKits === 1 ? "1 Brand Kit salvo" : `Até ${plan.brandKits} Brand Kits, um por cliente`,
                      "Edição manual e exportação ilimitadas",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <Icon.check size={17} className="mt-0.5 shrink-0 text-neon-mint" /> {item}
                      </li>
                    ))}
                  </ul>
                  <a href={loggedIn ? "/planos" : "/login?modo=cadastro"} className={`lp-btn mt-8 text-[15.5px] ${featured ? "lp-btn-primary" : "lp-btn-outline"}`}>
                    {id === "free" ? (loggedIn ? "Ver meu plano" : "Criar conta grátis") : `Assinar ${plan.name}`}
                  </a>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-[15px] text-haze">
            Precisa de mais num mês? Pacote avulso de {TOPUPS[0].credits} créditos por {brl(TOPUPS[0].priceBRL)}: cerca de {videos(TOPUPS[0].credits)} vídeos curtos a mais.
          </p>
        </section>

        {/* Perguntas frequentes */}
        <section id="duvidas" className={`${wrap} scroll-mt-28 pt-24 sm:pt-32`}>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <p className="lp-overline">Dúvidas</p>
              <h2 className={h2}>Perguntas frequentes</h2>
            </div>
            <div className="border-t border-edge">
              {FAQ.map((f) => (
                <details key={f.q} className="group border-b border-edge py-5">
                  <summary className="lp-display flex cursor-pointer list-none items-center justify-between gap-4 text-[19px] font-medium [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <Icon.chevron size={20} className="shrink-0 text-neon-mint transition group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 max-w-2xl text-[16.5px] leading-relaxed text-haze">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Chamada final */}
        <section className={`${wrap} py-24 sm:py-32`}>
          <div className="flex flex-col gap-8 rounded-[28px] border border-edge bg-[linear-gradient(120deg,rgba(246,76,255,0.22),rgba(89,255,205,0.14))] p-8 sm:p-14 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="lp-overline">Teste com um vídeo que já está gravado</p>
              <h2 className="lp-display mt-4 max-w-2xl text-[32px] font-semibold leading-[1.08] sm:text-[46px]">Seu próximo vídeo pode sair editado em minutos.</h2>
              <p className="mt-4 max-w-xl text-[16.5px] text-haze">Envie, escolha o estilo e veja a prévia agora. A conta só é pedida na hora de a IA processar.</p>
            </div>
            <a href="#enviar" className="lp-btn lp-btn-primary shrink-0 self-start !px-9 !py-5 text-[17px] lg:self-auto">
              Enviar meu vídeo
            </a>
          </div>
        </section>
      </main>

      <footer className={`${wrap} pb-8`}>
        <div className="lp-panel flex flex-col items-center justify-between gap-5 rounded-[20px] px-6 py-6 text-[14.5px] text-haze sm:flex-row">
          <Mark />
          <nav className="flex gap-7" aria-label="Rodapé">
            <a href="#recursos" className="hover:text-white">
              Recursos
            </a>
            <a href="#planos" className="hover:text-white">
              Planos
            </a>
            <a href="/login" className="hover:text-white">
              Entrar
            </a>
          </nav>
          <span>© {new Date().getFullYear()} videoeditor</span>
        </div>
      </footer>
    </div>
  );
}

function Mark() {
  return (
    <span className="inline-flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#f64cff,#59ffcd)]">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 2.2v11.6L14 8 4 2.2Z" fill="#07030a" />
        </svg>
      </span>
      <span className="lp-display text-[19px] font-semibold text-white">videoeditor</span>
    </span>
  );
}

/** Faixa de texto corrido. O texto é repetido em duas metades iguais para o laço não ter emenda. */
function Ribbon({ items, reverse, solid }: { items: string[]; reverse?: boolean; solid?: boolean }) {
  const text = items.join(" · ");
  return (
    <div className={`lp-ribbon ${solid ? "lp-ribbon-solid" : ""} ${reverse ? "lp-ribbon-reverse" : ""}`}>
      <div className="lp-ribbon-track">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i}>{text} ·</span>
        ))}
      </div>
    </div>
  );
}

function Tile({ title, text, children, className = "", wide }: { title: string; text: string; children?: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <article className={`lp-panel flex rounded-[20px] p-6 transition-colors hover:border-neon-pink/60 sm:p-7 ${wide ? "flex-col gap-6 md:flex-row md:items-center md:justify-between" : "flex-col"} ${className}`}>
      {children && !wide && <div className="mb-6 h-[150px]">{children}</div>}
      <div className={wide ? "max-w-xl" : children ? "mt-auto" : ""}>
        <h3 className="lp-display text-[21px] font-semibold">{title}</h3>
        <p className="mt-2 text-[16px] leading-relaxed text-haze">{text}</p>
      </div>
      {children && wide && <div>{children}</div>}
    </article>
  );
}

/** Trilhas da timeline do editor: motion, zooms, fala (com um trecho selecionado para corte) e legendas. */
function TimelineArt() {
  const clips = [24, 17, 31, 28];
  return (
    <div className="flex h-full flex-col justify-center gap-2 rounded-2xl border border-edge bg-night-950/70 p-4">
      <div className="relative h-5">
        {[
          [3, 15],
          [39, 21],
          [75, 17],
        ].map(([l, w]) => (
          <span key={l} className="absolute h-5 rounded-md bg-neon-pink/70" style={{ left: `${l}%`, width: `${w}%` }} />
        ))}
      </div>
      <div className="relative h-5">
        {[2, 20, 31, 52, 63, 83].map((l) => (
          <span key={l} className="absolute h-5 w-[8%] rounded-md bg-[#facc15]/60" style={{ left: `${l}%` }} />
        ))}
      </div>
      <div className="flex h-10 gap-1">
        {clips.map((w, i) => (
          <span key={i} className={`flex items-center gap-[3px] overflow-hidden rounded-md px-1.5 ${i === 2 ? "border border-dashed border-[#ff6b8b] bg-[#ff6b8b]/20" : "bg-white/15"}`} style={{ width: `${w}%` }}>
            {Array.from({ length: 26 }, (_, j) => (
              <span key={j} className="w-[3px] shrink-0 rounded-sm bg-white/50" style={{ height: 6 + ((j * 7 + i * 5) % 19) }} />
            ))}
          </span>
        ))}
      </div>
      <div className="flex h-4 gap-1">
        {[11, 9, 13, 8, 12, 10, 9, 12, 11].map((w, i) => (
          <span key={i} className="rounded bg-neon-mint/50" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
