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

## Fase 1 — Agente de verdade (próximo)

Objetivo: o prompt inicial "edite meu vídeo" produzir um corte que o público-alvo publicaria.

- [ ] Validar agente e transcrição com chaves reais; ajustar prompt com 10–20 vídeos reais de VSL/aula
- [ ] Conjunto de avaliação: pedidos típicos × vídeos, com checagens automáticas (duração removida, cortes não comem palavras, componentes válidos)
- [ ] Streaming da resposta e das operações para a UI (progresso visível durante a edição)
- [x] Detecção de retomadas/repetições com intervalo de corte exato; ferramenta `read_words` para tempo por palavra
- [ ] Operações determinísticas adicionais: `remove_fillers` (é, tipo, né)
- [ ] Trilha de palavras na timeline: clicar na palavra para cortar/editar (edição por texto)
- [ ] Forma de onda na trilha principal
- [ ] Roteamento de modelo: Haiku para comandos simples, Sonnet para direção completa; medir custo real por pedido

## Fase 2 — Ingestão robusta

- [ ] Extração de áudio em streaming (sem carregar o arquivo inteiro) e envio em Opus/chunks → vídeos longos
- [ ] Proxy 720p para preview fluido de fontes 4K/pesadas
- [ ] Segundo `<video>` em pré-carregamento para cortes sem engasgo no preview
- [ ] Formatos verticais (9:16) com reenquadramento; múltiplos assets; trilha de música/efeitos sonoros

## Fase 3 — SaaS

- [x] Autenticação (e-mail e senha, sessão httpOnly) e banco no servidor (Postgres, com migrações versionadas)
- [x] Ledger de créditos no servidor, custo real de IA por chamada
- [x] Painel de administração: usuários (créditos, plano, papel, banimento), financeiro (receitas, despesas, custo de IA), chaves de API cifradas, auditoria
- [x] Modelos de edição extraídos de vídeos de exemplo e reaplicáveis por todos os usuários
- [ ] Projetos na nuvem (JSON da edição no banco; storage S3-compatível para brutos)
- [x] Cobrança automática pelo Stripe: assinaturas Creator/Pro, pacote avulso de créditos, Portal do Cliente, receitas lançadas pelo webhook
- [x] Renovação mensal dos créditos do plano (pela fatura paga para assinantes; sob demanda para o Free), sem acúmulo; créditos extras preservados
- [x] Recuperação de senha por e-mail
- [x] Limite de requisições no login, no cadastro e na recuperação de senha
- [ ] Verificação de e-mail no cadastro
- [ ] Estorno e contestação no Stripe (hoje não removem créditos); validade de 90 dias dos pacotes avulsos
- [ ] Travas do plano Free: 3 min de upload, marca d'água, 720p
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

## Decisões em aberto

- **Nome e marca do produto** — o código usa `videoeditor` como placeholder.
- **Provedor de transcrição** — Groq Whisper está implementado; Deepgram é alternativa com diarização melhor.
- **Onde hospedar** — a arquitetura atual roda em qualquer host de Next.js; o render em nuvem define a escolha (Lambda vs. Cloud Run vs. workers dedicados).
