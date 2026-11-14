# Roadmap

Ordem pensada para validar o produto com usuários reais o mais cedo possível e só então pagar por infraestrutura.

## Fase 0 — Fundação (feito)

- [x] Monorepo, Timeline State, operações validadas/atômicas, testes do núcleo
- [x] Renderizador único em Canvas 2D + 6 componentes paramétricos + legendas
- [x] Editor: upload local, player, timeline (dividir, cortar trecho, trim, mover overlays), inspetor, undo/redo, atalhos, persistência no navegador
- [x] Remoção de silêncios local (0 créditos)
- [x] Exportação MP4 no navegador via WebCodecs
- [x] Rota do agente (Claude + ferramenta `edit_timeline`) e rota de transcrição
- [x] Tabela de créditos e planos em código

## Versão 1.0 — ver [V1_SPEC.md](V1_SPEC.md)

Etapa 1 — núcleo (feito)

- [x] Operações do agente só por id de palavra/clip (`cut_words`, `atWord`/`untilWord`); o core traduz para a timeline, sem ripple shift e sem depender da ordem
- [x] Detector determinístico de takes ruins (retomadas, gaguejos, avisos de erro) + `remove_retakes` gratuito no navegador
- [x] Brand Kit no projeto e na conta; componentes herdam cores, nome e credencial
- [x] Contexto do agente em ids de palavra e tempo do vídeo bruto

Etapa 2 — agente (feito, exceto avaliação)

- [x] Validado com Groq + Claude reais; prompt com erros de gravação como prioridade nº 1
- [x] Resposta em streaming: cada etapa aplicada atualiza a timeline ao vivo
- [x] Áudio da fala em Opus 32 kbps (10 min ≈ 2 MB)
- [x] 4 skills (Viral, Autoridade, VSL, Limpeza): limpeza local grátis + direção para o agente
- [ ] Conjunto de avaliação com 10–20 vídeos reais (gravações humanas, não voz sintética)

Etapa 3 — renderer (feito)

- [x] Formato vertical 9:16 (1080×1920) como padrão, 16:9 opcional, reenquadramento do vídeo de origem e áreas seguras de Reels/TikTok/Shorts
- [x] Câmera virtual com `panX`/`panY`, creep zoom, curvas cubic-bezier e motion blur nas transições rápidas
- [x] Fontes do Brand Kit via `FontFace` (servidas pela aplicação); tipografia mista sem serifa + serifada itálica, máquina de escrever com cursor e texto dividido no gancho
- [x] Os 6 componentes da v1.0 e o fundo topográfico; catálogo do agente só com eles (os antigos ficam no menu manual)
- [x] Segmentação de pessoa (MediaPipe, local) só nos trechos com título de profundidade, com cache de máscaras
- [x] Efeitos sonoros sintetizados (whoosh, tecla, pop, golpe) no preview e na exportação
- [ ] Preview sem engasgo nos cortes (o export já é preciso por frame)
- [ ] Testar com gravações reais: segmentação com pessoa em movimento, velocidade de exportação com GPU, mixagem dos efeitos por ouvido
- [x] Tabela de créditos revista com o custo real medido; modelo rápido para ajustes pontuais
- [x] Catálogo de efeitos sonoros (23 arquivos) no lugar dos sons sintetizados
- [x] Free com 32 créditos únicos (uma edição completa), limite de 2 min, 720p e marca d'água; estimativa de vídeos na tela de planos; Brand Kits por plano (1 / 1 / 10)
- [ ] Confirmar a licença de uso comercial dos efeitos sonoros antes do lançamento

## Fase 1 — Agente de verdade

Objetivo: o prompt inicial "edite meu vídeo" produzir um corte que o público-alvo publicaria.

- [x] Validar agente e transcrição com chaves reais
- [ ] Ajustar prompt com 10–20 vídeos reais de VSL/aula
- [ ] Conjunto de avaliação: pedidos típicos × vídeos, com checagens automáticas (duração removida, cortes não comem palavras, componentes válidos)
- [x] Streaming da resposta e das operações para a UI (progresso visível durante a edição)
- [x] Detecção de retomadas/repetições com corte exato por palavra; ferramenta `read_words`
- [ ] Operações determinísticas adicionais: `remove_fillers` (é, tipo, né)
- [ ] Trilha de palavras na timeline: clicar na palavra para cortar/editar (edição por texto)
- [ ] Forma de onda na trilha principal
- [x] Roteamento de modelo: Haiku para comandos simples, Sonnet para direção completa; custo real medido por pedido

## Fase 2 — Ingestão robusta

- [x] Envio do áudio em Opus
- [ ] Extração de áudio em streaming (sem carregar o arquivo inteiro) e envio em chunks → vídeos longos
- [ ] Proxy 720p para preview fluido de fontes 4K/pesadas
- [ ] Segundo `<video>` em pré-carregamento para cortes sem engasgo no preview
- [ ] Formatos verticais (9:16) com reenquadramento; múltiplos assets; trilha de música/efeitos sonoros

## Fase 3 — SaaS

