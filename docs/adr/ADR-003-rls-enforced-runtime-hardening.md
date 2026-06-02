# ADR-003 — RLS enforced em runtime (hardening defense-in-depth)

| Campo | Valor |
|-------|-------|
| **Estado** | Proposta (aguarda ratificação → story futura `@sm draft` → `@dev`) |
| **Data** | 02/06/2026 |
| **Autor** | Aria (@architect) |
| **Decisores** | @architect (decisão técnica); detalhe DDL/policies → @data-engineer; ratificação estratégica → Eurico |
| **Severidade do problema** | HIGH — defesa única actual é aplicacional (frágil); uma query nova sem filtro = vazamento cross-tenant |
| **Contexto-fonte** | Memória `runtime_authuid_rls_gap`, `finding_rls_inert_runtime`; commit `6f56e32` (SEC-1); scripts `diag-rls-runtime.ts`, `diag-getdb-auth.ts` |
| **Constraint dominante** | pgbouncer transaction-mode (porta 6543) — connection física partilhada entre requests |
| **Supersedes** | — (corrige o comentário enganador em `packages/db/src/client.ts:10-14`) |

---

## 1. Contexto

### 1.1 — O problema-raiz (confirmado empiricamente)

`getDb()` (`packages/db/src/client.ts:37-57`) abre uma connection `postgres-js` crua via `DATABASE_URL` (Supabase pooler, porta 6543, pgbouncer transaction-mode). Essa connection **não passa pelo PostgREST do Supabase** — liga directamente ao Postgres como role `postgres`, que tem `rolbypassrls = TRUE`. Logo as **104 RLS policies (FORCE RLS está correcto no schema) NUNCA são avaliadas em runtime**.

O comentário no topo de `client.ts` (linhas 10-14) afirma que "connections `authenticated` herdam `auth.uid()` do JWT (Supabase Auth Hook injecta `request.jwt.claims`)". **Isto é FALSO na prática** com postgres-js cru: não há injecção de claims, `request.jwt.claims` fica unset, `auth.uid()` devolve NULL. O comentário deve ser corrigido como parte do plano (§7).

Os scripts de diagnóstico já em git provam-no:
- `diag-getdb-auth.ts` — confirma que `auth.uid()` vem NULL na connection `DATABASE_URL`.
- `diag-rls-runtime.ts` — confirma `rolbypassrls` do role do runtime + estado FORCE RLS por tabela.

### 1.2 — A mitigação actual (SEC-1, commit `6f56e32`)

A Story SEC-1 tornou o isolamento **100% app-enforced**: filtro `household_id` explícito em ~42 queries + sub-queries FK nos POST + sub-rotas do cérebro AI. O `requireAuth(span)` (`apps/web/src/lib/api-helpers/auth.ts:63-93`) já devolve `{ userId, householdId }` em todos os handlers, derivando o `householdId` de `household_members`.

**Funciona hoje, mas é frágil.** O isolamento depende de cada autor lembrar-se de adicionar o filtro `household_id` a cada query nova. Uma query sem o filtro = vazamento cross-tenant silencioso. Não há rede de segurança independente debaixo da aplicação.

### 1.3 — O objectivo deste ADR

Repor a RLS **viva em runtime** como **segunda rede de segurança independente** (defense-in-depth). O Postgres passa a bloquear cross-household por baixo da aplicação — se um filtro aplicacional falhar, a RLS apanha. **Não substituir** o app-enforced (SEC-1), **complementá-lo**.

### 1.4 — A nuance técnica central (pgbouncer transaction-mode)

Na porta 6543, a connection física é **partilhada entre requests/clientes**. Qualquer contexto de identidade (role, claims, GUC) definido com `SET` simples vazaria para o próximo request que reutilizasse a mesma connection física. Portanto **todo o contexto de identidade TEM de ser definido com `SET LOCAL` DENTRO de uma transação** — `SET LOCAL` é confinado à transação e revertido no `COMMIT`/`ROLLBACK`, garantindo que não há fuga de contexto entre requests. Isto colide directamente com o padrão actual de queries auto-commit fora de transação.

### 1.5 — Descobertas arquitecturais decisivas (lidas no código real)

