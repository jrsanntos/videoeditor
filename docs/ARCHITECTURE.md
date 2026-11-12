# Arquitetura

## 1. A regra que sustenta a margem

**Desacoplar a decisão de edição (inteligência) do processamento de pixels (render).** Cada comando ao agente altera um JSON; nenhum comando dispara render no servidor. Isso divide o custo em três camadas:

| Camada | Onde roda | Custo de nuvem |
| --- | --- | --- |
| Ingestão: metadados, áudio leve, transcrição | Navegador + API de transcrição | Centavos por vídeo |
| Edição e preview em tempo real | Navegador do usuário | Zero |
| Render final | Navegador (WebCodecs) ou nuvem sob demanda | Zero, ou pago em créditos |

## 2. Timeline State (`packages/core/src/schema.ts`)

Um `Project` é um documento JSON versionado:

- `assets` — mídias de origem, cada uma com sua `transcript` (palavras em tempo de **origem**).
- `tracks` — três tipos:
  - `main`: o vídeo falado. Magnética (sem buracos), só clips `media` (`assetId`, `sourceStart`, `duration`).
  - `fx`: clips `zoom` aplicados ao vídeo principal.
  - `overlay`: clips `component` (motion design), `{ component, params }`.
- `captions` — liga/desliga e estilo. As legendas não são clips: são **derivadas** da transcrição projetada pelos clips da trilha principal. Cortar um trecho remove automaticamente suas palavras da legenda e do contexto do agente.

Tempos em segundos, arredondados a milissegundos.

## 3. Operações (`packages/core/src/ops.ts`)

A única forma de mudar um projeto é `applyOperations(project, ops)`. A UI manual e o agente usam exatamente o mesmo vocabulário:

`remove_ranges` · `cut_words` · `remove_retakes` · `remove_silences` · `split` · `delete_clip` · `trim_clip` · `add_zoom` · `add_component` · `update_clip` · `set_captions` · `edit_word` · `set_brand`

Propriedades que importam:

- **Validadas** por zod antes de aplicar; params de componentes validados contra o catálogo.
- **Puras e atômicas**: não mutam a entrada; se uma falha, nada é aplicado e o erro traz o índice. É o que permite devolver o erro ao agente para ele se corrigir, e o que dá undo/redo de graça (o histórico é uma pilha de projetos).
- **Ripple em todas as trilhas**: um corte desloca e apara zooms e overlays junto com a fala.
- **Âncoras por palavra**: cortes (`cut_words`), zooms e componentes (`atWord`/`untilWord`, e `atWord` dentro dos params) referenciam ids de palavra, que apontam para instantes do vídeo bruto e não mudam com cortes. O core traduz para tempo de timeline ao aplicar. A UI manual usa tempo de timeline (é o que o usuário arrasta); o agente recebe um subconjunto do vocabulário (`AgentOperationSchema`) em que tempo de timeline não existe. Consequências: a ordem das operações não importa, um corte nunca come sílaba (cai no intervalo entre palavras) e repetir um corte não faz nada.
- **Takes ruins** (`retakes.ts`): `findRetakes` acha frase recomeçada, gaguejo, palavra truncada e aviso de erro ("errei", "vou falar de novo"), cada um com o corte exato e confiança alta ou media. `remove_retakes` corta os de confiança alta sem IA.
- **Determinísticas quando possível**: `remove_silences` é calculado em código a partir das pausas da transcrição; o modelo só decide os parâmetros. Trabalho mecânico não gasta raciocínio do LLM.

## 4. Renderizador único (`packages/renderer`)

`renderFrame(ctx, project, t, getFrame, options)` desenha o quadro do instante `t` em um Canvas 2D: vídeo de origem pela câmera virtual → componentes → legendas. É função pura de (estado, tempo, frame de origem).

