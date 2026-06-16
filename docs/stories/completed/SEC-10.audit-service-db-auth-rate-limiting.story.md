# Story SEC-10: Auditoria getServiceDb + avaliação rate-limiting auth

## Status

Done

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["pnpm lint", "pnpm typecheck", "pnpm --filter @meu-jarvis/web test", "pnpm build", "pnpm check:rls"]
```

## Story

**As a** equipa de segurança Expressia,
**I want** um inventário documentado e verificado de todos os usos de `getServiceDb()` no código de produção, e uma avaliação do rate-limiting nos endpoints de autenticação GoTrue,
**so that** possamos garantir que o cliente `service_role` (que IGNORA RLS por design) nunca é utilizado em caminhos de utilizador final, e que os endpoints de registo/login/reset-de-password têm protecção adequada contra brute-force e abuso antes do soft-launch com tráfego real.

## Acceptance Criteria

1. O `@dev` executa uma pesquisa estática exaustiva de todos os usos reais de `getServiceDb()` no código de produção (excluindo testes e comentários) em `apps/web/src/**` e `packages/**`, documenta cada ocorrência numa tabela no Dev Agent Record com: ficheiro, linha, contexto (função/handler), classificação (`LEGÍTIMO` ou `SUSPEITO`) e justificação. A classificação é `LEGÍTIMO` para: jobs Inngest controlados (sem JWT de utilizador no contexto), `incrementQuota` em `audit-log.ts` (excepção permanente D50 — RLS bloqueia `agent_quotas` a `authenticated`), operações de `undo/route.ts` (excepção permanente D-12C — trigger de imutabilidade bloqueia `authenticated`). Qualquer uso em route handlers, RSC ou Server Actions fora dessas excepções documentadas é classificado `SUSPEITO` e exige migração para `getDb()`/`withHousehold` ou justificação aceite pelo `@architect`.

2. Se a auditoria do AC1 concluir "zero ocorrências suspeitas, todos os usos são legítimos", este resultado é documentado explicitamente como conclusão positiva da auditoria no Dev Agent Record — o valor está na evidência, não necessariamente em encontrar violações.

3. Independentemente do resultado da auditoria, é adicionado um comentário de guard JSDoc explícito na função `getServiceDb()` em `packages/db/src/client.ts` (e/ou em `apps/web/src/lib/agent/db-shim.ts`) que enumera as três excepções permanentes documentadas — jobs Inngest, `incrementQuota` D50, undo D-12C — e afirma explicitamente "NUNCA usar em response handlers de utilizador final". O formato deve ser rastreável: referência ao CLAUDE.md §Multi-tenancy, ADR-003, e SEC-10.

4. É adicionado um teste unitário em `packages/db/src/__tests__/` (ou ficheiro equivalente) que valida que `getServiceDb()` usa a variável `DATABASE_URL_SERVICE_ROLE` (ou `SUPABASE_DB_URL` como fallback) e lança erro se nenhuma das duas estiver definida — confirmar que a função não pode ser acidentalmente usada com a `DATABASE_URL` de runtime normal.

5. O `@dev` documenta o estado actual do rate-limiting nativo do GoTrue/Supabase para os três endpoints de autenticação em uso (`signUp`, `signInWithPassword`, `resetPasswordForEmail`): identificar os códigos de erro GoTrue já mapeados em `apps/web/src/app/(auth)/_lib/error-messages.ts` (`over_email_send_rate_limit`, `over_request_rate_limit`) como evidência de que os limites nativos existem e são comunicados ao utilizador, e documentar no runbook `docs/runbooks/supabase-auth-setup.md` §7 (Troubleshooting) ou numa nova §8 (Rate Limiting) os limites nativos do GoTrue que se aplicam (referência: documentação Supabase Auth — limites padrão do plano Free/Pro para email sends e requests por hora).

6. Se os limites nativos do GoTrue forem considerados insuficientes para produção (decisão do `@dev` com base na documentação Supabase e no contexto PT-PT de soft-launch), implementar um guard de app-level no middleware Next.js (`apps/web/src/middleware.ts`) ou nas Server Actions de auth (`apps/web/src/app/(auth)/actions.ts`) que adicione rate-limiting por IP para os endpoints `/entrar`, `/registar`, e `/recuperar` — usando apenas lógica em-memória leve (sem Redis/Upstash em MVP) ou delegar via cabeçalho de configuração do Supabase. Se os limites nativos forem considerados suficientes, documentar explicitamente essa decisão com justificação no Dev Agent Record como `[AUTO-DECISION]`.

7. Qualquer acção que requeira configuração externa no Supabase Dashboard (ex.: ajustar limites de rate limiting em Authentication → Rate Limits, activar CAPTCHA, ou restringir origens) é documentada como acção `[EURICO]` no runbook de auth, com passos concretos e localização no Dashboard.

8. `pnpm lint` (--max-warnings=0), `pnpm typecheck`, `pnpm --filter @meu-jarvis/web test` (incluindo os novos testes do AC4), `pnpm build` e `pnpm check:rls` passam sem erros.

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI não está activado em `core-config.yaml`.
> A validação de qualidade utiliza processo de revisão manual pelo `@architect`.

## Tasks / Subtasks

- [x] Tarefa 1 — Auditoria estática de usos de `getServiceDb()` (AC: 1, 2)
  - [x] 1.1 Executar pesquisa grep de `getServiceDb` em `apps/web/src/**/*.ts` e `packages/**/*.ts`, excluindo ficheiros `*.test.ts`, `*.spec.ts`, e linhas que sejam apenas comentários (linhas começadas por `*` ou `//`).
  - [x] 1.2 Para cada ocorrência de produção encontrada, registar: ficheiro, número de linha, função/contexto envolvente, classificação (LEGÍTIMO/SUSPEITO) e justificação. Usar a tabela do Dev Agent Record para este inventário.
  - [x] 1.3 Verificar especificamente os caminhos críticos identificados no ADR-003 §D6 e §12.3: `generate-recurring-tasks.ts`, `generate-finance-recurrences.ts`, `cleanup-expired-reverse-ops.ts` (jobs Inngest — LEGÍTIMOS), `audit-log.ts::incrementQuota` (excepção D50 — LEGÍTIMO), `undo/route.ts` (excepção D-12C — LEGÍTIMO).
  - [x] 1.4 Se alguma ocorrência for classificada SUSPEITA: abrir sub-tarefa de migração para `getDb()`/`withHousehold` e registar como bloqueador para `@architect`. (N/A — zero ocorrências suspeitas; conclusão positiva.)
  - [x] 1.5 Documentar conclusão explícita no Dev Agent Record: "Auditoria SEC-10 — N ocorrências de produção, N legítimas, N suspeitas."