| # | Facto | Evidência |
|---|-------|-----------|
| **D1** | As **104 policies de domínio usam `is_household_member(household_id)`**, que depende de `auth.uid()` — **NÃO** de `current_household_id()`/GUC | `0001_rls_policies.sql:541,544,548,552` (transactions) + 98 ocorrências de `is_household_member`/`auth.uid` no ficheiro |
| **D2** | `is_household_member` lê `auth.uid()` de `household_members` (`security definer`); `auth.uid()` (Supabase) lê `request.jwt.claims ->> 'sub'` | `0000_initial_schema.sql:51-64` |
| **D3** | `current_household_id()` JÁ lê de **ambos**: `request.jwt.claims ->> 'household_id'` **COALESCE** `app.current_household_id` (GUC) | `0000_initial_schema.sql:41-44` |
| **D4** | `setHouseholdContext(db, id)` JÁ faz `set_config('app.current_household_id', $1, true)` parametrizado (3º arg `true` = local à transação) | `client.ts:93-101` (SEC-1 AC-J1) |
| **D5** | `requireAuth(span)` JÁ devolve `{ userId, householdId }` em cada handler — a fonte per-request do `householdId` existe | `auth.ts:63-93` |
| **D6** | `getServiceDb()` usa role `service_role` (`rolbypassrls`) — tem de continuar a ignorar RLS por design (jobs/migrations) | `client.ts:69-87` |

> **A bifurcação que D1+D3 criam:** o GUC `app.current_household_id` só alimenta `current_household_id()`. Mas as policies de domínio **não usam** `current_household_id()` — usam `is_household_member(household_id)`, que precisa de `auth.uid()`. **Definir só o GUC NÃO activa a RLS de domínio.** Esta é a charneira de toda a decisão (§2).

---

## 2. Opções consideradas

A pergunta-A do mandato — "role dedicado `authenticated` + `SET LOCAL request.jwt.claims` vs GUC `app.current_household_id` + policies que leem o GUC" — resolve-se à luz de D1: as policies actuais leem `auth.uid()` via `is_household_member`, logo a fonte de identidade que precisamos de injectar é o **JWT claim `sub`** (= user id), não o `household_id`.

### Opção A — Role `authenticated` (sem bypassrls) + `SET LOCAL request.jwt.claims` por transação

Provisionar uma connection string com role `authenticated` (que **não** tem `rolbypassrls`). Por request, abrir uma transação e fazer `SET LOCAL request.jwt.claims = '{"sub":"<userId>", ...}'`. O `auth.uid()` passa a devolver o `sub`, `is_household_member` passa a funcionar, e **as 104 policies existentes aplicam-se sem qualquer alteração de DDL**.

- **Prós:**
  - **Zero alteração às 104 policies.** Honra o template canónico `is_household_member` (architecture.md §3.2). É o mecanismo que o Supabase desenhou.
  - Reproduz fielmente o ambiente de produção do PostgREST → o teste de aplicação (§5) testa o caminho real.
  - `auth.uid()` correcto também desbloqueia naturalmente funções `security definer` que dele dependem (precedente: `accept_invite` na Story 6.7 teve de contornar `auth.uid()=NULL` — esta opção resolveria a raiz).
- **Contras:**
  - Requer provisionar/validar uma connection string com role `authenticated` (a `DATABASE_URL` actual liga como `postgres`). Pode exigir um role/password dedicado no Supabase, ou `SET LOCAL ROLE authenticated` dentro da transação a partir da connection actual.
  - Construir o objecto `claims` por request (JSON com `sub` + `household_id` + `role`). Tem de ser parametrizado (anti-injection) — `set_config('request.jwt.claims', $1, true)`.
- **Risco isolada:** baixo. É o caminho de menor surpresa semântica.

### Opção B — Manter role actual + GUC `app.current_household_id` + **reescrever** policies para `current_household_id()`

Manter `getDb()` a ligar como está, usar `setHouseholdContext` (GUC, já existe) por transação, e **reescrever as 104 policies** de `is_household_member(household_id)` para `household_id = current_household_id()`.

