# Brief de Arranque — Epic v2.x: Voz (TTS/STT)

**Autor:** River (Scrum Master AIOX)
**Data:** 08/07/2026
**Tipo:** Brief de arranque (não é PRD completo — é a base accionável para o @architect/@po/@dev avançarem)
**Fonte de direcção:** `docs/prd-jarvis.md` §9 (roadmap: "v2.x — Voz (acordar e falar literalmente — TTS/STT) · mais integrações. 'fala comigo' literal") + `docs/jarvis-north-star.md` §5.
**Constraints herdados:** disciplina da espinha (profundidade antes de largura); RLS/tenancy intacta (`household_id` + 4 policies por tabela nova, gate NFR5 bloqueia merge); SEC-8 HOLD; billing CONGELADO; família removida (não reintroduzir); **dados na UE obrigatória** (Vercel `fra1` + Supabase `eu-central-1` — CLAUDE.md); PT-PT europeu; push só @devops.

---

## 0. Ponto de partida real (verificado no código, 08/07/2026)

| Facto verificado | Onde | Implicação para a v2.x |
|-------------------|------|--------------------------|
| A epic v2 (Memória Rica) está **completa** — M-1..M-6 em `docs/stories/completed/`, HEAD `f56b5b4`+, migração `0037` aplicada em prod. | `docs/HANDOFF-INDEX.md`, `git log` | v2.x arranca de um motor estável e provado; nada por terminar da v2 bloqueia a v2.x. |
| O bot Telegram só recebe `message.text` e `callback_query` — `TelegramMessage`/`isTelegramUpdate` (`apps/web/src/lib/telegram/types.ts`) **não têm campo `voice`/`audio`**. Qualquer update sem `.text` é ignorado graciosamente (`route.ts` linha ~109-113). | `apps/web/src/lib/telegram/types.ts`, `apps/web/src/app/api/telegram/webhook/route.ts` | Uma nota de voz enviada hoje ao `@jarvis_eurico_bot` é **silenciosamente ignorada** — não há nenhum caminho de erro a corrigir, é ausência total de capacidade. |
| `runAgentForHousehold({ userId, householdId, prompt })` (`apps/web/src/lib/agent/run-agent.ts`) já é **agnóstico da origem do texto** — recebe uma string e corre classificar→planear→executar. O webhook de texto (`handleTextMessage`) é um wrapper fino à volta desta função. | `apps/web/src/lib/agent/run-agent.ts`, `apps/web/src/app/api/telegram/webhook/route.ts` linhas 154-187 | A espinha de voz **não precisa de tocar o motor cognitivo** — só precisa de produzir uma string (a transcrição) e entregá-la ao mesmo `runAgentForHousehold`. Reutilização máxima, risco mínimo. |
| Não existe nenhuma dependência de STT/TTS no repo (`grep` por `whisper`/`speech`/`tts`/`stt` no `package.json` de `apps/web` e `packages/*` não devolve nada) nem infraestrutura de download de ficheiros binários do Telegram (`getFile` da Bot API). | `apps/web/package.json`, `packages/agent/src/providers/` (só `anthropic.ts`/`openai.ts`, texto) | Trabalho 100% novo: cliente STT + download de ficheiro do Telegram. Não há nada para reaproveitar directamente, mas o padrão de "cliente HTTP fino sem dependência nova" já está estabelecido (`packages/telegram/client.ts` usa `fetch` nativo). |
| O PRD já **antecipa e agenda** esta re-avaliação: `docs/prd-jarvis.md` §7 nota que "os LLM providers (Anthropic/OpenAI) não garantem região UE em 2026" e que a posição deve ser **"re-avaliada com providers EU na v2"** (arquitectura §12.2 mantém a excepção documentada só para texto). | `docs/prd-jarvis.md` §7, `docs/architecture.md` linha 946 | A excepção UE existente cobre APENAS o *texto* do prompt enviado a Anthropic/OpenAI (DPA + no-training + minimização). **Não cobre áudio** — é um tipo de dado novo (voz), potencialmente mais sensível (traço biométrico-adjacente), e esta epic é exactamente o momento de decidir a postura, não de estender a excepção por inércia. |
| `packages/agent/src/providers/` segue um padrão de `interface.ts` + implementação por provider (`anthropic.ts`, `openai.ts`) com retry/circuit-breaker/redaction genéricos (`retry.ts`, `circuit-breaker.ts`, `redaction.ts`). | `packages/agent/src/providers/index.ts` | Um cliente STT novo deve seguir a mesma forma (`interface.ts` + implementação), para poder trocar de provider sem reescrever o webhook — útil dado que o provider concreto é uma decisão em aberto (§2). |

