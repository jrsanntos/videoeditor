# DIRETRIZ MESTRA DE PRODUTO E ENGENHARIA — VERSÃO 1.0 (LOCAL-FIRST)

## 1. Visão Comercial e Posicionamento (Regra de Escopo)
Não estamos construindo um concorrente generalista do CapCut nem um editor pesado em nuvem. Somos uma **"Máquina de Limpeza, Retenção e Estética de Estúdio em 1 Clique"** focada em vídeos falados (Reels, TikTok, Shorts, VSLs e Aulas) para dois públicos:
1. **Especialistas que odeiam editar:** Médicos, advogados, personal trainers, consultores financeiros e infoprodutores.
2. **Editores freelancers que editam em lote:** Profissionais que usam a plataforma como pré-processador para limpar silêncios/erros, aplicar zooms, inserir motion design base e ajustar na timeline em segundos.

**Decisões Arquiteturais Inegociáveis na v1.0:**
- **100% Local-First:** Sem Cloud Render e sem Cloud Storage nesta fase. O vídeo bruto fica no `IndexedDB`, a análise de silêncio e o preview rodam no navegador (`Canvas 2D`), e a exportação final usa `WebCodecs` na GPU local do cliente.
- **Paridade UI ↔ Agente:** A IA nunca renderiza pixels nem cria código arbitrário; ela emite operações validadas por Zod no `packages/core` que manipulam o `Timeline State (JSON)`. O usuário pode desfazer (Undo) ou ajustar qualquer decisão da IA manualmente na timeline a custo zero.

---

## 2. Onboarding Guiado: Brand Kit Único
O usuário configura sua estética uma única vez (salva no estado/perfil) e todos os vídeos seguintes herdam automaticamente:
- **Paleta de Cores:** `primaryColor` (destaque principal), `secondaryColor` (apoio), `backgroundColor` (para cenas full-screen, padrão Dark `#0B0F19`), `textColor` (`#F8FAFC`).
- **Par Tipográfico (Font Pairing):** Uma fonte Sans-Serif forte para impacto (ex: *Inter Black* / *Montserrat*) combinada com uma Serifada em Itálico para palavras emocionais/ênfase (ex: *Instrument Serif* / *Playfair Display Italic*), carregadas via `FontFace` API antes do `renderFrame`.
- **Credencial de Autoridade:** Nome de exibição e registro/cargo (ex: "Dra. Ana Silva • CRM 12345" ou "Personal Trainer") para preenchimento automático de Lower Thirds.

---

## 3. Arsenal Visual da Versão 1.0 (`packages/renderer` & `packages/core`)
Para atingir o nível de retenção de vídeos virais de alta produção (estilo Dan Martell) usando apenas nosso motor `Canvas 2D`, precisamos implementar com perfeição matemática os seguintes recursos:

### A. Câmera Virtual e Efeito de Movimento
- **Multi-Enquadramento (`scale`, `panX`, `panY`):**
  - *Jump Cut Zoom:* Mudança seca de escala (`1.0` -> `1.15`) em cortes de respiração ou ênfase.
  - *Creep Zoom:* Avanço lento e dramático (`1.0` -> `1.08` ao longo de 3s a 5s) em frases importantes.
  - *Lateral Pan (Regra dos Terços):* Zoom `1.30x` deslocando o orador para a esquerda ou direita (`panX`), abrindo espaço limpo no lado oposto para listas e textos.
- **Curvas Bezier + Motion Blur de Transição:** Todas as transições de câmera e entrada de componentes devem usar curvas `cubic-bezier` agressivas combinadas com desfoque direcional/velocidade proporcional (`ctx.filter = 'blur(Xpx)'`) apenas nos frames de movimento rápido.

### B. Segmentação de Pessoa (`DepthTitle` — Texto Atrás do Apresentador)
- Pipeline leve de segmentação no navegador (ex: MediaPipe Selfie Segmentation) para renderizar em 3 camadas no `renderFrame(state, t)`:
  1. Frame original do vídeo (fundo).
  2. Texto gigante de impacto no centro/topo (ex: `font-size: 240px`, `font-weight: 900`) ou elementos gráficos.
  3. Máscara recortada do apresentador desenhada por cima do texto.

### C. Motor de Tipografia Mista e Espacial (Não-CapCut)
- **Dual-Font Inline Rendering:** Capacidade de renderizar uma mesma frase misturando a fonte Sans-Serif padrão com palavras específicas marcadas pelo agente em *Serif Italic* ou cor de destaque (calculando largura exata via `ctx.measureText`).
- **Modos de Entrada:**
  - *Typewriter com Cursor (`|`)* piscando ao final da digitação.
  - *Split Spatial Text:* Texto dividido à esquerda e à direita da cabeça do apresentador nos primeiros 3 segundos (Hook).
  - *Executive Pill / Box:* Legenda limpa de 1 a 2 linhas com fundo escuro translúcido (`rgba(15, 23, 42, 0.78)`) e cantos arredondados para conteúdos sérios.