- **Prós:**
  - Reutiliza `setHouseholdContext` (D4) e o COALESCE de `current_household_id()` (D3) já existentes — o GUC já é lido.
  - Não exige provisionar role novo se o role actual não tiver `rolbypassrls` (mas tem — ver contra).
- **Contras:**
  - **O role actual (`postgres`) tem `rolbypassrls=TRUE` (D1).** Mesmo com o GUC + policies reescritas, a RLS **continuaria a ser ignorada** porque o role bypassa RLS por inteiro. Logo esta opção **obriga na mesma a mudar de role** — não evita o trabalho da Opção A, só lhe acrescenta a reescrita de 104 policies.
  - Reescrever 104 policies (migration grande) muda o modelo mental de `auth.uid()`-based para GUC-based; `current_household_id()` não valida pertença (`is_household_member` faz join a `household_members`) — um GUC mal-definido daria acesso a um household de que o user não é membro. **Perda de uma verificação de segurança.**
  - Diverge do PostgREST real: o teste de aplicação testaria um caminho que produção (se algum dia passar por PostgREST) não usa.
- **Risco isolada:** ALTO. Combina "mudar role na mesma" com "reescrever 104 policies" e "perder a verificação de pertença". Pior dos dois mundos.

### Opção C — Encryption/network-only (status quo + monitorização)

Não tocar na RLS; manter app-enforced (SEC-1) como única defesa e adicionar apenas alertas/auditoria que detectem queries sem filtro `household_id`.

- **Prós:** zero risco de regressão; nenhum trabalho de transação/role.
- **Contras:** **não cumpre o objectivo** (não há segunda rede independente); a fragilidade de SEC-1 mantém-se; detecção ≠ prevenção.
- **Risco isolada:** mantém o risco actual intacto. Rejeitada por não resolver o problema.

---

## 3. Decisão

**Adoptar a Opção A — role `authenticated` (sem `rolbypassrls`) + `SET LOCAL request.jwt.claims` por transação, encapsulado num wrapper `withHousehold(...)`, mantendo as 104 policies intactas.**

### Racional

1. **D1 é decisivo.** As policies existentes leem `auth.uid()` via `is_household_member`. O mecanismo de identidade a injectar é o JWT claim `sub`, exactamente o que a Opção A faz. Honra o template canónico sem reescrever uma única policy.
2. **A Opção B não evita a mudança de role** (o `rolbypassrls` do role actual mata-a) e ainda acrescenta a reescrita de 104 policies + perda da verificação de pertença. Estritamente pior.
3. **A Opção C não resolve o problema.**
4. **`current_household_id()`/GUC fica como mecanismo secundário legítimo** para scripts/jobs sem JWT (o que `setHouseholdContext` + COALESCE já servem) — **não** se toca nele; continua útil para `getServiceDb()`-adjacent admin paths que queiram simular contexto. Mas o caminho de runtime de utilizador final usa claims.

### O contrato do wrapper `withHousehold`

Para responder à pergunta-B (não reescrever ~42 call-sites uma a uma), introduz-se **um único ponto de entrada transaccional**:

```typescript
// CONTRATO (a story implementa; assinatura ilustrativa, não-vinculativa no detalhe)
withHousehold<T>(
  auth: { userId: string; householdId: string },   // vem de requireAuth(span) — D5
  fn: (tx: Database) => Promise<T>,                  // o callback recebe a tx scoped
): Promise<T>
```

Comportamento interno (todos os passos dentro de **uma** transação na connection `authenticated`):

1. `BEGIN`
2. `SET LOCAL request.jwt.claims = $claims` (parametrizado; `$claims` = JSON com `sub: userId`, `household_id: householdId`, `role: 'authenticated'`)
3. *(defesa em profundidade extra, opcional)* `SET LOCAL app.current_household_id = $householdId` — alimenta `current_household_id()` para qualquer policy/função que o use; barato e aditivo.
4. Corre `fn(tx)` — todas as queries do callback herdam o contexto LOCAL e são avaliadas pela RLS.
5. `COMMIT` (ou `ROLLBACK` em erro) — `SET LOCAL` reverte automaticamente; **zero fuga de contexto** para o próximo request na connection partilhada (resolve §1.4).

