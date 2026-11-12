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

Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Plano de execução em [docs/ROADMAP.md](docs/ROADMAP.md).

## Estrutura

| Caminho | O que é |
| --- | --- |
| `packages/core` | Schema do Timeline State (zod), operações de edição, mapeamento de tempo/transcrição, detecção de silêncio, tabela de créditos e planos, contexto compacto para o agente. Sem dependência de DOM. |
| `packages/renderer` | `renderFrame` (compositor Canvas 2D), legendas e a biblioteca de componentes de motion design paramétricos. |
| `apps/web` | Next.js: editor (player, timeline, chat, inspetor), exportação local via WebCodecs e as rotas `/api/agent` e `/api/transcribe`. |

## Rodando

Requer Node 22+ e pnpm 10+.

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
| `ANTHROPIC_API_KEY` | Agente de edição (chat) | Chat responde que não está configurado; todo o resto funciona |
| `AGENT_MODEL` | Modelo do agente (padrão `claude-sonnet-5-5`) | — |
| `GROQ_API_KEY` | Transcrição com timestamp por palavra (Whisper) | Sem legendas e sem cortes baseados na fala |

Sem nenhuma chave já funcionam: upload, preview, edição manual na timeline, remoção de silêncios (análise de áudio local), zooms, componentes de motion e exportação MP4 no navegador.

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Estado atual

Funciona e foi verificado de ponta a ponta em Chromium: upload → remoção local de silêncios → split/corte de trecho/undo → componentes e zoom → reprodução através dos cortes → persistência após recarregar → legendas → exportação H.264 no navegador.

Implementado mas **ainda não exercitado contra as APIs reais** (faltavam chaves no ambiente de desenvolvimento): o loop do agente em `/api/agent` e a transcrição em `/api/transcribe`.

Ainda não existe: contas/autenticação, cobrança, armazenamento em nuvem, render em nuvem. A carteira de créditos exibida é local e serve só para demonstrar o fluxo. Ver o roadmap.
