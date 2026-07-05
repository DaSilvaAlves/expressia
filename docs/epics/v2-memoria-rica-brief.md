# Brief de Arranque — Epic v2: Memória Rica

**Autor:** Morgan (Product Manager AIOX)
**Data:** 04/07/2026
**Tipo:** Brief de arranque (não é PRD completo — é a base accionável para o @architect/@data-engineer/@sm avançarem)
**Fonte de direcção:** `docs/prd-jarvis.md` §5 (north-star) + §9 (roadmap: "v2 — Memória rica: hábitos, diário, preferências · pesquisa · apoio a decisões. O 'sabe tudo' sobre o Eurico.")
**Constraints herdados:** disciplina da espinha (profundidade antes de largura); RLS/tenancy intacta (`household_id` + 4 policies por tabela nova, gate NFR5 bloqueia merge); SEC-8 HOLD; billing CONGELADO; família removida (não reintroduzir); dados na UE; PT-PT europeu.

---

## 0. Ponto de partida real (verificado no código, 04/07/2026)

Antes de desenhar seja o que for, o estado factual do repo — para não reinventar nem assumir drift:

| Facto verificado | Onde | Implicação para a v2 |
|------------------|------|----------------------|
| **`jarvis_facts` JÁ EXISTE** — key-value household-scoped (`household_id`, `key`, `value`, `unique(household_id, key)`) com as 4 RLS policies. | `packages/db/migrations/0029_google_oauth_jarvis_facts.sql`; policies em `0001_rls_policies.sql` (`$rls_jarvis_facts$`). | A infra de tenancy da memória **já está paga**. Mas o schema key-value é para *settings estruturados* (ex.: `timezone`, `brief_tone`), não para memórias em texto livre. |
| **`jarvis_facts` está FRIA** — criada mas nunca lida. Nenhum código em `packages/` ou `apps/` a consome fora do schema/migration. O motor e o brief não a tocam. | grep `jarvis_facts`/`jarvisFacts` → só schema + migrations. | A v2 é literalmente "ligar a memória à corrente" pela primeira vez. A promessa de FR-J10 ("cresce na v2 com memória rica") concretiza-se aqui. |
| **Padrão de injecção de contexto provado:** contexto viaja como **prefixo da user message**, NUNCA no `system`/`tools` (preserva o prefixo cacheável da Anthropic + é coberto por redaction NFR12 por construção). | `serializeAccountContextForPlanner` / `serializeEmailReplyContextForPlanner` em `packages/planner-executor/src/planner.ts`; construído em `apps/web/src/lib/agent/run-agent.ts` (`buildAccountContext`). | A memória usa **exactamente** este padrão. Zero invenção arquitectural — é mais um bloco de prefixo. |
| **Motor multi-intent existente:** classifier (`INTENT_VALUES`) = tarefas + finanças + consultar_dados/cancelar_ultima/unknown. Adicionar capacidade = novo intent + tool (padrão já repetido em J-5..J-8). | `packages/classifier/src/schemas.ts`, `packages/tools/` | Capturar memória explícita = **novo intent + nova tool**, igual ao que J-5/J-7 fizeram para Calendar/Gmail. |
| **Undo 30s + preview-then-confirm** provados E2E via `agent_reverse_ops` / `executeAtomic`. | `packages/tools/src/atomic.ts` | Guardar/esquecer memória herda undo honesto de graça. |

**Leitura estratégica:** a v2 tem um arranque desproporcionalmente barato porque a tenancy da memória já está scaffolded e o padrão de uso já existe. O trabalho real é *pequeno e focado*: um intent de captura, uma tabela de texto livre, e um bloco de prefixo. Isto favorece uma espinha muito curta.

---

## 1. Definição concreta de "memória rica" para a v2

"Memória rica" na north-star junta 4 coisas que **não têm o mesmo custo nem o mesmo risco**. Separá-las é o primeiro acto de disciplina:

| Tipo de memória | Exemplo | Custo/risco | Veredicto v2 |
|-----------------|---------|-------------|--------------|
| **Factos/preferências explícitas** | "lembra-te que odeio reuniões antes das 10h"; "a minha mãe faz anos a 3 de março"; "prefiro café sem açúcar" | Baixo — o Eurico dita, o Jarvis guarda. Captura consentida = confiança preservada. | ✅ **ESPINHA v2 (MVP)** |
| **Hábitos inferidos** | "reparei que registas o almoço todos os dias por volta das 13h" | Alto — exige análise de padrões + captura *silenciosa* (mina a confiança se errar) + confirmação. | ⏭️ v2.x |
| **Diário / notas livres** | "hoje correu mal a reunião, senti-me…" | Médio — dados íntimos; precisa de superfície de escrita e recuperação por data/tema. | ⏭️ v2.x |
| **Contexto de decisões / apoio a decisões** | "ajuda-me a decidir se aceito a proposta X" (retém prós/contras entre sessões) | Alto — é quase um produto novo (raciocínio multi-turno com estado). | ⏭️ v2.x / v3 |
| **Pesquisa** | "procura X e lembra-te para depois" | Fora do eixo de memória — é uma tool de pesquisa que *escreve* memória. | ⏭️ v2.x (depende da espinha estar viva) |

### MVP da espinha v2 (o mínimo que entrega valor E2E)

> **O Eurico diz ao Jarvis "lembra-te que X" → o Jarvis guarda X → num prompt POSTERIOR (ou no brief da manhã) o Jarvis usa X sem lho ser relembrado.**

É isto e mais nada. Uma memória capturada explicitamente, guardada com RLS, e injectada no motor + brief. Prova a espinha "o Jarvis sabe algo sobre o Eurico que reteve entre conversas" — que é, literalmente, a definição de memória. Tudo o resto (inferência, diário, pesquisa, apoio a decisões) **cresce a partir daqui, não em paralelo**.

**Rejeitado explicitamente do MVP (anti-over-engineering):**
- ❌ Embeddings / pgvector / retrieval semântico — ver §3, é prematuro para 1 utilizador.
- ❌ Extracção automática/inferida de conversas — captura silenciosa mina a confiança; adiar para v2.x com confirmação.
- ❌ Categorização/tagging elaborado, UI de gestão de memórias, versionamento de memórias.
- ❌ Diário como superfície separada.

---

## 2. Como a memória é capturada

| Via | O que é | Recomendação |
|-----|---------|--------------|
| **Explícita** | O Eurico diz "lembra-te que…" / "não te esqueças que…" → classifier reconhece um **novo intent `memorizar`** → tool guarda o facto. Confirmação textual + undo 30s (padrão J-7). | ✅ **Começar aqui.** É consentida (confiança), determinística (sem inferência a errar), e reutiliza o pipeline classifier→planner→executor→undo tal-e-qual. |
| **Inferida** | O motor extrai factos de conversas normais ("reparei que…") e guarda-os, idealmente com confirmação. | ⏭️ v2.x. Exige heurísticas de extracção + gestão de falsos positivos + captura sem consentimento explícito = risco de confiança. Não é espinha. |

**Disciplina de espinha:** captura **explícita-primeiro**. A inferida só faz sentido depois de a espinha explícita estar viva e de o Eurico confiar no mecanismo. Um "esquecer" honesto ("esquece que X" → delete) deve entrar cedo (senão a memória vira uma armadilha de dados errados) — proponho-o como intent gémeo no MVP ou logo a seguir (decisão D5).

---

## 3. Como a memória é usada

Duas superfícies de consumo, ambas reutilizando padrões provados:

1. **No motor (resposta-em-conversa)** — injectar as memórias como **prefixo da user message**, exactamente como `serializeAccountContextForPlanner` faz com as contas. Um bloco `[O que sei sobre ti]` antecede o prompt do Eurico. Zero alteração ao `system`/`tools` (cache Anthropic preservado; redaction NFR12 por construção).
2. **No brief diário** — o job `generate-daily-brief.ts` passa as memórias ao passo de síntese LLM, para o brief respeitar preferências (tom, restrições tipo "não me marques nada antes das 10h").

### Retrieval: keyword vs semântico vs nenhum

Para **1 utilizador com dezenas de memórias**, o retrieval é uma solução para um problema que ainda não existe. O `accountContext` não faz "retrieval de contas" — injecta **todas** as contas do household. A memória deve fazer o mesmo:

> **MVP = injectar TODAS as memórias (com um cap de segurança, ex. as N=50 mais recentes), sem qualquer passo de retrieval.**