- [x] Tarefa 2 — Guard JSDoc em `getServiceDb()` (AC: 3)
  - [x] 2.1 Actualizar o comentário JSDoc de `getServiceDb()` em `packages/db/src/client.ts` para enumerar explicitamente as três categorias de uso legítimo e as referências rastreáveis (CLAUDE.md, ADR-003, SEC-10).
  - [x] 2.2 Actualizar o comentário JSDoc do wrapper `getServiceDb()` em `apps/web/src/lib/agent/db-shim.ts` de forma consistente com `client.ts`.
  - [x] 2.3 Confirmar que o comentário menciona explicitamente "NUNCA usar em response handlers de utilizador final" para ser indexável por pesquisa futura.

- [x] Tarefa 3 — Teste unitário de `getServiceDb()` (AC: 4)
  - [x] 3.1 Em `packages/db/src/__tests__/client.test.ts` (ou criar `getServiceDb.test.ts` se não existir), adicionar testes que: (a) verificam que, com `DATABASE_URL_SERVICE_ROLE` definida, `getServiceDb()` não lança e devolve um objecto não-nulo; (b) verificam que, sem `DATABASE_URL_SERVICE_ROLE` mas com `SUPABASE_DB_URL`, usa o fallback; (c) verificam que, sem nenhuma das duas variáveis, `getServiceDb()` lança o erro `[db/client] DATABASE_URL_SERVICE_ROLE não definido`.
  - [x] 3.2 Usar `vi.stubEnv` / `vi.unstubAllEnvs()` em `afterEach` para isolar os testes de variáveis de ambiente (padrão SEC-9 PO-FIX-1).
  - [x] 3.3 Confirmar que os novos testes passam em isolamento: `pnpm --filter @meu-jarvis/db test`.