- **Formato**: `project.aspectRatio` é `9:16` (1080×1920, padrão) ou `16:9`. O vídeo de origem sempre preenche o quadro; `project.framing` escolhe a parte visível quando há recorte. `safeArea(project)` dá as margens que legendas e componentes respeitam (no vertical, a interface dos apps embaixo e à direita). A unidade de layout `u` vale 1px quando o lado menor tem 1080.
- **Câmera** (`camera.ts`): `cameraAt` devolve o retângulo onde o vídeo é desenhado. Um clip de zoom tem escala, ponto focal, `panX`/`panY` e modo `hold` (entra, segura, sai) ou `creep` (avanço contínuo). O resultado é preso às bordas, então nunca aparece faixa preta. A velocidade entre dois quadros decide o motion blur: `ctx.filter` onde existe, senão um rastro de três amostras.
- **Curvas** (`draw.ts`): `cubicBezier` e as curvas da casa (`EASE.snap`, `swift`, `glide`). `enter()` aplica deslocamento, opacidade e desfoque proporcional à velocidade na entrada de elementos.
- **Tipografia** (`text.ts`): `layoutRich`/`drawRich` medem palavra a palavra e misturam a sem serifa com a serifada itálica nas palavras marcadas com `*asteriscos*`; `typewriter` dá o texto digitado com cursor. As fontes vêm do par do Brand Kit, carregadas pela FontFace API a partir de `public/fonts`.
- **Texto atrás da pessoa**: o compositor monta o recorte do apresentador (vídeo × máscara) numa tela auxiliar e o componente o redesenha por cima do texto. A máscara vem de `options.getPersonMask`, pedida só enquanto um componente com `needsPerson` está na tela. No navegador ela é do MediaPipe Selfie Segmentation (modelo e WASM servidos pela aplicação), com cache por quadro de origem. Sem máscara, o título vai para cima da cabeça.
- **Som** (`sounds.ts`): `soundEvents(project)` deriva do estado os efeitos, usando o catálogo de `apps/web/public/sfx` (`SFX_CATALOG`: arquivo, nível relativo à voz, onde o pico cai em relação ao evento visual e intervalo mínimo entre usos). Whoosh em movimento rápido de câmera, punch no punch-in seco, digitação enquanto um texto é escrito, pop e clique nos itens de lista, impacto grave na entrada de cenas de tela cheia, caixa registradora em valores em dinheiro. As regras de densidade do catálogo são aplicadas em código: o mais forte ganha quando dois picos caem a menos de 0,15 s. O preview dispara os eventos pelo relógio da timeline; a exportação agenda os mesmos eventos na mixagem. Se um arquivo não carrega, entra um timbre sintetizado equivalente.

O mesmo código serve:

- **Preview**: um `<video>` oculto fornece os quadros; o canvas é redesenhado a cada `requestAnimationFrame`. O relógio da timeline segue o relógio do vídeo, então o áudio está sempre em sincronia; nos cortes o vídeo faz seek para o próximo `sourceStart`.
- **Exportação local** (`apps/web/src/lib/export.ts`): Mediabunny decodifica os quadros de origem, `renderFrame` compõe em um `OffscreenCanvas`, WebCodecs codifica H.264 (fallback VP9) e o áudio é remontado por `OfflineAudioContext` seguindo os cortes. Zero servidor.
- **Render em nuvem** (futuro): o mesmo bundle em Chromium headless ou canvas em Node.

### Por que Canvas 2D próprio e não Remotion Player

Remotion renderiza DOM/React, e DOM não vira vídeo no navegador do cliente sem um Chromium no servidor — o que mataria a exportação local gratuita, uma das travas de caixa do modelo. Além disso, a licença do Remotion é paga para empresas acima de três pessoas. Com Canvas 2D, preview e export são literalmente a mesma função. O custo é que componentes são escritos como funções de desenho em vez de JSX/CSS; para uma biblioteca paramétrica fechada isso é aceitável.

## 5. Biblioteca de componentes (`packages/renderer/src/components`)

Componentes são funções puras de (params, tempo) em Canvas 2D, com schema zod. O agente escolhe um id e preenche params; nunca escreve código de animação.

Os seis da v1.0 (`v1.ts`) são o catálogo do agente: `depth_hook_title`, `kinetic_pivot_card`, `step_progress`, `acronym_list`, `executive_lower_third` e `stat_counter`. Todos herdam cores, fontes e credencial do Brand Kit, respeitam as áreas seguras e declaram seus efeitos sonoros. As cenas de tela cheia usam o fundo topográfico (`background.ts`). Os componentes anteriores (`library.ts`) continuam válidos e aparecem só no menu manual.

## 6. Agente (`apps/web/src/app/api/agent/route.ts`)

