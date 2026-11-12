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

`remove_ranges` · `remove_silences` · `split` · `delete_clip` · `trim_clip` · `add_zoom` · `add_component` · `update_clip` · `set_captions` · `edit_word`

Propriedades que importam:

- **Validadas** por zod antes de aplicar; params de componentes validados contra o catálogo.
- **Puras e atômicas**: não mutam a entrada; se uma falha, nada é aplicado e o erro traz o índice. É o que permite devolver o erro ao agente para ele se corrigir, e o que dá undo/redo de graça (o histórico é uma pilha de projetos).
- **Ripple em todas as trilhas**: um corte desloca e apara zooms e overlays junto com a fala.
- **Determinísticas quando possível**: `remove_silences` é calculado em código a partir das pausas da transcrição; o modelo só decide os parâmetros. Trabalho mecânico não gasta raciocínio do LLM.

## 4. Renderizador único (`packages/renderer`)

`renderFrame(ctx, project, t, getFrame)` desenha o quadro do instante `t` em um Canvas 2D: vídeo de origem (com zoom) → componentes → legendas. É função pura de (estado, tempo, frame de origem).

O mesmo código serve:

- **Preview**: um `<video>` oculto fornece os quadros; o canvas é redesenhado a cada `requestAnimationFrame`. O relógio da timeline segue o relógio do vídeo, então o áudio está sempre em sincronia; nos cortes o vídeo faz seek para o próximo `sourceStart`.
- **Exportação local** (`apps/web/src/lib/export.ts`): Mediabunny decodifica os quadros de origem, `renderFrame` compõe em um `OffscreenCanvas`, WebCodecs codifica H.264 (fallback VP9) e o áudio é remontado por `OfflineAudioContext` seguindo os cortes. Zero servidor.
- **Render em nuvem** (futuro): o mesmo bundle em Chromium headless ou canvas em Node.

### Por que Canvas 2D próprio e não Remotion Player

Remotion renderiza DOM/React, e DOM não vira vídeo no navegador do cliente sem um Chromium no servidor — o que mataria a exportação local gratuita, uma das travas de caixa do modelo. Além disso, a licença do Remotion é paga para empresas acima de três pessoas. Com Canvas 2D, preview e export são literalmente a mesma função. O custo é que componentes são escritos como funções de desenho em vez de JSX/CSS; para uma biblioteca paramétrica fechada isso é aceitável.

## 5. Biblioteca de componentes (`packages/renderer/src/components/library.ts`)

Cada componente é `{ id, descrição, schema zod dos params, exemplo, draw(params, t) }`. O agente **escolhe um id e preenche params**; nunca escreve código de animação. Consequências: ~80% menos tokens por cena, zero bug visual gerado por LLM, e comandos comuns cabem em modelos mais baratos.

Hoje: `lower_third`, `title_card`, `bar_chart`, `counter`, `text_highlight`, `bullet_list`. Meta: 50–100. O catálogo enviado ao agente é gerado a partir dos próprios schemas (`catalogForAgent`), então adicionar um componente o expõe à IA, ao inspetor e à validação de uma vez.

## 6. Agente (`apps/web/src/app/api/agent/route.ts`)

- **Entrada**: projeto, pedido do usuário, seleção opcional, histórico curto.
- **Contexto** (`buildAgentContext`): lista de clips + transcrição em tempo de timeline. Vídeo inteiro vai como frases com tempo e pausas anotadas, mais as **repetições detectadas** (`findRepetitions`) com tempo por palavra e o intervalo de corte exato; com **seleção ativa** vão só os clips e palavras daquele trecho (com id e tempo por palavra) — é a "intervenção cirúrgica" que reduz tokens em ordens de grandeza.
- **Ferramentas**: `edit_timeline({ operations })` altera; `read_words({ start, end })` só lê o tempo por palavra de um trecho da timeline atual (já com os cortes da conversa), para cortes e sincronizações precisos sem mandar a transcrição inteira por palavra. O servidor aplica em uma cópia do projeto; erro volta como `tool_result` com `is_error` para o modelo corrigir. Máximo de 6 voltas.
- **Instantes internos**: componentes podem ter `at` (segundos desde o início do clip, ex.: quando cada barra do gráfico sobe). Cortes dentro do componente deslocam esses instantes junto com a fala (`shiftTimedParams`).
- **Saída**: projeto resultante, log legível das operações, custo em créditos. O cliente troca o projeto como um único passo de undo.
- Prompt de sistema (instruções + catálogo) é estável e marcado para cache.
- Modelo padrão `claude-sonnet-5-5`, configurável por `AGENT_MODEL` (ex.: `claude-haiku-5-5` para baratear comandos simples). Roteamento automático barato/caro por tipo de pedido está no roadmap.

