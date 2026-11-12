import { PLANS, SIGNUP_CREDITS, SKILLS, TOPUPS, videosEstimate, type PlanId, type SkillId } from "@videoeditor/core";
import { Icon, Logo } from "./icons";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const videos = (credits: number) => {
  const { min, max } = videosEstimate(credits);
  return min === max ? String(max) : `${min} a ${max}`;
};

const section = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-300";
const h2 = "mt-3 text-3xl font-semibold tracking-tight text-white sm:text-[40px] sm:leading-[1.1]";
const lead = "mt-4 max-w-2xl text-[16px] leading-relaxed text-zinc-400";

const STEPS = [
  { icon: Icon.film, title: "Envie o vídeo bruto", text: "Arraste o arquivo gravado no celular ou na câmera. Ele fica no seu navegador: o vídeo original não sobe para nenhum servidor." },
  { icon: Icon.sparkles, title: "A IA dirige a edição", text: "Ela limpa a fala, entende do que o vídeo trata, planeja o ritmo do gancho ao fecho e monta zooms, legendas e motion design." },
  { icon: Icon.download, title: "Ajuste e exporte", text: "Mude o que quiser na timeline ou direto no vídeo, sem gastar créditos, e exporte em MP4 pelo próprio navegador." },
];

const FEATURES = [
  { icon: Icon.wand, title: "Limpeza automática", text: "Erros de gravação, recomeços e pausas longas saem em um clique. A fala fica contínua e natural." },
  { icon: Icon.captions, title: "Legendas que você controla", text: "Geradas da sua fala, aparecem na timeline: reescreva, mova, esconda ou arraste no vídeo." },
  { icon: Icon.zoomIn, title: "Câmera virtual", text: "Punch-ins, avanços lentos e pans fechados no seu rosto, na palavra em que a voz enfatiza." },
  { icon: Icon.layers, title: "Motion design pronto", text: "Título de gancho com profundidade, listas, números animados e cartões cinéticos nas cores da sua marca." },
  { icon: Icon.palette, title: "Sua marca em todo vídeo", text: "Cores, fontes, nome e credencial definidos uma vez. Cada vídeo novo já nasce com a sua identidade." },
  { icon: Icon.scissors, title: "Timeline de editor profissional", text: "Selecione um trecho e corte, divida num clique, desfaça à vontade. Edição manual é sempre gratuita." },
];

const DIRECTOR = [
  { step: "1", title: "Assiste", text: "Lê a fala inteira, mede a força da voz em cada palavra e vê onde você está no quadro." },
  { step: "2", title: "Planeja", text: "Divide o vídeo em capítulos — gancho, desenvolvimento, virada, fecho — com um orçamento de efeitos para cada um." },
  { step: "3", title: "Executa", text: "Corta, enquadra e anima seguindo o plano, com cada elemento entrando na palavra exata." },
  { step: "4", title: "Revisa", text: "Audita o próprio resultado: nada de efeitos empilhados, trechos parados demais ou texto sobre o seu rosto." },
];