- [x] Tarefa 4 — Avaliação rate-limiting auth GoTrue (AC: 5, 6, 7)
  - [x] 4.1 Verificar que `apps/web/src/app/(auth)/_lib/error-messages.ts` já mapeia `over_email_send_rate_limit` e `over_request_rate_limit` para mensagens PT-PT acionáveis — documentar como evidência de que o GoTrue aplica rate-limiting nativo e a app o comunica correctamente ao utilizador.
  - [x] 4.2 Consultar a documentação do Supabase Auth e documentar os limites actuais relevantes no runbook `docs/runbooks/supabase-auth-setup.md` numa nova **§9** "Rate Limiting de Autenticação" (PO-FIX-2: §9, não §8 — a §8 "Operações comuns" já existe).
  - [x] 4.3 Avaliar se os limites nativos GoTrue são suficientes para o contexto PT-PT de soft-launch (baixo volume inicial, utilizadores convidados). Decisão `[AUTO-DECISION]` documentada no Dev Agent Record + runbook §9: limites nativos SUFICIENTES, sem guard de app-level (em-memória é inútil em serverless).
  - [x] 4.4 Documentar como acção `[EURICO]` no runbook §9 as configurações de rate-limiting disponíveis no Dashboard Supabase: `Authentication → Rate Limits` (se o plano o permitir) e/ou activação de CAPTCHA. Incluir URL de navegação no Dashboard e descrição dos campos.
  - [x] 4.5 Confirmar que o endpoint `/recuperar` (reset de password) tem protecção adequada. PO-FIX-1: o reset NÃO mapeia o rate-limit para mensagem específica — colapsa todos os erros numa mensagem neutra por design anti-enumeration (provado por teste `actions.test.ts`). Documentada a decisão de design no runbook §9, SEM introduzir mapping (seria regressão).

- [x] Tarefa 5 — Quality gate final (AC: 8)
  - [x] 5.1 `pnpm lint` (--max-warnings=0) verde.
  - [x] 5.2 `pnpm typecheck` verde.
  - [x] 5.3 `pnpm --filter @meu-jarvis/db test` verde (incluindo novos testes AC4).
  - [x] 5.4 `pnpm --filter @meu-jarvis/web test` verde (suite completa).
  - [x] 5.5 `pnpm build` verde.
  - [x] 5.6 `pnpm check:rls` verde (confirmar que nenhuma tabela com `household_id` foi adicionada sem as 4 policies — esta story não tocou em schema/migrations).

## Dev Notes

### Contexto e motivação

Esta story foi identificada no handoff `docs/handoffs/mj-handoff-sec9-done-next-followups-20260616.yaml` (campo `next_action`) como um dos candidatos imediatos pós-SEC-9: "auditoria de usos de `getServiceDb` fora dos jobs controlados + avaliar rate-limiting GoTrue na auth". É higiene de segurança pré-soft-launch, independente da cadeia RLS-runtime SEC-1→8.1 e do HOLD do SEC-8 Fatia D.

**Frente 1 — Auditoria `getServiceDb()`:**

A função `getServiceDb()` usa o role `service_role` que tem `rolbypassrls = TRUE` — ignora completamente as 104 RLS policies do schema (confirmado em ADR-003 §D6 e `diag-rls-runtime.ts`). O CLAUDE.md §Multi-tenancy afirma explicitamente: "NUNCA usar em response handlers de utilizador (rotas/RSC/Server Actions com utilizador final)." Os usos legítimos são: migrations, jobs Inngest controlados (sem JWT de utilizador), scripts de admin.