- **Entrada**: projeto, pedido do usuário, seleção opcional, histórico curto.
- **Contexto** (`buildAgentContext`): Brand Kit, zooms e componentes existentes (localizados pelas palavras que cobrem) e a transcrição em frases curtas no formato `[w10–w17 | início–fim no vídeo bruto] texto`, com pausas anotadas e a lista de **takes ruins detectados** já com o corte pronto. Com **seleção ativa** vão só as palavras daquele trecho, uma por linha — a "intervenção cirúrgica" que reduz tokens em ordens de grandeza.
- **Ferramentas**: `edit_timeline({ operations })` altera, só com ids de palavra e de clip; `read_words({ fromWord, toWord })` lê palavra por palavra um trecho, já sem o que foi cortado. O servidor aplica em uma cópia do projeto; erro volta como `tool_result` com `is_error` para o modelo corrigir. Máximo de 8 voltas.
- **Prioridade do prompt**: limpar a fala (takes ruins, frases refeitas, falas para a equipe) antes de qualquer efeito.
- **Streaming**: a resposta é NDJSON. Cada chamada de `edit_timeline` aplicada vira um evento `ops` com o projeto atualizado, e o navegador troca a timeline na hora; `status` descreve o que o agente está fazendo; `done` traz a mensagem final e a cobrança. O pedido inteiro é um único passo de undo. Se o usuário fecha a aba, a chamada ao modelo é cancelada.
- **Skills** (`packages/core/src/skills.ts`): Viral, Autoridade, VSL e Limpeza. Cada uma tem uma parte determinística aplicada no navegador sem custo (takes ruins de alta confiança, silêncios, estilo de legenda) e uma direção em texto enviada ao agente.
- **Instantes internos**: componentes podem ter `at` (segundos desde o início do clip, ex.: quando cada barra do gráfico sobe). O agente manda `atWord`; cortes posteriores dentro do componente deslocam esses instantes junto com a fala (`shiftTimedParams`).
- Prompt de sistema (instruções + catálogo) é estável e marcado para cache.
- **Dois modelos**: edição completa usa `AGENT_MODEL` (padrão `claude-sonnet-5-5`, com raciocínio estendido); ajuste pontual usa `AGENT_MODEL_FAST` (padrão `claude-haiku-5-5`), cerca de 30 vezes mais barato por comando nas medições.

## 7. Ingestão e transcrição

No MVP o vídeo bruto **não sobe**: fica em IndexedDB e é lido por object URL. O navegador decodifica o áudio para mono 16 kHz, que serve a duas coisas:

1. **Remoção local de silêncios** (`silencesFromAudio`, RMS por janela) — sem transcrição, sem nuvem, 0 créditos.
2. **Transcrição**: o áudio é codificado em Opus mono a 32 kbps (WebM, ~0,2 MB por minuto; WAV como fallback) e vai para `/api/transcribe` → Groq Whisper com timestamp por palavra.

Limitações conhecidas desta abordagem, tratadas no roadmap: `decodeAudioData` carrega o arquivo inteiro na memória (arquivos de vários GB falham). A solução é o proxy de ingestão (extração de áudio em streaming + proxy 720p).

## 8. Créditos (`packages/core/src/credits.ts`)

Moeda interna única. Tudo que roda no navegador custa 0 — inclusive desenhar componentes, zooms e tarjas; cobram inteligência, mídia generativa e render em nuvem. A tabela segue o custo real medido por chamada:

| Ação | Créditos | Custo real medido (vídeo de 37 s) |
| --- | --- | --- |
| Transcrição | 1 por minuto | R$ 0,002 |
| Edição completa (skill, modelo ou direção do vídeo inteiro) — modelo principal | 12 + 3 por minuto | R$ 0,19 a 0,31 |
| Ajuste pontual no chat — modelo rápido | 1 | R$ 0,004 a 0,009 |

`agentTier(mensagem, temSeleção)` classifica o pedido de forma determinística e roda igual no navegador e no servidor: o chat mostra o preço antes de enviar e é esse o valor cobrado. Só há cobrança quando a timeline muda. Um Reel de até 1 minuto, do bruto ao pronto, sai por 20 a 28 créditos; `videosEstimate` transforma um saldo em "quantos vídeos" para a tela de planos.

