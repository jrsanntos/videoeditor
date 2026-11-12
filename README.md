# videoeditor

Editor de vídeo web em que **a IA faz a edição e o usuário dirige**. O usuário envia o vídeo bruto, descreve o que quer ("tire os silêncios, dê zoom nas ênfases, crie um gráfico quando eu citar números") e um agente monta a timeline. Depois, ajusta o que quiser manualmente — sem gastar créditos — ou seleciona um trecho e pede uma intervenção pontual à IA.

Público inicial: quem ganha dinheiro com vídeo falado (VSLs, aulas, infoprodutos, profissionais liberais).

## Princípio: State-First, Render-Last

A IA nunca renderiza pixels. Ela edita um **JSON de timeline**; o navegador do usuário desenha o preview em tempo real e, na maior parte dos casos, também exporta o arquivo final. Servidor pesado só entra quando o usuário pede render na nuvem.

```
vídeo bruto ──► navegador (IndexedDB)            áudio 16 kHz ──► transcrição
                     │                                               │
                     ▼                                               ▼
   UI manual ──► operações ──► Timeline State (JSON) ◄── operações ◄── agente (Claude)
                                      │
                         renderFrame(estado, t)  ← um único renderizador (Canvas 2D)
                          │                 │
                    preview (rAF)     export WebCodecs (MP4)     [futuro: render em nuvem]
```

Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Plano de execução em [docs/ROADMAP.md](docs/ROADMAP.md). Especificação da versão 1.0 em [docs/V1_SPEC.md](docs/V1_SPEC.md).

## Estrutura

| Caminho | O que é |
| --- | --- |
| `packages/core` | Schema do Timeline State (zod) e do Brand Kit, operações de edição ancoradas por palavra, mapeamento de tempo/transcrição, detecção de silêncio e de takes ruins, skills (presets de nicho), tabela de créditos e planos, contexto compacto para o agente. Sem dependência de DOM. |
| `packages/renderer` | `renderFrame` (compositor Canvas 2D), legendas e a biblioteca de componentes de motion design paramétricos. |
| `apps/web` | Next.js: editor (player, timeline, chat, inspetor), exportação local via WebCodecs, contas, painel de administração (`/admin`) e planos e créditos (`/planos`) e as rotas `/api/agent`, `/api/transcribe`, `/api/auth/*`, `/api/billing/*`, `/api/stripe/webhook` e `/api/admin/*`. |
| `apps/web/src/server` | Camada de servidor: banco Postgres (migrações em `schema.ts`), sessões, recuperação de senha, limite de requisições, ledger de créditos, cobrança pelo Stripe, custo de IA, configurações cifradas e modelos de edição. |

## Rodando

Requer Node 22+, pnpm 10+ e um Postgres 14+ (o `docker-compose.yml` sobe um local).

```bash
docker compose up -d
```

```bash
pnpm install
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

```bash
pnpm dev
```

Abra http://localhost:3000. Variáveis em `apps/web/.env.local`:

| Variável | Para quê | Sem ela |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` (ou `VIDEOEDITOR_ANTHROPIC_KEY`) | Agente de edição (chat) | Chat responde que não está configurado; todo o resto funciona |
| `AGENT_MODEL` | Modelo do agente (padrão `claude-sonnet-5-5`) | — |
| `GROQ_API_KEY` | Transcrição com timestamp por palavra (Whisper) | Sem legendas e sem cortes baseados na fala |

Na primeira execução, crie uma conta em http://localhost:3000/login. Em desenvolvimento, sem `ADMIN_EMAILS`, a primeira conta vira administradora e acessa `/admin`, onde as chaves de API também podem ser cadastradas (cifradas no banco, com prioridade sobre o `.env.local`). Em produção, defina `ADMIN_EMAILS` e `APP_SECRET`.

| Variável | Para quê |
| --- | --- |
| `ADMIN_EMAILS` | E-mails que viram admin (em produção, a única forma) |
| `APP_SECRET` | Cifra das chaves de API salvas pelo painel |
| `DATABASE_URL` | Conexão com o Postgres (obrigatória). As tabelas são criadas na primeira requisição. |
| `DATABASE_POOL_MAX` | Conexões por instância (padrão 10) |
| `APP_URL` | Endereço público, para links de e-mail e retornos do Stripe (obrigatória em produção) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Envio do e-mail de recuperação de senha. Sem elas, em desenvolvimento o link sai no terminal |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CREATOR`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TOPUP` | Cobrança. Sem elas, `/planos` mostra os planos como "em breve" |

### Configurando o Stripe

1. Crie três preços em BRL: dois recorrentes mensais (Creator R$ 127, Pro R$ 347) e um avulso (pacote de 500 créditos, R$ 79). Copie os ids `price_…` para as variáveis acima (ou para o painel `/admin`).
2. Crie um endpoint de webhook para `{APP_URL}/api/stripe/webhook` com os eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.created`, `customer.subscription.updated` e `customer.subscription.deleted`. Copie o segredo `whsec_…`.
3. Ative o Portal do Cliente com os dois planos como produtos permitidos para troca. Para o upgrade liberar os créditos do plano maior na hora, configure a troca para cobrar a diferença imediatamente.
4. Os meios de pagamento (cartão, Pix no pacote avulso, boleto) são os habilitados no Dashboard.

Em desenvolvimento: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Sem nenhuma chave já funcionam: upload, preview, edição manual na timeline, remoção de silêncios (análise de áudio local), zooms, componentes de motion e exportação MP4 no navegador.

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Estado atual

Funciona e foi verificado de ponta a ponta em Chromium: upload → remoção local de silêncios → split/corte de trecho/undo → componentes e zoom → reprodução através dos cortes → persistência após recarregar → legendas → exportação H.264 no navegador.

O fluxo com IA foi exercitado com as APIs reais (Groq e Claude) num vídeo com erros de gravação propositais: transcrição com áudio comprimido, limpeza local de takes ruins, skill "Autoridade" com resposta em streaming e cortes corretos de frase refeita, aviso de erro e fala para a equipe.

Contas, limite de requisições, recuperação de senha, renovação mensal e os webhooks de cobrança foram verificados contra um Postgres 16 real, com a API do Stripe simulada (eventos assinados, repetidos e fora de ordem).

Implementado mas **ainda não exercitado contra as APIs reais** (faltavam chaves no ambiente de desenvolvimento): o Checkout/Portal do Stripe e o envio de e-mail pelo Resend.

Ainda não existe: projetos e armazenamento em nuvem, render em nuvem. Ver o roadmap.