Com base em pesquisa estática prévia ao draft desta story, os usos de produção identificados são:

| Ficheiro | Contexto | Classificação esperada |
|----------|----------|------------------------|
| `apps/web/src/lib/inngest/functions/generate-recurring-tasks.ts` | Job Inngest cron — sem JWT | LEGÍTIMO |
| `apps/web/src/lib/inngest/functions/generate-finance-recurrences.ts` | Job Inngest cron — sem JWT | LEGÍTIMO |
| `apps/web/src/lib/inngest/functions/cleanup-expired-reverse-ops.ts` | Job Inngest cron — sem JWT | LEGÍTIMO |
| `apps/web/src/lib/agent/audit-log.ts::incrementQuota()` | Excepção D50 — RLS bloqueia `agent_quotas` a `authenticated` (ADR-003 §12.3) | LEGÍTIMO |
| `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts` | Excepção D-12C — trigger de imutabilidade bloqueia `authenticated` para transição `success→reverted` (ADR-003 §12.5) | LEGÍTIMO |

O `@dev` confirma ou corrige esta tabela com evidência de linha. Se o resultado for "zero violações", documentar explicitamente — é resultado válido e útil.

O `db-shim.ts` (`apps/web/src/lib/agent/db-shim.ts`) é o ponto de re-exportação de `getServiceDb` para `apps/web` — os imports de produção em `apps/web` usam sempre `@/lib/agent/db-shim` (não `@meu-jarvis/db` directamente). O guard JSDoc deve cobrir ambos.

**Frente 2 — Rate-limiting auth GoTrue:**

O GoTrue aplica rate-limiting nativo. A evidência no código:
- `error-messages.ts` já mapeia `over_email_send_rate_limit` → "Demasiados pedidos de registo deste endereço" e `over_request_rate_limit` → "Demasiados pedidos. Aguarda..." para signUp e signIn.
- `actions.test.ts` testa o caso `{ error: { message: 'rate limit' } }` para `resetPasswordAction`, confirmando que o GoTrue o sinaliza.

O que falta: documentar os limites exactos do plano actual e validar se são adequados para produção. Supabase Auth (GoTrue) aplica por defeito (plano Free/Pro):
- `over_email_send_rate_limit`: ~4 emails por hora por email address (configurável no Dashboard `Authentication → Settings → Rate Limits`).
- `over_request_rate_limit`: ~30 requests por hora por IP para endpoints de auth sem sessão (login, registo, reset).

Estes limites são suficientes para um soft-launch com volume baixo e utilizadores convidados — mas o `@dev` deve confirmar contra a documentação actual do Supabase e documentar a decisão.

**O que esta story NÃO faz:**
- Não implementa SEC-8 Fatia D (em HOLD).
- Não toca em billing/Stripe (CONGELADO).
- Não altera schema, migrations, nem RLS policies (104 policies intactas).
- Não implementa CAPTCHA (acção [EURICO] se o Supabase Dashboard o permitir no plano actual).

### Ficheiros principais a verificar/modificar

- `packages/db/src/client.ts` — JSDoc de `getServiceDb()` (AC3)
- `apps/web/src/lib/agent/db-shim.ts` — JSDoc do wrapper `getServiceDb` (AC3)
- `packages/db/src/__tests__/` — novo teste ou extensão de teste existente (AC4)
- `docs/runbooks/supabase-auth-setup.md` — nova §8 rate-limiting (AC5, AC7)
- `apps/web/src/app/(auth)/_lib/error-messages.ts` — verificação/documentação (AC5, sem modificação esperada)

### Ficheiros de suporte para leitura (não modificar)

- `apps/web/src/lib/inngest/functions/generate-recurring-tasks.ts` — padrão de uso legítimo `getServiceDb`
- `apps/web/src/lib/agent/audit-log.ts` — excepção D50
- `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts` — excepção D-12C
- `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` §D6, §12.3, §12.5 — justificações das excepções
- `CLAUDE.md` §Multi-tenancy via Postgres RLS — regra canónica de uso de `getServiceDb`