- [x] Autenticação (e-mail e senha, sessão httpOnly) e banco no servidor (Postgres, com migrações versionadas)
- [x] Ledger de créditos no servidor, custo real de IA por chamada
- [x] Painel de administração: usuários (créditos, plano, papel, banimento), financeiro (receitas, despesas, custo de IA), chaves de API cifradas, auditoria
- [x] Modelos de edição extraídos de vídeos de exemplo e reaplicáveis por todos os usuários
- [x] Projetos na conta: JSON da edição no banco, salvamento automático, lista de projetos e religação do arquivo bruto pelo hash em outro aparelho
- [ ] Storage S3-compatível para os brutos (hoje o vídeo fica no navegador de quem enviou)
- [x] Cobrança automática pelo Stripe: assinaturas Creator/Pro, pacote avulso de créditos, Portal do Cliente, receitas lançadas pelo webhook
- [x] Renovação mensal dos créditos do plano (pela fatura paga para assinantes; sob demanda para o Free), sem acúmulo; créditos extras preservados
- [x] Recuperação de senha por e-mail
- [x] Limite de requisições no login, no cadastro e na recuperação de senha
- [x] Verificação de e-mail no cadastro
- [x] Estorno e contestação no Stripe: abatem a receita e removem os créditos comprados (até onde ainda existirem). Pacotes avulsos não expiram
- [ ] Testar o webhook de estorno/contestação contra o Stripe em modo de teste (escrito e tipado, ainda sem execução real)
- [x] Travas do plano Free: 3 min de upload, marca d'água, 720p (no navegador; a transcrição também recusa no servidor)
- [ ] Storage lifecycle: exclusão automática dos brutos após 15/30 dias de inatividade, mantendo o JSON; armazenamento prolongado como add-on
- [ ] Limite de requisições nas rotas de IA e teto de gasto de IA por usuário
- [ ] Telemetria de custo real por operação para calibrar a tabela de créditos

## Fase 4 — Monetização de precisão

- [ ] Biblioteca de 50+ componentes (mapas, comparativos, depoimentos, CTAs, timelines)
- [ ] Brand Kits (fontes, cores, estilos) aplicados como defaults dos componentes
- [ ] B-roll e áudio generativos (Kling/Veo/ElevenLabs) como clips, cobrados em créditos
- [ ] Render turbo na nuvem (mesmo `renderFrame` em workers) para 4K e máquinas fracas
- [ ] Exportação `.xml` para Premiere/DaVinci (plano Pro)
- [ ] Modo "componente inédito": o modelo mais caro gera um componente novo em sandbox quando nada do catálogo serve

## Pré-lançamento (auditoria)

- [x] Planos só prometem o que o código entrega: exportação até 1080p; vídeos de até 15 min (Creator) e 30 min (Pro)
- [x] Edição interrompida (teto de custo, limite de etapas, falha no meio): o usuário é avisado e paga metade
- [x] Cortes por palavra com a fronteira conferida no áudio (`snapWordOnsets`)
- [x] Trilha da casa (loop sintetizado) desligada por padrão em todos os modelos
- [x] Legendas de impacto sem a vírgula e o ponto do transcritor
- [x] Testes de integração do servidor (créditos, projetos, estorno e contestação do Stripe) contra Postgres: `TEST_DATABASE_URL=… pnpm test`
- [x] Regra de cobrança do agente (`agentCharge`) no core, com teste
- [x] Leitura do áudio em streaming para arquivos acima de 300 MB (ingestão, transcrição, medição de pausas), sem carregar o arquivo na memória
- [x] Exportação sem carregar o vídeo na memória: áudio mixado em trechos de 30 s (lendo do arquivo só o que cada trecho usa) e arquivo final gravado em disco pelo navegador (OPFS), com o índice do MP4 no fim
- [x] Jornada real rodada de ponta a ponta (landing → cadastro → edição completa pela IA → exportação) com o vídeo de teste, duas vezes; defeitos achados e corrigidos:
  - painel de progresso preso na última etapa desde os 12 s
  - IA editando sem quadros e sem a posição do rosto quando a análise do vídeo demora (agora há uma leitura rápida, em segundos, antes da completa)
  - sobras de 0,15 s sem fala entre dois cortes vizinhos (`dropSlivers`)
  - vídeo abrindo parado quando o título de gancho é recusado no close-up (`ensureHook`)
  - rastreamento denso do rosto apagado pela resposta do servidor
- [ ] Medir o tempo de exportação em máquina com GPU (no navegador sem GPU do ambiente de teste, 62 s de vídeo levaram 8 min)
- [ ] Exportar um vídeo longo de verdade (15–30 min, arquivo de celular) antes de subir os limites dos planos
- [ ] Teste da rota do agente com o modelo simulado (plano, execução, interrupção)
- [ ] Subir os limites de duração só depois de testar vídeos longos de ponta a ponta (ingestão e exportação em streaming)
- [ ] Acervo de músicas licenciadas para religar a trilha por padrão
- [x] Termos de Uso (`/termos`) e Política de Privacidade (`/privacidade`) escritos a partir do que o código faz, com aviso de minuta enquanto houver placeholder
- [ ] Preencher os dados da empresa em `apps/web/src/lib/legal.ts` e passar os dois textos por revisão jurídica
- [x] Legendas de frase em duas linhas equilibradas, em vez de encolher a letra
- [x] Posição do rosto medida a cada ~1,5 s (até 120 medidas), para os zooms que seguem o sujeito
- [x] Revisão visual final não trava mais o editor com a aba em segundo plano (espera 30 s e segue)
- [ ] Antes/depois reais na landing (`landing-demos.ts`), no lugar dos cartões ilustrativos
- [ ] Ouvir os cortes por palavra em gravações reais com ruído (o ajuste pelo áudio só foi testado com sinal sintético)

## Decisões em aberto

- **Nome e marca do produto** — o código usa `videoeditor` como placeholder.
- **Provedor de transcrição** — Groq Whisper está implementado; Deepgram é alternativa com diarização melhor.
- **Onde hospedar** — a arquitetura atual roda em qualquer host de Next.js; o render em nuvem define a escolha (Lambda vs. Cloud Run vs. workers dedicados).