- **Keyword (`ilike`/tsvector):** só necessário quando o volume de memórias não cabe/dilui o prefixo. Adiar até haver sinal real de volume — v2.x.
- **Semântico (embeddings/pgvector):** só necessário quando keyword falha em recall. Puramente prematuro para 1 utilizador — v2.x ou v3. **Rejeitado do MVP.**

Isto é a decisão anti-over-engineering mais importante do brief: **inject-all-capped**, não retrieval.

---

## 4. Storage & privacidade

### Esboço de schema mínimo (não DDL — é do @data-engineer)

Tensão real: `jarvis_facts` (existente) é key-value com `unique(household_id, key)` — perfeito para *settings* estruturados (`timezone`, `brief_tone`), mas **mau para memórias em texto livre** ("odeio reuniões antes das 10h" não tem uma "key" natural, e duas memórias sobre o mesmo tema colidiriam no unique). Forçar texto livre para dentro de key-value seria um mau encaixe.

**Recomendação:** nova tabela `jarvis_memories` para texto livre; `jarvis_facts` fica para settings estruturados (não se toca no que existe).

```
jarvis_memories (esboço — o @data-engineer fecha o DDL)
  id            uuid   PK default gen_random_uuid()
  household_id  uuid   NOT NULL FK households(id) ON DELETE CASCADE   -- tenancy (NFR5)
  content       text   NOT NULL                                       -- a memória em PT-PT, texto livre
  source        text   NOT NULL DEFAULT 'explicit'                    -- 'explicit' agora; 'inferred' em v2.x
  created_at    timestamptz NOT NULL default now()
  updated_at    timestamptz NOT NULL default now()                    -- trigger set_updated_at() (não update_updated_at_column — gotcha J-2)
  index (household_id)
```

Deliberadamente **fora** do MVP (adiar): `tags`/`category`, `tsvector` (FTS), `embedding` (pgvector), `expires_at`, `confidence`. Adicionam-se quando o retrieval entrar (v2.x).

### Privacidade (a confiança é o produto — north-star §7)

- **4 RLS policies obrigatórias** (SELECT/INSERT/UPDATE/DELETE) via DO-block em `0001_rls_policies.sql` (o gate `check-rls-coverage.ts` lê APENAS a 0001). A migration nova cria só a tabela + trigger. **Gotcha J-3 a repetir:** as policies em 0001 **não chegam a prod** via `db:migrate` (o runner faz skip de ficheiros já registados) → aplicar o DO-block manualmente no Supabase SQL Editor pós-migrate.
- Predicate cross-tenancy: `household_id = public.current_household_id()` (padrão espelhado de `telegram_link`/`daily_briefing_cache`/`jarvis_facts`).
- Redaction de conteúdo de memória nos logs (reutiliza `packages/agent/src/redaction.ts`, NFR-J5).
- Dados na UE (Supabase `eu-central-1`); sem `any` (TS strict); PT-PT.
- "Esquecer" honesto e revogação (delete real, sem memória fantasma) — dados íntimos exigem que o Eurico possa apagar.

---

## 5. Decisões de âmbito — DEFAULTS propostos para o Eurico confirmar/corrigir

> Formato: cada decisão traz um default sensato. Se concordas, não respondas nada; corrige só as que quiseres mudar.

| # | Decisão | Default proposto |
|---|---------|------------------|
| **D1** | Como se captura? | **Explícita-primeiro** ("lembra-te que…" → novo intent `memorizar`). Inferência automática de conversas adiada para v2.x. |
| **D2** | Onde se guarda? | **Nova tabela `jarvis_memories`** (texto livre). Não forçar para `jarvis_facts` (que fica para settings estruturados como timezone/tom). |
| **D3** | Como se recupera para usar? | **Nenhum retrieval no MVP — injectar todas as memórias (cap N=50 recentes)** como prefixo, igual ao `accountContext`. Keyword e embeddings adiados para v2.x. |
| **D4** | Onde se usa? | **Ambos** — injectada no motor (prefixo da user message) E no brief diário das 07:30. |
| **D5** | Esquecer entra já? | **Sim** — intent gémeo `esquecer` ("esquece que X" → delete) no MVP. Sem ele, uma memória errada vira armadilha permanente. Editar/listar via UI fica adiado. |