### Convenções do projecto a respeitar

- Imports absolutos `@/...` ou `@meu-jarvis/...` — sem imports relativos `../../`.
- TypeScript strict: sem `any`; `process.env.NOME` é `string | undefined` — tratar correctamente.
- Comentários e mensagens de erro em PT-PT.
- `pnpm lint --max-warnings=0`: confirmar que os novos comentários JSDoc não introduzem warnings.
- Vitest: `vi.stubEnv` / `vi.unstubAllEnvs()` em `afterEach` para isolar testes de env vars (padrão SEC-9).
- O package `@meu-jarvis/db` é source-only (sem build step) — consumido directamente via `transpilePackages`.

### Referências de arquitectura

- `CLAUDE.md` §Multi-tenancy via Postgres RLS — regra de uso `getServiceDb` vs `getDb`
- `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` §D6, §12.3, §12.5 — excepções documentadas
- `packages/db/src/client.ts` linhas 142-170 — implementação actual de `getServiceDb()`
- `apps/web/src/lib/agent/db-shim.ts` linhas 50-55 — wrapper `getServiceDb` para `apps/web`
- Documentação Supabase Auth GoTrue — Rate Limits: https://supabase.com/docs/guides/auth/auth-rate-limiting

### Testing

- Framework: Vitest com `globals: true`.
- Pacote alvo para AC4: `@meu-jarvis/db` — `pnpm --filter @meu-jarvis/db test`.
- Setup do package db: ambiente `node` (não `jsdom`).
- Padrão de mock de env vars: `vi.stubEnv('DATABASE_URL_SERVICE_ROLE', 'postgres://...')` + `vi.unstubAllEnvs()` em `afterEach`.
- Para testar o caso de erro (sem variáveis definidas): `vi.stubEnv('DATABASE_URL_SERVICE_ROLE', '')` + `vi.stubEnv('SUPABASE_DB_URL', '')` e `expect(() => getServiceDb()).toThrow('[db/client] DATABASE_URL_SERVICE_ROLE não definido')`.
- Nota: `getServiceDb()` usa singleton interno `_serviceDb` — os testes devem garantir que o módulo é recarregado entre casos (usar `vi.resetModules()` antes de `import` dinâmico se necessário, ou estruturar os testes para não depender da ordem de inicialização do singleton).
- Correr suite isolada do db: `pnpm --filter @meu-jarvis/db test`.
- Correr suite isolada do web: `pnpm --filter @meu-jarvis/web test`.

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 16/06/2026 | v1.0 | Draft inicial | @sm River |
| 16/06/2026 | v1.1-DEV | Implementação SEC-10: auditoria getServiceDb (conclusão positiva — zero suspeitos), guards JSDoc (client.ts + db-shim.ts), teste unitário getServiceDb (5 testes), runbook §9 rate-limiting (PO-FIX-1 anti-enumeration + PO-FIX-2 §9). 5/5 gates GREEN. Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Dex / Builder), modo YOLO autónomo.

### Debug Log References

- Teste `getServiceDb.test.ts` (b) falhou na 1.ª execução: `vi.stubEnv('DATABASE_URL_SERVICE_ROLE', '')` define string vazia (não `undefined`); o `client.ts` usa `?? ` (nullish), e `'' ?? x` devolve `''` (falsy) → lançava em vez de cair no fallback `SUPABASE_DB_URL`. Fix: `vi.stubEnv(key, undefined)` no `beforeEach` (remove a var, activa o `??`). Reflecte fielmente a semântica de produção — string vazia é config inválida, não fallback. Re-run: 22/22 db tests GREEN.

### Completion Notes List

**Auditoria SEC-10 — conclusão positiva (AC1 + AC2):**

> **Auditoria SEC-10 — 7 invocações de produção em 5 ficheiros; 7 legítimas; 0 suspeitas.**