Planos: o Free recebe 60 créditos uma única vez, no cadastro (saldo extra, não renova), aceita vídeos de até 3 minutos e exporta em 720p com marca d'água. Creator e Pro recebem créditos mensais que não acumulam. Brand Kits salvos: 1 no Free e no Creator, 10 no Pro. Saldos aceitam uma casa decimal.

O saldo vive no servidor, num ledger (`credit_ledger`): cada cadastro, concessão, renovação e cobrança é uma linha que nunca é sobrescrita. O saldo é materializado em `users` (lido em O(1), alterado sempre na mesma transação do ledger, com bloqueio de linha) e dividido em dois: créditos **do plano**, que não acumulam e voltam ao valor mensal a cada renovação, e créditos **extras** (pacotes avulsos e concessões), que sobrevivem às renovações. O consumo sai primeiro do plano. As rotas pagas conferem o saldo antes de chamar o provedor (`assertCredits`) e cobram depois do resultado (`charge`); o agente confere de novo antes de cada cena de motion, para nunca passar do saldo. Cada chamada de IA grava o custo real (tokens, segundos de áudio) em `usage_events`, que alimenta o financeiro.

## 9. Contas, painel de administração e modelos

- **Banco**: Postgres (`pg`, pool por instância). `server/db.ts` expõe `db.query/one/run` e `tx(fn)`; dentro de `tx`, tudo que é chamado participa da transação (AsyncLocalStorage), sem repassar conexão. O schema vive em `server/schema.ts` como migrações numeradas, aplicadas na primeira consulta do processo sob advisory lock. Tipos nativos: `timestamptz`, `numeric` para dinheiro, `jsonb` para modelos e auditoria, chaves `bigint identity`, índices únicos parciais para idempotência.
- **Limite de requisições** (`server/ratelimit.ts`): janela fixa com contador numa tabela `UNLOGGED`, um upsert atômico por checagem, válido para todas as instâncias. Login: 20 tentativas/15 min por IP e 8/15 min por conta; cadastro: 5/h por IP; recuperação de senha: 10/h por IP e 3/h por conta. Estouro responde 429 com `Retry-After`.
- **Recuperação de senha**: `/recuperar-senha` gera um token aleatório de uso único (1 h; só o hash vai ao banco) e envia o link por e-mail (`server/email.ts`, Resend). A resposta é idêntica exista ou não a conta. Redefinir a senha encerra todas as sessões.
- **Cobrança** (`server/stripe.ts`): Checkout para assinar e para o pacote avulso, Portal do Cliente para trocar de plano/cartão e cancelar. O banco só muda por webhook, a partir do estado atual lido da API do Stripe (a ordem dos eventos não é garantida), com idempotência em três níveis: id do evento, referência única da fatura no ledger e nos pagamentos. Fatura paga de novo ciclo repõe os créditos do plano; upgrade pago completa a diferença; assinatura encerrada devolve a conta ao Free.
- **Renovação mensal**: assinantes renovam pela fatura paga. Quem não tem assinatura (Free, ou plano definido à mão pelo admin) renova sob demanda, na primeira requisição depois do vencimento, sem cron.
- **Contas**: e-mail e senha (scrypt assíncrono), sessão em cookie httpOnly com token aleatório (só o hash fica no banco). Contas suspensas perdem as sessões na hora e não entram de novo. Admins vêm de `ADMIN_EMAILS`; em desenvolvimento, sem essa variável, a primeira conta vira admin.
- **Painel `/admin`**: visão geral (usuários, ativos, receita, resultado, auditoria), usuários (busca, créditos, plano com pagamento, papel, banimento, extrato e uso de IA), financeiro (receitas e despesas lançadas, custo de IA automático convertido pela cotação, série de 12 meses), chaves de API (cifradas com AES-256-GCM usando `APP_SECRET`; têm prioridade sobre o ambiente) e modelos. Toda ação vai para `admin_log`.
- **Modelos de edição** (`EditTemplate`, em `packages/core/src/template.ts`): o admin envia um vídeo de exemplo já editado; o navegador extrai 12 quadros, o áudio e as pausas (o vídeo não sobe), o servidor transcreve e pede ao Claude, com saída estruturada, o estilo como modelo (legendas, política de pausas, densidade de zoom, componentes e gatilhos, receita). O admin revisa e publica. No editor, aplicar um modelo roda a parte determinística no navegador (legendas, 0 crédito) e manda a receita ao agente.