**Leitura estratégica:** ao contrário da v2 (memória), aqui **não há scaffolding prévio nenhum** — nem tabela fria à espera, nem padrão de injecção pronto. A v2.x é trabalho genuinamente novo em dois eixos independentes: (a) um cliente STT/download de ficheiro Telegram, novo; (b) uma decisão de fornecedor com residência de dados UE, que ainda não foi tomada para áudio. Isto favorece uma espinha muito curta e um único fornecedor (não multi-provider) na primeira story.

---

## 1. Definição concreta de "Voz" para a v2.x — direcção da espinha

A north-star fala de "acordar e falar literalmente (TTS/STT)" — duas direcções com custo e risco muito diferentes:

| Direcção | O que é | Custo/risco | Veredicto espinha |
|----------|---------|-------------|--------------------|
| **Input (STT)** — o Eurico manda uma nota de voz no Telegram e o Jarvis entende-a e age | Baixo-médio: 1 chamada STT por mensagem, reutiliza 100% o motor existente (`runAgentForHousehold` já aceita qualquer string) | ✅ **ESPINHA v2.x (MVP)** |
| **Output (TTS)** — o Jarvis responde por voz (brief da manhã falado, respostas faladas) | Médio-alto: precisa de gerar áudio, decidir quando enviar voz vs texto (não substituir tudo — Telegram é essencialmente texto), gere um ficheiro de saída (upload `sendVoice`), acrescenta latência e custo a CADA resposta (não só quando o Eurico pede) | ⏭️ v2.x seguinte (depois de o input estar provado e estável) |
| **Ambos em simultâneo** | Combina os dois custos, sem provar nenhum isoladamente primeiro | ❌ Rejeitado para a primeira story — viola a disciplina da espinha (profundidade antes de largura, já citada 2x no PRD) |

### [AUTO-DECISION] A espinha da v2.x é **input-first (STT)** → decisão: a primeira story só cobre "o Eurico fala, o Jarvis entende e age". TTS (o Jarvis falar de volta) fica para a story seguinte da mesma epic, só depois de o input estar em produção e provado. Razão: (1) reutiliza 100% o motor cognitivo já existente sem o tocar — menor risco de regressão; (2) é a metade que resolve o maior atrito real hoje (o Eurico ter de escrever em vez de ditar, especialmente em contexto de manhã/mãos ocupadas); (3) o output por voz introduz uma decisão de UX não trivial (quando enviar voz vs texto — nem toda a resposta do Jarvis deve virar áudio) que merece uma story própria, não misturada com a prova de conceito do input.

---

## 2. Fornecedor de STT + residência de dados UE — DECISÃO EM ABERTO (não decidida aqui)

**Isto é o ponto de maior risco arquitectural da epic e não deve ser decidido pelo @sm.** O que se segue é o levantamento de opções + um default proposto, para o @architect/@po validarem com o Eurico antes do @dev implementar.

### O problema