Pesquisa estática exaustiva (`getServiceDb` em `apps/web/src/**` + `packages/**`, excluindo `__tests__/`, `*.test.ts` e linhas-comentário). Confirma a tabela esperada do @sm/@po byte-a-byte. Inventário completo de TODAS as invocações reais (call sites `const ... = getServiceDb()`) — os 2 jobs grandes têm 2 invocações cada:

| # | Ficheiro | Linha | Contexto (função/handler) | Classificação | Justificação |
|---|----------|-------|---------------------------|---------------|--------------|
| 1 | `apps/web/src/lib/inngest/functions/generate-recurring-tasks.ts` | 97 | `step.run` (geração de instâncias de tarefas recorrentes) | LEGÍTIMO | Job Inngest cron — sem JWT de utilizador no contexto (ADR-003 §D6). |
| 2 | `apps/web/src/lib/inngest/functions/generate-recurring-tasks.ts` | 242 | `step.run` (2.º passo do mesmo job) | LEGÍTIMO | Idem (mesmo job, 2.ª invocação). |
| 3 | `apps/web/src/lib/inngest/functions/generate-finance-recurrences.ts` | 107 | `step.run` (geração de recorrências financeiras) | LEGÍTIMO | Job Inngest cron — sem JWT (ADR-003 §D6). |
| 4 | `apps/web/src/lib/inngest/functions/generate-finance-recurrences.ts` | 238 | `step.run` (2.º passo do mesmo job) | LEGÍTIMO | Idem (mesmo job, 2.ª invocação). |
| 5 | `apps/web/src/lib/inngest/functions/cleanup-expired-reverse-ops.ts` | 55 | `step.run('delete-expired')` | LEGÍTIMO | Job Inngest cron — DELETE sistémico de reverse ops expirados, sem JWT (ADR-003 §D6). |
| 6 | `apps/web/src/lib/agent/audit-log.ts` | 209 | `incrementQuota(householdId)` | LEGÍTIMO | Excepção permanente D50: RLS bloqueia INSERT/UPDATE em `agent_quotas` a `authenticated` (`0001_rls_policies.sql:342-362`) — sem service_role o hard-stop NFR20 seria não-funcional (ADR-003 §12.3). |
| 7 | `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts` | 183 | `serviceDb` (aplicação de reverse ops + transição `success→reverted`) | LEGÍTIMO | Excepção permanente D-12C: trigger de imutabilidade bloqueia a transição terminal em `authenticated`. Pertença ao `run.household_id` verificada app-enforced ANTES (cross-household → 404, SEC-1-F3). NFR9 (ADR-003 §12.5). |

**Outras ocorrências (não invocações de produção):**
- `apps/web/src/lib/agent/db-shim.ts:55` — definição do wrapper re-exportador (`mod.getServiceDb()`), não um uso de utilizador. Guard JSDoc adicionado (AC3).
- `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts:37` (import) e `:304` (anotação de tipo `ReturnType<typeof getServiceDb>`) — não são invocações.
- `packages/db/src/client.ts:152` — declaração da própria função.
- Restantes ~30 ocorrências em `apps/web`/`packages` são **comentários** que afirmam "NUNCA `getServiceDb()`" em handlers de utilizador (reforço da regra, não usos) ou referências em testes — confirmam a higiene existente.

**Resultado:** ZERO usos suspeitos em route handlers, RSC ou Server Actions fora das três excepções documentadas. O valor desta story está na evidência verificada — todos os caminhos de utilizador usam `getDb()`/`withHousehold()`. Tarefa 1.4 (migração) N/A.

**AC3 — Guards JSDoc:** adicionados em `packages/db/src/client.ts::getServiceDb()` e `apps/web/src/lib/agent/db-shim.ts::getServiceDb()`. Ambos enumeram as 3 categorias legítimas, citam CLAUDE.md §Multi-tenancy + ADR-003 §D6/§12.3/§12.5 + SEC-10, e contêm a string indexável **"NUNCA usar em response handlers de utilizador final"**.