## 7. Ingestão e transcrição

No MVP o vídeo bruto **não sobe**: fica em IndexedDB e é lido por object URL. O navegador decodifica o áudio para mono 16 kHz, que serve a duas coisas:

1. **Remoção local de silêncios** (`silencesFromAudio`, RMS por janela) — sem transcrição, sem nuvem, 0 créditos.
2. **Transcrição**: o WAV leve vai para `/api/transcribe` → Groq Whisper com timestamp por palavra.

Limitações conhecidas desta abordagem, tratadas no roadmap: `decodeAudioData` carrega o arquivo inteiro na memória (arquivos de vários GB falham) e o WAV passa de 25 MB perto de 13 minutos. A solução é o proxy de ingestão (extração de áudio em streaming + proxy 720p).

## 8. Créditos (`packages/core/src/credits.ts`)

Moeda interna única. Tudo que roda no navegador custa 0; cobram inteligência, mídia generativa e render em nuvem. A tabela de preços e os planos vivem em código, junto de `creditCost(action)`, para que servidor e UI usem a mesma fonte. O agente só cobra quando a timeline realmente mudou.

O saldo vive no servidor, num ledger (`credit_ledger`): cada cadastro, concessão, mudança de plano e cobrança é uma linha, e o saldo é a soma. As rotas pagas conferem o saldo antes de chamar o provedor (`assertCredits`) e cobram depois do resultado (`charge`); o agente confere de novo antes de cada cena de motion, para nunca passar do saldo. Cada chamada de IA grava o custo real (tokens, segundos de áudio) em `usage_events`, que alimenta o financeiro.

## 9. Contas, painel de administração e modelos

- **Banco**: SQLite embutido no Node (`node:sqlite`, sem dependência nativa) em `DATA_DIR` (padrão `apps/web/.data`). Todo acesso passa por `apps/web/src/server/*`, então migrar para Postgres é trocar essa camada.
- **Contas**: e-mail e senha (scrypt), sessão em cookie httpOnly com token aleatório (só o hash fica no banco). Contas suspensas perdem as sessões na hora e não entram de novo. Admins vêm de `ADMIN_EMAILS`; em desenvolvimento, sem essa variável, a primeira conta vira admin.
- **Painel `/admin`**: visão geral (usuários, ativos, receita, resultado, auditoria), usuários (busca, créditos, plano com pagamento, papel, banimento, extrato e uso de IA), financeiro (receitas e despesas lançadas, custo de IA automático convertido pela cotação, série de 12 meses), chaves de API (cifradas com AES-256-GCM usando `APP_SECRET`; têm prioridade sobre o ambiente) e modelos. Toda ação vai para `admin_log`.
- **Modelos de edição** (`EditTemplate`, em `packages/core/src/template.ts`): o admin envia um vídeo de exemplo já editado; o navegador extrai 12 quadros, o áudio e as pausas (o vídeo não sobe), o servidor transcreve e pede ao Claude, com saída estruturada, o estilo como modelo (legendas, política de pausas, densidade de zoom, componentes e gatilhos, receita). O admin revisa e publica. No editor, aplicar um modelo roda a parte determinística no navegador (legendas, 0 crédito) e manda a receita ao agente.