> A transação é o mecanismo que torna pgbouncer transaction-mode seguro: `SET LOCAL` só existe dentro da transação, e o pooler só devolve a connection ao pool depois do `COMMIT`/`ROLLBACK`. Padrão idiomático Supabase + pgbouncer.

### Resposta às perguntas do mandato

| Pergunta | Resposta |
|----------|----------|
| **A — mecanismo de identidade** | Role `authenticated` (sem bypassrls) + `SET LOCAL request.jwt.claims` com `sub`. As policies actuais (`is_household_member` → `auth.uid()`) funcionam sem alteração. GUC fica como secundário para scripts/jobs. |
| **B — envolver cada query sem reescrever 42 call-sites** | Wrapper `withHousehold(auth, fn)` que abre transação + `SET LOCAL` + corre o callback. As call-sites migram de `getDb()` para `withHousehold(auth, (tx) => ...)` — mudança mecânica, mesma forma em RSC/Server Actions/Route Handlers (todos já têm `auth` de `requireAuth`). |
| **C — de onde vem o householdId por request** | `requireAuth(span)` já o devolve (`auth.ts:81`, derivado de `household_members`). O `userId` (= `sub`) vem do mesmo objecto. Zero infra nova. |
| **D — co-existência app-enforced + RLS** | Sem conflito. App-enforced (filtro `household_id`) é a 1ª rede; RLS é a 2ª, independente. Uma query com filtro correcto passa em ambas; uma query sem filtro é apanhada pela RLS (retorna 0 rows do household errado). Defense-in-depth genuíno. |
| **E — plano faseado + gate** | §6 + §5. |
| **F — risco/rollback** | §8. |

---

## 4. Requer mudança de schema?

**Não nas policies de domínio (intactas). Sim em infraestrutura de connection + um wrapper aplicacional + endurecimento do gate.**

| Mudança | Camada | Schema/DDL? | Delegar a |
|---------|--------|-------------|-----------|
| Provisionar/validar connection com role `authenticated` (sem bypassrls) | Env/infra (`DATABASE_URL_AUTHENTICATED` ou `SET LOCAL ROLE` na tx) | Não (role já existe no Supabase) | @data-engineer valida role; @devops provisiona secret |
| Wrapper `withHousehold(auth, fn)` | `packages/db/src/client.ts` (ou novo módulo) | Não (aplicacional) | @dev |
| Migrar ~42 call-sites `getDb()` → `withHousehold` | `apps/web` handlers/RSC/actions | Não | @dev |
| Corrigir comentário enganador `client.ts:10-14` | `packages/db/src/client.ts` | Não | @dev |
| Endurecer `check-rls-coverage.ts` com teste de **aplicação** real | `scripts/` + CI `rls-gate` | Não (teste) | @dev / @qa |
| 104 RLS policies | — | **NENHUMA alteração** | — |

> Confirmação D6: `getServiceDb()` (jobs Inngest, migrations, GDPR purge, Stripe webhooks) **continua a usar role `service_role`** e a ignorar RLS por design. O wrapper `withHousehold` é **exclusivo** do caminho de utilizador final. Não tocar nos jobs.

### O que delegar a @data-engineer

1. Confirmar o role exacto a usar no Supabase (`authenticated` nativo) e o mecanismo preferido: connection string dedicada com esse role **vs** `SET LOCAL ROLE authenticated` dentro da transação a partir da connection actual. Validar que o role escolhido **não** tem `rolbypassrls` (`diag-rls-runtime.ts` já lista isto).
2. Confirmar o shape mínimo do JSON `request.jwt.claims` que `auth.uid()` exige (`sub`) e que `is_household_member` precisa (faz join a `household_members` por `auth.uid()`) — validar que `sub = userId` é suficiente.
3. Validar que `SET LOCAL` na transação não colide com o `set local check_function_bodies = off` usado em migrations (caminhos distintos — migrations usam `DIRECT_URL`).

@architect retém: a decisão do mecanismo (role authenticated + claims via SET LOCAL), o contrato `withHousehold`, e a co-existência defense-in-depth. @data-engineer detém o role/claims exactos + validação Postgres.

---

## 5. O gate de aplicação real (endurecer NFR5)