**AC4 — Teste unitário:** `packages/db/src/__tests__/getServiceDb.test.ts` (5 testes): (a) com `DATABASE_URL_SERVICE_ROLE` → objecto não-nulo + URL correcto; (b) fallback `SUPABASE_DB_URL`; (c) sem nenhuma → erro PT-PT exacto; + NÃO usa `DATABASE_URL` de runtime; + precedência da var primária. Singleton isolado com `vi.resetModules()` + `import('@/client')` dinâmico por teste (padrão SEC-9 PO-FIX-1, `vi.unstubAllEnvs()` em `afterEach`). Mock de `postgres` + `drizzle-orm/postgres-js` — não toca DB real. db suite: 17→22 (+5).

**AC5 + PO-FIX-1 (anti-enumeration) — documentação rate-limiting:** runbook §9 documenta os limites nativos GoTrue e que `error-messages.ts` já mapeia `over_email_send_rate_limit`/`over_request_rate_limit` em PT-PT para signUp/signIn. **PO-FIX-1 aplicado:** o reset de password NÃO mapeia o rate-limit — colapsa todos os erros numa mensagem neutra por design anti-enumeration (`resetPasswordAction` em `actions.ts:240-243`, blindado pelo teste `actions.test.ts` "erro do Supabase → mensagem neutra"). A story (AC5/Tarefa 4.5) e a implementação documentam esta decisão de design; NENHUM código de reset foi tocado (evitada a regressão). Zero ficheiros de auth modificados.

**AC6 — `[AUTO-DECISION]`:** limites nativos GoTrue **suficientes** para soft-launch PT-PT de baixo volume; **não** se implementa guard de app-level. Razão principal: rate-limiter em-memória é inútil em serverless (Vercel `fra1` — estado não partilhado entre lambdas/cold starts, falsa protecção); guard robusto exigiria Upstash/Redis, fora do âmbito MVP. Documentado em detalhe no runbook §9 ("Avaliação de suficiência"). Reavaliar se o tráfego crescer além do convite ou surgirem sinais de abuso.

**AC7 — `[EURICO]`:** runbook §9 documenta 3 acções de Dashboard: (1) ajustar Rate Limits em `Authentication → Rate Limits` (planos pagos); (2) activar CAPTCHA em Bot/Abuse Protection — com aviso de âmbito de que SEM o widget no frontend bloquearia todos os pedidos (story de frontend dedicada futura); (3) SMTP custom Resend (§4). Sem código.

**Governação respeitada:** billing/Stripe não tocado; SEC-8 Fatia D não tocado; ZERO migrations/schema/RLS policies (104 policies + 28 tabelas intactas — `check:rls` exit 0). Imports `@/...`/`@meu-jarvis/...`, PT-PT, sem `any`.

**Quality gates (5/5 GREEN):**
- `pnpm lint` — No ESLint warnings or errors (10/10 tasks).
- `pnpm typecheck` — 10/10 tasks OK.
- `pnpm --filter @meu-jarvis/db test` — 22/22 (17 baseline + 5 novos AC4).
- `pnpm --filter @meu-jarvis/web test` — 1199/1199 (149 ficheiros).
- `pnpm build` — exit 0 (warnings turbo "no output files" são cosméticos para packages source-only).
- `pnpm check:rls` — exit 0 (28 tabelas, coverage intacto).

**CodeRabbit:** SKIPPED — Disabled em `core-config.yaml` (mcp.enabled: false); validação de qualidade via `@architect` *qa-gate.

### File List

**Modificados:**
- `packages/db/src/client.ts` — guard JSDoc de `getServiceDb()` (AC3).
- `apps/web/src/lib/agent/db-shim.ts` — guard JSDoc do wrapper `getServiceDb()` (AC3).
- `docs/runbooks/supabase-auth-setup.md` — nova §9 "Rate Limiting de Autenticação" (AC5/AC6/AC7 + PO-FIX-1 anti-enumeration + PO-FIX-2 numeração §9).
- `docs/stories/active/SEC-10.audit-service-db-auth-rate-limiting.story.md` — checkboxes, Dev Agent Record, Status.