CLAUDE.md e o PRD (`docs/prd-jarvis.md` §7) são explícitos: **dados na UE obrigatória**. A única excepção documentada hoje (`docs/architecture.md` linha 946) é para os LLM providers de **texto** (Anthropic/OpenAI), com mitigação (DPA + no-training + minimização + hash em logs) — porque não há alternativa viável de qualidade equivalente com garantia de região UE em 2026. **Essa excepção não deve ser estendida automaticamente ao áudio** sem decisão explícita: voz é um tipo de dado mais sensível (o PRD já classifica agenda/email como "dados íntimos" — voz é, no mínimo, igual, e tecnicamente adjacente a dado biométrico se algum dia for usado para identificação, mesmo que não seja essa a intenção aqui).

### Opções levantadas (sem escolher)

| Opção | Região UE garantida? | Formato nativo aceite | Complexidade de integração | Nota |
|-------|----------------------|------------------------|------------------------------|------|
| **OpenAI Whisper API** | ❌ Não (mesma excepção documentada do texto, mas nunca antes aplicada a áudio) | Sim, OGG directamente | Muito baixa (API HTTP simples, sem SDK) | Extensão da excepção existente — mas seria a PRIMEIRA vez que áudio sai para fora da UE; exige decisão consciente, não herdada por omissão. |
| **Google Cloud Speech-to-Text (v2)** | ✅ Sim — permite fixar região (`europe-west4` ou equivalente) e "data residency boundary" contratual | Sim, `OGG_OPUS` suportado nativamente (sem transcodificação) | Média — requer projecto GCP + service account/API key novos (distinto do OAuth de utilizador já usado para Calendar/Gmail) | Fica na mesma família Google já tocada pelo projecto (Calendar/Gmail), mas é um produto de infraestrutura diferente (não é OAuth de utilizador). |
| **Azure AI Speech** | ✅ Sim — região `westeurope`/`northeurope` | Prefere WAV/PCM; OGG/Opus tem suporte mais limitado consoante o SDK — pode exigir transcodificação (FFmpeg) | Média-alta (possível dependência de transcodificação em runtime serverless) | Transcodificação em Vercel serverless é um risco de complexidade/latência a validar. |
| **Whisper self-hosted (open-source)** | ✅ Sim, se alojado em infra UE própria | Qualquer, com pré-processamento | Alta — precisa de compute dedicado (GPU/CPU), não encaixa no modelo serverless Vercel `fra1` actual | Fora de âmbito para a espinha — over-engineering claro para 1 utilizador. |

### [AUTO-DECISION — default proposto, NÃO uma decisão final] Recomendação: **Google Cloud Speech-to-Text v2, região `europe-west4`**, como default a validar

Razões do default (a confirmar/corrigir por @architect/@po/Eurico):
1. É a única opção com garantia de região UE **e** suporte nativo a `OGG_OPUS` (o formato que o Telegram envia) — evita um passo de transcodificação em runtime serverless (risco de latência/complexidade adicional na espinha).
2. Mantém a postura "dados na UE obrigatória" sem precisar de reabrir a excepção documentada em `architecture.md` §12.2 para um tipo de dado novo e mais sensível.
3. Custo por segundo de áudio é baixo para 1 utilizador (poucos minutos/dia) — dentro do espírito de NFR-J9 (custo LLM desprezável para 1 utilizador, aplicável por analogia).

**Contra-argumento a levantar explicitamente ao Eurico:** exige criar um projecto GCP novo + gerir uma service account/API key nova (mais um segredo a cifrar/guardar em Vercel Env, seguindo o padrão AES-256-GCM já estabelecido para `OAUTH_TOKEN_ENCRYPTION_KEY` — ver §4.4 do PRD). Se a complexidade operacional for indesejada para uma espinha, a alternativa mais simples é o OpenAI Whisper API, **mas só com decisão consciente e documentada** (não herdada da excepção de texto por omissão) — e nesse caso a mitigação teria de ser: nunca persistir o áudio em disco/DB (só passa em memória), reter só a transcrição, e registar a excepção em `architecture.md` §12.2 explicitamente para "STT (áudio)" com a mesma disciplina de DPA/no-training.