---

## 6. Stories candidatas — a espinha v2 ponta-a-ponta

Prefixo proposto: **`M-`** (Memória), a seguir à série `J-` da Fase 1. O @sm afina os AC no draft.

| Story | Título | Âmbito E2E | Depende de |
|-------|--------|-----------|------------|
| **M-1** | Capturar + guardar memória explícita | Novo intent `memorizar` no classifier → nova tool `remember_memory` (escreve em `jarvis_memories`, atómica, com `reverse_op` para undo). E2E: Eurico diz "lembra-te que odeio reuniões antes das 10h" → Jarvis: "Vou lembrar-me disso. (Cancelar)". Inclui migration `jarvis_memories` + 4 RLS policies (0001, aplicar DO-block em prod). | — (base já existe) |
| **M-2** | Injectar memória no motor (usar num prompt real) | `buildMemoryContext(householdId)` + `serializeMemoryContextForPlanner` (prefixo `[O que sei sobre ti]`, padrão `accountContext`). E2E: memorizar X em M-1 → num prompt posterior o Jarvis reflecte X sem lho relembrarem. **É aqui que a espinha fecha o ciclo capturar→guardar→usar.** | M-1 |
| **M-3** | Memória no brief diário | `generate-daily-brief.ts` passa as memórias ao passo de síntese. E2E: memória "não me marques nada antes das 10h" muda como o brief comenta a agenda da manhã. | M-1, M-2 |
| **M-4** (candidata, pós-espinha) | Esquecer memória | Intent `esquecer` → tool `forget_memory` (delete RLS-scoped + undo). E2E: "esquece que X" → apagado; o Jarvis deixa de o usar. | M-1 |

**A espinha mínima = M-1 + M-2** (capturar → guardar → usar num prompt real). M-3 estende ao brief; M-4 fecha o ciclo de confiança (esquecer). Se D5 = sim, M-4 sobe para dentro da espinha, logo a seguir a M-2.

---

## 7. Riscos & mitigações (obrigatório)

| Risco | Sev. | Mitigação |
|-------|------|-----------|
| **R1 — Prompt bloat:** injectar memórias cresce o prefixo → custo/latência + dilui o foco do LLM. | Média | Cap N=50 + só explícitas no MVP (1 utilizador → dezenas, não milhares). Reavaliar retrieval só quando o cap for atingido (sinal real → v2.x). |
| **R2 — Confiança/privacidade:** memórias são dados íntimos; captura silenciosa ou fuga mina o produto. | Alta | Captura só explícita+consentida no MVP; RLS household-scoped; redaction em logs; UE; "esquecer" honesto (D5). |
| **R3 — Memória errada/desactualizada** persistida → Jarvis age sobre premissa falsa. | Média | `updated_at` + intent `esquecer` (D5) + `source` para distinguir explícito de inferido no futuro. |
| **R4 — Over-engineering:** embeddings/pgvector/retrieval prematuros queimam a espinha. | Alta | Decisão D3 (inject-all-capped) rejeita explicitamente retrieval no MVP. Guard-rail de scope no draft das stories. |
| **R5 — Inferência automática** introduzida cedo demais → ruído + captura sem consentimento. | Média | Adiada por design para v2.x (D1), sempre com confirmação quando entrar. |
| **R6 — Regressão RLS (NFR5):** tabela nova sem as 4 policies parte o build; e as policies em 0001 não chegam a prod via `db:migrate`. | Alta | Repetir o pattern J-3: policies em 0001 + DO-block manual em prod pós-migrate; testes exercem `withHousehold` real (lição SEC-8.1), nunca mocks do caminho de tenancy. |

---

## 8. O que este brief NÃO decide (fica para os próximos agentes)

- DDL final de `jarvis_memories`, índices, formato exacto do prefixo → **@data-engineer / @architect**.
- AC testáveis, ordem fina e estimativa das stories M-* → **@sm** no draft, **@po** na validação.
- Nome exacto dos intents/tools (`memorizar`/`esquecer`, `remember_memory`/`forget_memory`) → afinar no draft contra `INTENT_VALUES` real.
- Prompt de sistema do passo de síntese do brief com memória → **@dev** com prompt versionado (padrão `packages/*/src/prompts/`).