O gate actual (`scripts/check-rls-coverage.ts`) só valida que as policies **existem** (parse estático). **NÃO** valida que são **aplicadas** em runtime. O ADR propõe adicionar um **teste de aplicação real**:

1. Aplicar o schema completo num Postgres efémero (já existe no CI job `rls-gate` — Postgres 16).
2. Semear 2 households (A e B) com dados de domínio em cada (≥1 transaction, ≥1 task por household).
3. Abrir uma connection **com o role do runtime** (`authenticated`, sem bypassrls) — o mesmo que `withHousehold` usa.
4. Numa transação com `SET LOCAL request.jwt.claims` = claims do **user do household A**:
   - `SELECT count(*) FROM transactions` → **esperar apenas as rows de A** (0 de B).
   - Tentar `SELECT * FROM transactions WHERE household_id = '<B>'` → **esperar 0 rows** (RLS bloqueia).
   - Tentar `INSERT ... household_id = '<B>'` → **esperar erro/0 rows** (WITH CHECK bloqueia).
5. Repetir simétrico para o user de B.
6. Exit code 1 se qualquer leak (rows de B visíveis a A) — **bloqueia merge**.

> Este teste prova **aplicação**, não só existência. É a diferença entre "as policies estão escritas" e "as policies impedem cross-tenant com o role real do runtime". Pode reutilizar os helpers `diag-rls-runtime.ts`/`diag-rls-visibility.ts` como base.

---

## 6. Plano faseado de implementação (para a story futura)

Ordem por dependência (cada fase é independentemente verificável e reversível):

**Fase 0 — Validação de role (sem código de produção)**
- [@data-engineer] Confirmar role `authenticated` sem `rolbypassrls` e o mecanismo de claims. Provar num script de diagnóstico (estilo `diag-*`) que, com `SET LOCAL request.jwt.claims` numa tx nesse role, `auth.uid()` devolve o `sub` e `is_household_member` devolve `true` para o household certo / `false` para outro.
- **Critério de aceitação:** diagnóstico imprime `auth.uid() = <userId>` e isolamento correcto. Sem isto, parar.

**Fase 1 — Wrapper `withHousehold` + gate de aplicação (sem migrar call-sites)**
- [@dev] Implementar `withHousehold(auth, fn)` em `packages/db`. Corrigir o comentário `client.ts:10-14`.
- [@dev/@qa] Implementar o teste de aplicação real (§5) no CI `rls-gate`.
- **Critério de aceitação:** o teste de aplicação passa com o wrapper; `pnpm typecheck`/`lint`/`test` verdes.

**Fase 2 — Migração incremental das call-sites (por domínio, atrás de paridade)**
- [@dev] Migrar call-sites `getDb()` → `withHousehold(auth, (tx) => ...)` **por domínio** (ex.: tarefas primeiro, depois finanças, depois cérebro AI). Cada PR de domínio mantém o filtro app-enforced (SEC-1) **inalterado** (defense-in-depth) e adiciona a RLS por baixo.
- Ordem sugerida: tarefas → categorias/tags → finanças (accounts/cards/transactions) → cérebro AI (sub-rotas confirm/undo) → restantes.
- **Critério de aceitação por domínio:** testes E2E do domínio passam; o teste de aplicação cobre o domínio; nenhuma query do domínio fica sem contexto household.

**Fase 3 — Limpeza + documentação**
- [@dev] Actualizar `architecture.md` §3.2/§5 e `CLAUDE.md` (multi-tenancy) para descrever o caminho `withHousehold`.
- [@architect/@qa] Confirmar que `getServiceDb()` não foi tocado e que todos os jobs Inngest continuam a funcionar.

### Critérios de aceitação globais

1. Teste de aplicação real no CI prova isolamento cross-tenant com o role do runtime (leak = build falha).
2. Todas as call-sites de utilizador final passam por `withHousehold`; `getServiceDb()` permanece exclusivo de jobs/migrations.
3. App-enforced (SEC-1) **mantido** — nenhum filtro `household_id` removido.
4. Comentário `client.ts:10-14` corrigido (sem afirmação falsa sobre herança de claims).
5. `diag-getdb-auth.ts` (ou sucessor) passa a mostrar `auth.uid()` não-NULL dentro de `withHousehold`.

---