**Este brief NÃO decide.** A primeira story (§5) deixa o cliente STT atrás de uma interface fina (`packages/agent/src/providers/interface.ts`, mesmo padrão dos providers de texto) precisamente para que a escolha final do @architect não obrigue a reescrever o webhook.

---

## 3. Formato/ingestão de áudio no Telegram

| Aspecto | Facto (Bot API pública) | Implicação |
|---------|--------------------------|-------------|
| Tipo de update | Notas de voz chegam como `message.voice` (não `message.audio`, que é para ficheiros de música/áudio enviados como anexo). Formato: OGG container, codec Opus. | `TelegramMessage`/`isTelegramUpdate` (`apps/web/src/lib/telegram/types.ts`) precisam de um campo `voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number }` novo, com type guard estrutural (mesmo padrão de `isTelegramMessage`). |
| Obter o ficheiro | Bot API `getFile(file_id)` devolve `file_path`; o download real é via `https://api.telegram.org/file/bot<token>/<file_path>` (endpoint HTTP distinto do `sendMessage`/`getFile`). | Novo helper em `apps/web/src/lib/telegram/` (ex. `getFile.ts`) — 2 chamadas HTTP encadeadas, sem dependência nova (`fetch` nativo, mesmo padrão de `client.ts`). |
| Limite de tamanho | A Bot API só permite bots fazerem download de ficheiros até **20 MB**. Acima disso, `getFile` falha. | AC de guarda: ficheiro > 20 MB (ou `file_size` ausente/inválido) → resposta educada a pedir para encurtar/escrever, sem tentar o download. |
| Duração | O Telegram não impõe um limite rígido de duração para notas de voz, mas durações longas custam mais na STT e aumentam a latência da resposta (NFR-J3 já estabelece um alvo <~5s para a resposta-em-conversa de texto — voz vai ser inevitavelmente mais lenta por causa do passo STT extra). | [AUTO-DECISION] Cap de duração proposto: **120 segundos** — acima disso, pedir para encurtar. Default sensato para uma instrução falada; evita facturas STT inesperadas e latência excessiva. O Eurico pode corrigir este número. |
| Custo/latência | Latência total = download do Telegram + chamada STT + pipeline cognitivo completo (classifier→planner→executor) + envio da resposta. Cada etapa soma. | A story deve medir e reportar a latência real end-to-end (como o NFR-J3 já faz para texto) em vez de assumir um alvo — "a medir em produção", não um número inventado. |

---

## 4. Riscos & mitigações