### D. Os 6 Componentes Paramétricos à Prova de Balas (Cenas Full-Screen & Overlays)
Em vez de depender de B-Roll externo caro, o Canvas 2D desenha cenas completas (com opção de fundo escuro com linhas topográficas sutis animadas) ou overlays limpos:
1. **`DepthHookTitle`:** Texto gigante atrás da pessoa + texto auxiliar dividido para os primeiros 3 segundos.
2. **`KineticPivotCard` (B-Roll em Código):** Tela preta/topográfica onde a primeira frase gira 90° na vertical (com barra lateral de destaque) abrindo espaço para a frase de conclusão.
3. **`StepProgressGraphic` (Escada / Evolução Vetorial):** Gráfico vetorial minimalista (degraus ou linha de tendência ascendente) desenhado progressivamente em sincronia com a fala (ex: múltiplos "nãos" até chegar no "sim", ou evolução de resultados).
4. **`AcronymOrSplitList` (Expansor de Conceito / Checklist):** Exibe uma sigla que se expande ou uma lista de 3 a 4 dicas práticas / erros comuns entrando item por item no canto da tela (com câmera em *Lateral Pan*).
5. **`ExecutiveLowerThird`:** Tarja minimalista e elegante no canto inferior esquerdo com nome e especialidade/registro do profissional.
6. **`StatHighlightCounter`:** Card de prova social ou dado numérico com contador animado (`0` -> `valor final`) para VSLs, finanças e vendas.

### E. Design Sonoro Embutido (SFX Sync)
Mixagem automática de 4 assets de áudio curtos e discretos sincronizados com as operações visuais:
- `whoosh_clean.wav` (-16dB) em movimentos rápidos de câmera e rotação de texto.
- `keyboard_tick.wav` (-20dB) acompanhando textos em modo *Typewriter*.
- `subtle_pop.wav` (-18dB) na entrada de itens de lista.
- `deep_riser_hit.wav` (-15dB) na entrada de cenas Full-Screen Dark Mode.

---

## 4. As 4 Skills Prontas (Presets de Nicho no `/api/agent`)
O agente de IA deve operar guiado pelo preset escolhido pelo usuário:
1. **Skill: Viral / High-Retention (Estilo Dan Martell / Dicas Práticas):** Cortes secos (<150ms), *DepthHookTitle* nos primeiros 3s, alternância constante entre câmera com *Lateral Pan*, *Typewriter* com fontes mistas e cenas *Full-Screen Dark Mode* (*KineticPivotCard* / *StepProgressGraphic*). Ideal para personais, nutricionistas e criadores de crescimento orgânico.
2. **Skill: Autoridade Executiva (Médicos, Advogados e Finanças):** Cortes naturais preservando pausas de raciocínio (300ms), *ExecutiveLowerThird* no início, *Creep Zoom* suave, legenda *Executive Pill* e *AcronymOrSplitList* para explicar leis, diagnósticos ou investimentos com sobriedade.
3. **Skill: Direct Response / VSL (Vendedores e Gestores de Tráfego):** Foco em conversão, cortes ultra-rápidos, destaque em cores vibrantes para dores/benefícios e acionamento de *StatHighlightCounter* sempre que números, prazos ou valores financeiros forem citados.
4. **Skill: Limpeza de Lote / Pré-Edição (Para Editores e Aulas):** Foco estrito em decupagem semântica (remoção de silêncios + exclusão automática de takes repetidos/erros de gravação) e aplicação de zooms básicos nas mudanças de tópico.

---

## 5. Os 4 Pontos Críticos de Implementação Técnica (Prioridade Atual)

1. **Remoção Semântica de Erros de Gravação (Bad Takes) + Ripple Shift Zero:**
   - Na rota `/api/agent`, a prioridade #1 do prompt do Claude ao ler a transcrição é identificar frases repetidas, gaguejos ou retomadas ("errei, vou falar de novo") e emitir operações de corte mantendo apenas o último *take* válido.
   - **Regra do `packages/core`:** O agente DEVE referenciar sempre o `sourceTime` (tempo do vídeo bruto original) ou `wordId`/`segmentId` em todas as operações. O `packages/core` é quem calcula a tradução de `sourceTime` para `timelineTime` após aplicar os cortes, impedindo que componentes e zooms fiquem deslocados (*Ripple Shift*).
2. **Compressão de Áudio para `/api/transcribe` (< 4.5 MB):**
   - Codificar o áudio 16 kHz extraído no navegador em Opus/WebM ou MP3 mono a 32 kbps antes do envio (garantindo que 10 minutos fiquem com ~2.4 MB e passem sem erro em limites Serverless e na API do Groq Whisper).
3. **Streaming de Operações no `/api/agent` (Baixa Latência Percebida):**
   - Utilizar streaming (SSE / Tool Call streaming) para que cada operação emitida pelo Claude atualize o `Timeline State` no navegador imediatamente, montando a timeline ao vivo na frente do usuário enquanto o agente pensa.
4. **Precisão de Frame no Export WebCodecs:**
   - Garantir que o pipeline de exportação não sofra engasgos de seeking em `video.currentTime` nos cortes secos (*jump cuts*), utilizando decodificação precisa de frames (`VideoDecoder` / demuxer) sincronizada com o compositor Canvas 2D.

---

## 6. Plano de Execução Imediato (Ordem de Tarefas)
1. **Revisar e blindar o `packages/core`:** Garantir que todas as operações do agente usem `sourceTime` / `wordId`, que o schema do *Brand Kit* exista no estado e que o *Contexto Compacto* enviado ao agente agrupe palavras com timestamps de forma econômica em tokens.
2. **Validar `/api/transcribe` e `/api/agent`:** Testar o fluxo real com Groq + Claude focando na **detecção de takes errados (bad takes)** e na emissão em streaming das operações das Skills.
3. **Evoluir o `packages/renderer`:** Implementar a tipografia mista (Sans + Serif Italic + Typewriter), a câmera com `panX`/`panY` + *motion blur* de transição, a camada de máscara para `DepthHookTitle` e os 6 componentes paramétricos.