const FAQ = [
  {
    q: "Preciso saber editar vídeo?",
    a: "Não. Você envia o vídeo, clica em Limpeza automática e escolhe um estilo de edição. Se quiser mexer em algo, é só clicar no bloco na timeline ou arrastar o texto no próprio vídeo.",
  },
  {
    q: "O meu vídeo é enviado para algum servidor?",
    a: "O arquivo de vídeo fica no seu navegador. Só o áudio comprimido sobe para a transcrição, e a IA trabalha com o texto da fala e alguns quadros em baixa resolução para entender o enquadramento.",
  },
  {
    q: "Como funcionam os créditos?",
    a: `Créditos pagam o que usa inteligência artificial: transcrição, edição completa e ajustes por texto. Tudo que você faz à mão na timeline e a exportação no navegador são gratuitos. Um vídeo curto, do bruto ao pronto, costuma gastar de 20 a 28 créditos.`,
  },
  {
    q: "Posso testar sem pagar?",
    a: `Sim. Ao criar a conta você ganha ${SIGNUP_CREDITS} créditos, sem cartão — o suficiente para editar seus primeiros vídeos e ver o resultado.`,
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

const SKILL_ICON: Record<SkillId, typeof Icon.bolt> = { viral: Icon.bolt, autoridade: Icon.shield, vsl: Icon.chart, limpeza: Icon.wand };

/** Página inicial pública: apresentação, como funciona, recursos, planos e perguntas frequentes. */
export function Landing({ loggedIn }: { loggedIn: boolean }) {
  const cta = loggedIn ? { href: "/app", label: "Abrir o editor" } : { href: "/login?modo=cadastro", label: "Começar grátis" };
  return (
    <div className="min-h-screen overflow-x-hidden bg-ink-950 text-zinc-200">
      <header className="sticky top-0 z-40 border-b border-line bg-ink-950/75 backdrop-blur-xl">
        <nav className={`${section} flex h-16 items-center gap-8`} aria-label="Principal">
          <a href="/" aria-label="videoeditor — página inicial">
            <Logo />
          </a>
          <div className="hidden items-center gap-7 text-[13.5px] text-zinc-400 md:flex">
            <a href="#como-funciona" className="transition hover:text-white">
              Como funciona
            </a>
            <a href="#recursos" className="transition hover:text-white">
              Recursos
            </a>
            <a href="#diretor" className="transition hover:text-white">
              Diretor de IA
            </a>
            <a href="#planos" className="transition hover:text-white">
              Planos
            </a>
            <a href="#duvidas" className="transition hover:text-white">
              Dúvidas
            </a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!loggedIn && (
              <a href="/login" className="hidden rounded-lg px-3 py-2 text-[13.5px] text-zinc-300 transition hover:text-white sm:block">
                Entrar
              </a>
            )}
            <a href={cta.href} className="btn-brand rounded-lg px-4 py-2 text-[13.5px] font-semibold" data-testid="nav-cta">
              {cta.label}
            </a>
          </div>
        </nav>
      </header>

      <main>
        {/* Abertura */}
        <section className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(ellipse_60%_55%_at_50%_0%,rgba(124,99,255,0.28),transparent_70%)]" />
          <div className={`${section} relative pb-10 pt-16 text-center sm:pt-24`}>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3.5 py-1.5 text-[12.5px] font-medium text-brand-300">
              <Icon.sparkles size={13} /> Edição de vídeo falado com IA
            </span>
            <h1 className="mx-auto mt-6 max-w-4xl text-[40px] font-semibold leading-[1.05] tracking-tight text-white sm:text-[68px]">
              Grave. Envie. <span className="text-gradient">A IA dirige a edição.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-zinc-400 sm:text-[19px]">
              Do vídeo bruto ao vídeo pronto para publicar: cortes, zooms, legendas e motion design montados a partir da sua fala. Você revisa, ajusta o que quiser e exporta.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={cta.href} className="btn-brand rounded-xl px-7 py-3.5 text-[15px] font-semibold" data-testid="hero-cta">
                {cta.label}
              </a>
              <a href="#como-funciona" className="rounded-xl border border-line-strong px-7 py-3.5 text-[15px] font-medium text-zinc-200 transition hover:bg-white/5">
                Ver como funciona
              </a>
            </div>
            {!loggedIn && <p className="mt-4 text-[13px] text-zinc-500">{SIGNUP_CREDITS} créditos de boas-vindas · sem cartão de crédito</p>}
          </div>
          <div className={`${section} relative pb-20`}>
            <ProductMock />
          </div>
        </section>

        {/* Garantias objetivas */}
        <section className="border-y border-line bg-white/[0.015]">
          <ul className={`${section} grid gap-6 py-8 text-[13.5px] text-zinc-300 sm:grid-cols-2 lg:grid-cols-4`}>
            {[
              { icon: Icon.shield, text: "O vídeo original fica no seu navegador" },
              { icon: Icon.download, text: "Exportação gratuita, sem fila de render" },
              { icon: Icon.scissors, text: "Edição manual sem gastar créditos" },
              { icon: Icon.undo, text: "Tudo que a IA faz pode ser desfeito" },
            ].map((g) => (
              <li key={g.text} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-brand-300">
                  <g.icon size={17} />
                </span>
                {g.text}
              </li>
            ))}
          </ul>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className={`${section} scroll-mt-20 py-24`}>
          <p className={eyebrow}>Como funciona</p>
          <h2 className={h2}>Três passos entre gravar e publicar</h2>
          <p className={lead}>Sem linha do tempo vazia, sem tutorial de uma hora. O trabalho repetitivo fica com a IA; as decisões de gosto continuam com você.</p>
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="panel relative rounded-3xl p-7">
                <span className="absolute right-6 top-5 font-mono text-[44px] font-semibold leading-none text-white/[0.06]">{i + 1}</span>
                <span className="btn-brand flex h-11 w-11 items-center justify-center rounded-2xl">
                  <s.icon size={20} />
                </span>
                <h3 className="mt-5 text-[18px] font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-zinc-400">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Recursos */}
        <section id="recursos" className="scroll-mt-20 border-t border-line bg-white/[0.012] py-24">
          <div className={section}>
            <p className={eyebrow}>Recursos</p>
            <h2 className={h2}>Um editor completo, com a parte chata automatizada</h2>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <article key={f.title} className="panel rounded-3xl p-6 transition hover:border-brand-400/40">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/12 text-brand-300">
                    <f.icon size={19} />
                  </span>
                  <h3 className="mt-4 text-[16px] font-semibold text-white">{f.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-400">{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Diretor de IA */}
        <section id="diretor" className={`${section} scroll-mt-20 py-24`}>
          <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className={eyebrow}>Diretor de IA</p>
              <h2 className={h2}>Não joga efeitos. Edita com um plano.</h2>
              <p className={lead}>
                A diferença entre um vídeo profissional e um vídeo “com efeitos” é o ritmo: saber onde acelerar, onde limpar a tela e o que merece destaque. Por isso a nossa IA trabalha como um editor: assiste ao vídeo inteiro antes de
                mexer em qualquer coisa.
              </p>
              <div className="mt-8">
                <p className="text-[13px] font-medium text-zinc-300">Escolha o estilo da edição automática:</p>
                <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  {(Object.keys(SKILLS) as SkillId[]).map((id) => {
                    const SkillIcon = SKILL_ICON[id];
                    return (
                      <li key={id} className="rounded-2xl border border-line bg-ink-900 p-4">
                        <span className="flex items-center gap-2 text-[14px] font-semibold text-white">
                          <SkillIcon size={15} className="text-brand-300" /> {SKILLS[id].name}
                        </span>
                        <span className="mt-1 block text-[12.5px] leading-snug text-zinc-400">{SKILLS[id].tagline}</span>
                        <span className="mt-1.5 block text-[11.5px] text-zinc-600">{SKILLS[id].audience}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            <ol className="relative space-y-4">
              {DIRECTOR.map((d) => (
                <li key={d.step} className="panel flex gap-5 rounded-3xl p-6">
                  <span className="text-gradient font-mono text-[34px] font-semibold leading-none">{d.step}</span>
                  <div>
                    <h3 className="text-[17px] font-semibold text-white">{d.title}</h3>
                    <p className="mt-1.5 text-[14.5px] leading-relaxed text-zinc-400">{d.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="scroll-mt-20 border-t border-line bg-white/[0.012] py-24">
          <div className={section}>
            <div className="text-center">
              <p className={eyebrow}>Planos</p>
              <h2 className={`${h2} mx-auto`}>Comece grátis. Pague quando fizer sentido.</h2>
              <p className={`${lead} mx-auto`}>Créditos pagam só o que usa IA. Edição manual e exportação no navegador são gratuitas em todos os planos.</p>
            </div>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {(Object.keys(PLANS) as PlanId[]).map((id) => {
                const plan = PLANS[id];
                const featured = id === "creator";
                return (
                  <div key={id} className={`relative flex flex-col rounded-3xl p-7 ${featured ? "border border-brand-400/60 bg-gradient-to-b from-brand-500/15 to-transparent shadow-[0_30px_80px_-30px_rgba(124,99,255,0.6)]" : "panel"}`}>
                    {featured && <span className="btn-brand absolute -top-3 left-7 rounded-full px-3 py-1 text-[11px] font-semibold">Recomendado para criadores</span>}
                    <h3 className="text-[16px] font-semibold text-white">{plan.name}</h3>
                    <p className="mt-3 flex items-baseline gap-1">
                      <span className="text-[40px] font-semibold tracking-tight text-white">{plan.priceBRL ? brl(plan.priceBRL) : "Grátis"}</span>
                      {plan.priceBRL > 0 && <span className="text-sm text-zinc-500">/mês</span>}
                    </p>
                    <p className="mt-1 text-[13px] text-zinc-400">
                      {id === "free" ? `${SIGNUP_CREDITS} créditos de boas-vindas: ${videos(SIGNUP_CREDITS)} vídeos curtos para testar` : `${plan.monthlyCredits.toLocaleString("pt-BR")} créditos por mês: cerca de ${videos(plan.monthlyCredits)} vídeos curtos`}
                    </p>
                    <ul className="mt-6 flex-1 space-y-2.5 text-[14px] text-zinc-300">
                      {[
                        `Vídeos de até ${plan.maxUploadMinutes} minutos`,
                        `Exportação em ${plan.maxExportHeight >= 2160 ? "4K" : plan.maxExportHeight >= 1080 ? "Full HD (1080p)" : "HD (720p)"}`,
                        plan.watermark ? "Com marca d'água" : "Sem marca d'água",
                        plan.brandKits === 1 ? "1 Brand Kit salvo" : `Até ${plan.brandKits} Brand Kits, um por cliente`,
                        "Edição manual e exportação ilimitadas",
                      ].map((item) => (
                        <li key={item} className="flex items-start gap-2.5">
                          <Icon.check size={16} className="mt-0.5 shrink-0 text-brand-300" /> {item}
                        </li>
                      ))}
                    </ul>
                    <a
                      href={loggedIn ? "/planos" : "/login?modo=cadastro"}
                      className={`mt-7 block rounded-xl px-4 py-3 text-center text-[14px] font-semibold transition ${featured ? "btn-brand" : "border border-line-strong text-zinc-100 hover:bg-white/5"}`}
                    >
                      {id === "free" ? (loggedIn ? "Ver meu plano" : "Criar conta grátis") : `Assinar ${plan.name}`}
                    </a>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-center text-[13px] text-zinc-500">
              Precisa de mais num mês? Pacote avulso de {TOPUPS[0].credits} créditos por {brl(TOPUPS[0].priceBRL)}: cerca de {videos(TOPUPS[0].credits)} vídeos curtos a mais.
            </p>
          </div>
        </section>

        {/* Perguntas frequentes */}
        <section id="duvidas" className={`${section} scroll-mt-20 py-24`}>
          <div className="mx-auto max-w-3xl">
            <p className={`${eyebrow} text-center`}>Dúvidas</p>
            <h2 className={`${h2} text-center`}>Perguntas frequentes</h2>
            <div className="mt-10 divide-y divide-line rounded-3xl border border-line bg-ink-900">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-medium text-white">
                    {f.q}
                    <Icon.chevron size={18} className="shrink-0 text-zinc-500 transition group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-400">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Chamada final */}
        <section className={`${section} pb-24`}>
          <div className="relative overflow-hidden rounded-[32px] border border-brand-400/30 bg-gradient-to-br from-brand-600/40 via-ink-900 to-sky-brand/20 px-6 py-16 text-center sm:px-16">
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[640px] -translate-x-1/2 rounded-full bg-brand-500/30 blur-3xl" />
            <h2 className="relative mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-[42px] sm:leading-[1.1]">Seu próximo vídeo pode sair editado ainda hoje</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-zinc-300">Envie um vídeo que já está gravado e veja a diferença antes de decidir qualquer coisa.</p>
            <a href={cta.href} className="btn-brand relative mt-8 inline-block rounded-xl px-8 py-4 text-[15px] font-semibold">
              {cta.label}
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${section} flex flex-col items-center justify-between gap-4 py-8 text-[13px] text-zinc-500 sm:flex-row`}>
          <Logo size={22} />
          <nav className="flex gap-6" aria-label="Rodapé">
            <a href="#recursos" className="hover:text-zinc-300">
              Recursos
            </a>
            <a href="#planos" className="hover:text-zinc-300">
              Planos
            </a>
            <a href="/login" className="hover:text-zinc-300">
              Entrar
            </a>
          </nav>
          <span>© {new Date().getFullYear()} videoeditor</span>
        </div>
      </footer>
    </div>
  );
}

/** Ilustração do editor: preview vertical com legenda, plano da IA e timeline. Não é uma captura de tela. */
function ProductMock() {
  const bars = [14, 22, 9, 26, 18, 30, 12, 24, 16, 28, 10, 20, 26, 14, 22, 8, 18, 30, 12, 24, 16, 20, 10, 26, 14, 28, 18, 22, 12, 24];
  return (
    <div className="relative mx-auto max-w-5xl" aria-hidden>
      <div className="absolute -inset-x-10 -bottom-10 top-10 rounded-[40px] bg-brand-500/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[22px] border border-line-strong bg-ink-900 shadow-[0_60px_140px_-40px_rgba(0,0,0,1)]">
        <div className="flex h-10 items-center gap-2 border-b border-line px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 text-[11px] text-zinc-500">meu-video — editor</span>
          <span className="btn-brand ml-auto rounded-md px-2.5 py-1 text-[10px] font-semibold">Exportar</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-0 sm:grid-cols-[180px_1fr_240px]">
          <div className="hidden space-y-2 border-r border-line p-3 sm:block">
            <div className="btn-brand rounded-lg p-2.5 text-left">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                <Icon.wand size={12} /> Limpeza automática
              </div>
              <div className="mt-1 h-1.5 w-4/5 rounded bg-white/40" />
              <div className="mt-1 h-1.5 w-3/5 rounded bg-white/25" />
            </div>
            {["Legendas no vídeo", "Tarja de nome e cargo", "Efeitos sonoros"].map((t, i) => (
              <div key={t} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-2 text-[10.5px] text-zinc-300">
                {t}
                <span className={`relative h-3.5 w-6 rounded-full ${i === 1 ? "bg-ink-600" : "bg-brand-500"}`}>
                  <span className={`absolute top-[2px] h-2.5 w-2.5 rounded-full bg-white ${i === 1 ? "left-[2px]" : "left-[12px]"}`} />
                </span>
              </div>
            ))}
          </div>
          <div className="stage-bg col-span-3 flex items-center justify-center py-7 sm:col-span-1">
            <div className="float-slow relative h-[300px] w-[169px] overflow-hidden rounded-2xl bg-gradient-to-b from-[#2a2440] via-[#1b1830] to-[#0f0d1c] ring-1 ring-white/15">
              <div className="absolute inset-x-0 top-[52px] text-center text-[40px] font-black leading-none tracking-tight text-white/90">3 ERROS</div>
              <div className="absolute left-1/2 top-[70px] h-[84px] w-[84px] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#e7c9b5] to-[#c79f88]" />
              <div className="absolute bottom-0 left-1/2 h-[150px] w-[150px] -translate-x-1/2 rounded-t-[70px] bg-gradient-to-b from-[#3b3663] to-[#25213f]" />
              <div className="absolute inset-x-0 bottom-[58px] text-center text-[15px] font-black uppercase tracking-tight">
                <span className="text-white [text-shadow:0_2px_0_#000]">que travam </span>
                <span className="text-[#facc15] [text-shadow:0_2px_0_#000]">suas vendas</span>
              </div>
              <div className="absolute bottom-[104px] left-3 rounded-md bg-ink-950/80 px-2 py-1.5">
                <div className="border-l-2 border-[#facc15] pl-1.5">
                  <div className="text-[9px] font-bold text-white">Dra. Ana Silva</div>
                  <div className="text-[8px] italic text-zinc-300">Consultora</div>
                </div>
              </div>
            </div>
          </div>
          <div className="hidden space-y-2 border-l border-line p-3 sm:block">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white">
              <Icon.sparkles size={12} className="text-brand-300" /> Diretor de IA
            </div>
            <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-2.5 text-[10px] leading-snug text-zinc-300">
              <div className="mb-1.5 font-semibold uppercase tracking-wide text-brand-300">Plano de edição</div>
              {[
                ["Gancho", "título gigante + punch-in"],
                ["Desenvolvimento", "lista lateral, câmera lenta"],
                ["Virada", "cartão de tela cheia"],
                ["Fecho", "destaque na chamada para ação"],
              ].map(([a, b]) => (
                <div key={a} className="mt-1 flex gap-1.5">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand-300" />
                  <span>
                    <b className="font-semibold text-white">{a}</b> — {b}
                  </span>
                </div>
              ))}
            </div>
            <div className="ml-6 rounded-xl rounded-br-sm bg-brand-600 px-2.5 py-1.5 text-[10px] text-white">Edite no estilo viral</div>
          </div>
        </div>
        <div className="space-y-1.5 border-t border-line p-3">
          <div className="relative h-5">
            <div className="absolute left-[4%] h-5 w-[14%] rounded-md border border-emerald-300/40 bg-emerald-400/20" />
            <div className="absolute left-[38%] h-5 w-[20%] rounded-md border border-emerald-300/40 bg-emerald-400/20" />
            <div className="absolute left-[74%] h-5 w-[16%] rounded-md border border-emerald-300/40 bg-emerald-400/20" />
          </div>
          <div className="relative h-5">
            {[2, 20, 31, 52, 63, 82].map((l) => (
              <div key={l} className="absolute h-5 w-[8%] rounded-md border border-amber-300/40 bg-amber-400/20" style={{ left: `${l}%` }} />
            ))}
          </div>
          <div className="flex h-9 gap-1">
            {[26, 18, 30, 26].map((w, i) => (
              <div key={i} className="flex items-end gap-[2px] overflow-hidden rounded-md border border-brand-400/40 bg-brand-500/25 px-1 pb-1" style={{ width: `${w}%` }}>
                {bars.map((b, j) => (
                  <span key={j} className="w-[3px] shrink-0 rounded-sm bg-brand-300/60" style={{ height: ((b + i * 5 + j) % 24) + 4 }} />
                ))}
              </div>
            ))}
          </div>
          <div className="flex h-4 gap-1">
            {[11, 9, 13, 8, 12, 10, 9, 12, 11].map((w, i) => (
              <div key={i} className="rounded border border-sky-400/40 bg-sky-400/15" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