| Risco | Sev. | Mitigação |
|-------|------|-----------|
| **R1 — Fuga de residência UE:** áudio (dado mais sensível que texto) sai da UE sem decisão consciente, só por conveniência de integração. | Alta | §2 documenta a decisão como EM ABERTO explicitamente, com default proposto que preserva UE (Google Cloud STT `europe-west4`); qualquer desvio (ex. Whisper) exige decisão documentada do @architect/@po/Eurico, não herança silenciosa da excepção de texto. |
| **R2 — Persistência acidental de áudio:** um ficheiro de voz gravado em disco/DB/logs seria dado íntimo sensível a reter desnecessariamente. | Alta | [AUTO-DECISION] o áudio nunca é persistido — processado em memória (buffer), enviado à STT, descartado imediatamente após obter a transcrição; só a transcrição (texto) segue para o motor, com as mesmas regras de redacção em logs já aplicadas ao texto normal (NFR-J5, `packages/agent/src/redaction.ts`). |
| **R3 — Custo/latência imprevisível** com áudios longos ou muito frequentes. | Média | Cap de duração (120s, ver §3) + cap de tamanho (20 MB, limite físico da Bot API) + medição real da latência em produção antes de alargar o âmbito. |
| **R4 — Transcrição errada leva a acção errada** (ex. STT ouve mal um valor monetário ou um nome) — mais grave em voz do que em texto porque o Eurico não vê o que "escreveu". | Média-alta | [AUTO-DECISION] a resposta do Jarvis deve **sempre citar/confirmar a transcrição interpretada** antes ou junto da acção (transparência — já é princípio do PRD §7: "o Jarvis é claro sobre o que acede"), para o Eurico poder corrigir rapidamente se a STT ouviu mal. Combinado com o preview-then-confirm já existente para confiança <0,70. |
| **R5 — Over-engineering:** multi-provider STT, streaming em tempo real, TTS simultâneo, suporte a `message.audio` (ficheiros de música) — nada disto é a espinha. | Alta | Escopo explicitamente cortado na story (§5): só `message.voice`, só um provider, só input (sem TTS), sem streaming (upload-then-transcribe, não em tempo real). |
| **R6 — Novo segredo mal gerido** (API key/service account STT) — mais uma credencial em Vercel Env. | Média | Seguir o padrão já estabelecido para `TELEGRAM_BOT_TOKEN`/`OAUTH_TOKEN_ENCRYPTION_KEY`: nunca em git, só Vercel Env (UE), setup conduzido passo-a-passo com o Eurico no BUILD (não nesta fase de draft). |

---

## 5. Stories candidatas — a espinha v2.x ponta-a-ponta

Prefixo proposto: **`V-`** (Voz), a seguir à série `M-` (Memória) e `J-` (Fase 1). O @sm já draftou a primeira (`V-1`, ver `docs/stories/active/`); o @po afina no gate seguinte.

| Story | Título | Âmbito E2E | Depende de |
|-------|--------|-----------|------------|
| **V-1** | Transcrever nota de voz do Telegram e agir (STT input-first) | `message.voice` → download via `getFile` → STT (provider a confirmar, default Google Cloud STT EU) → transcrição → `runAgentForHousehold` (mesmo motor do texto, zero alteração ao pipeline cognitivo) → resposta confirma a transcrição + executa/pergunta como hoje. | — (motor já existe; só precisa do par download+STT novo) |
| **V-2** (candidata, pós-espinha) | O Jarvis responde por voz (TTS) quando fizer sentido | Gerar áudio da resposta e enviar via `sendVoice`, com uma regra clara de quando usar voz vs texto (não substituir tudo). | V-1 (prova primeiro que o canal de voz é fiável em input antes de investir no output) |
| **V-3** (candidata, exploratória) | Mais integrações de voz (ex. brief da manhã falado) | Estende V-2 ao job proactivo do brief. | V-1, V-2 |

**A espinha mínima desta epic = só V-1.** V-2/V-3 não são draftadas nesta sessão — ficam no roadmap até V-1 estar em produção e provado.

---

## 6. O que este brief NÃO decide (fica para os próximos agentes)

- **Fornecedor final de STT + região exacta** (§2) → **@architect/@po**, com validação explícita do Eurico (é uma decisão de dados/custo, não só técnica).
- **Nome exacto dos ficheiros/funções do cliente STT** (`packages/agent/src/providers/stt/...` ou `apps/web/src/lib/stt/...` — a localização segue a mesma lógica já usada para `google/` vs `packages/tools/` nas stories M-*: se depender de infra específica de um provider externo pesado, considerar `apps/web/src/lib/`; se for genérico o suficiente, `packages/agent/src/providers/`) → **@dev** no draft técnico, com o @sm já a propor um default na story V-1.
- **AC testáveis, ordem fina e estimativa da story V-1** → já draftada abaixo pelo @sm; validação final → **@po**.
- **Setup externo (projecto GCP/API key, ou equivalente do provider escolhido)** → [EURICO] no BUILD, não nesta fase de draft.
- **V-2 (TTS)** — nada desta story cobre saída por voz; fica candidata a story futura, sem draft nesta sessão.