## 7. Impacto e risco

### Ficheiros/camadas afectadas

| Ficheiro | Mudança | Camada |
|----------|---------|--------|
| `packages/db/src/client.ts` | `withHousehold` + corrigir comentário 10-14 | db |
| `apps/web/src/**` (~42 call-sites) | `getDb()` → `withHousehold(auth, fn)` | web (incremental) |
| `scripts/check-rls-coverage.ts` (+ novo teste de aplicação) | gate de aplicação real | scripts/CI |
| `.github/workflows/ci.yaml` (job `rls-gate`) | correr o teste de aplicação | CI |
| `docs/architecture.md`, `CLAUDE.md` | documentar caminho `withHousehold` | docs |
| 104 RLS policies, `getServiceDb()`, jobs Inngest | **NENHUMA** | — |

### Riscos

- **Regressão de comportamento (médio):** envolver queries numa transação muda a semântica de auto-commit. Queries que dependiam de auto-commit imediato ou de múltiplas connections paralelas dentro do mesmo handler precisam de atenção. **Mitigação:** migração por domínio + testes E2E por domínio (Fase 2).
- **`auth.uid()` NULL residual (médio):** se o JSON de claims estiver mal-formado, `is_household_member` devolve `false` para tudo → o utilizador vê 0 rows (falha **fechada**, não aberta — bloqueia, não vaza). **Mitigação:** Fase 0 prova o shape de claims antes de qualquer código de produção; o teste de aplicação apanha-o.
- **Performance (baixo):** transação + 1-2 `SET LOCAL` por request adiciona round-trips marginais. Aceitável face a NFR1; pgbouncer transaction-mode foi desenhado para isto.
- **Role provisioning (baixo):** depende de @devops provisionar o secret/role. Bloqueante de Fase 1 mas trivial.

### Rollback

Alta reversibilidade. Cada fase é independente:
- Fase 2 é por domínio — reverter um PR de domínio devolve esse domínio a `getDb()` + app-enforced (que continua presente). **O app-enforced nunca é removido**, logo reverter o RLS-enforced não reabre vazamento — só remove a 2ª rede.
- Fase 1 (wrapper + gate) é aditiva; remover o wrapper não-usado é trivial.
- Zero alteração de policies/schema → nenhum rollback de DDL necessário.

---

## 8. Consequências

**Positivas:**
- Segunda rede de segurança independente debaixo da aplicação — uma query nova sem filtro deixa de ser um vazamento (a RLS apanha).
- Zero alteração às 104 policies — honra o template canónico e elimina risco de regressão de DDL.
- Resolve a raiz que a Story 6.7 contornou (`auth.uid()=NULL`): funções `security definer` dependentes de `auth.uid()` passam a ter o user real disponível no caminho `withHousehold`.
- NFR5 deixa de ser "policies existem" e passa a ser "policies aplicam-se" (gate de aplicação real).

**Negativas / dívida aceite:**
- ~42 call-sites a migrar (mecânico, incremental, por domínio).
- 1 transação + `SET LOCAL` por request de utilizador (custo marginal).
- Dependência de provisionamento de role `authenticated` (@devops).

**Reversibilidade:** alta — app-enforced permanece como rede sempre-presente; o RLS-enforced é puramente aditivo.

---

## 9. Referências

- Código: `packages/db/src/client.ts` (37-101), `packages/db/migrations/0000_initial_schema.sql` (34-87), `packages/db/migrations/0001_rls_policies.sql` (537-552, 98 ocorrências), `apps/web/src/lib/api-helpers/auth.ts` (24-93)
- Diagnósticos: `packages/db/src/scripts/diag-rls-runtime.ts`, `diag-getdb-auth.ts`, `diag-rls-visibility.ts`
- Commits: `6f56e32` (SEC-1 app-enforced), `aa4e088` (Story 6.7 `accept_invite` p_user_id)
- Memória: `runtime_authuid_rls_gap`, `finding_rls_inert_runtime`, `sec1_final_gate_pattern`
- Constraint: CLAUDE.md §multi-tenancy (RLS NFR5, dual-URL pgbouncer); architecture.md §3.2

---

*ADR-003 — Aria (@architect), arquitetando o futuro.*