**Criados:**
- `packages/db/src/__tests__/getServiceDb.test.ts` — teste unitário de `getServiceDb()` (AC4, 5 testes).

**Verificados (não modificados):**
- `apps/web/src/app/(auth)/_lib/error-messages.ts` — mapeamento de rate-limit signUp/signIn (AC5, evidência).
- `apps/web/src/app/(auth)/actions.ts` — `resetPasswordAction` anti-enumeration (PO-FIX-1, NÃO tocado).
- `apps/web/src/lib/inngest/functions/{generate-recurring-tasks,generate-finance-recurrences,cleanup-expired-reverse-ops}.ts`, `apps/web/src/lib/agent/audit-log.ts`, `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts` — inventário da auditoria (AC1).

## QA Results

### Review Date: 16/06/2026

### Reviewed By: Quinn (Test Architect) — gate adversarial e independente

Re-verifiquei cada AC byte-a-byte contra o código real, sem confiar no relatório do @dev/@po. Todos os focos adversariais confirmados.

**Focos adversariais (evidência própria):**

| Foco | Veredicto | Evidência |
|------|-----------|-----------|
| AC1/AC2 — completude da auditoria | PASS | Grep próprio: 7 call sites de produção exactos em 5 ficheiros (`generate-recurring-tasks.ts:97,242`, `generate-finance-recurrences.ts:107,238`, `cleanup-expired-reverse-ops.ts:55`, `audit-log.ts:209`, `undo/route.ts:183`). Confirma a tabela byte-a-byte. ZERO usos em RSC/route handlers/Server Actions de utilizador fora das 3 excepções. Restantes ocorrências são imports, comentários "NUNCA getServiceDb()", tipos ou mocks. |
| PO-FIX-1 — reset anti-enumeration | PASS | `git diff apps/web/src/app/(auth)/**` = vazio. `resetPasswordAction` (actions.ts:240-243) mantém mensagem neutra; NENHUM mapping de rate-limit introduzido. Zero ficheiros de auth tocados — provado. |
| AC3 — guards JSDoc | PASS | `client.ts` + `db-shim.ts` enumeram as 3 excepções com refs (CLAUDE.md, ADR-003 §D6/§12.3/§12.5, SEC-10) e a string indexável "NUNCA usar em response handlers de utilizador final". Só documentação — implementação inalterada, nenhuma protecção enfraquecida. |
| AC4 — teste unitário | PASS | `getServiceDb.test.ts` cobre os 3 casos exigidos + 2 extra; `vi.resetModules()` + import dinâmico isolam o singleton `_serviceDb`; não-tautológico (captura o URL passado ao driver). 22/22 db tests. |
| AC6 — [AUTO-DECISION] sem guard app-level | PASS | Justificação sólida: rate-limiter em-memória é inútil em serverless `fra1` (estado não partilhado entre lambdas). Limites nativos GoTrue + comunicação PT-PT adequados ao soft-launch. Critério de reavaliação definido. |

**Gates re-corridos (output real verificado):**

| Gate | Resultado |
|------|-----------|
| `pnpm lint` | PASS — 0 warnings/errors |
| `pnpm typecheck` | PASS |
| `pnpm check:rls` | PASS — exit 0, coverage intacto |
| `pnpm --filter @meu-jarvis/db test` | PASS — 22/22 (inclui os 5 novos AC4) |
| `pnpm --filter @meu-jarvis/web test` | PASS — 1199/1199 (149 ficheiros) |
| `pnpm build` | PASS — exit 0 |

**Governação:** ZERO migrations/schema/RLS policies; billing/Stripe não tocado; SEC-8 Fatia D não tocado; ficheiros de auth não tocados. Confirmado.

**Score:** 9.6/10 — story de segurança modelar; -0.4 porque o valor é sobretudo hardening preventivo/documental e os limites exactos de rate-limit dependem de confirmação no Dashboard (acção [EURICO]).

### Gate Status

Gate: PASS → docs/qa/gates/SEC-10-audit-service-db-auth-rate-limiting.yml
