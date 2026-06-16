# Story RGPD-1: Documentar processo manual de eliminação de conta (RGPD Art. 17)

## Status

Done

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - "Verificação manual do runbook (leitura crítica)"
  - "Confirmação que ZERO migrations ou código de produção foram alterados"
  - "Validação que ADR-003 §D6 + CLAUDE.md §Multi-tenancy são referenciados correctamente"
```

## Story

**As a** operador do Expressia (DaSilvaAlves / equipa técnica),
**I want** um runbook claro e completo que documente o processo manual de eliminação de conta de um utilizador em cumprimento do RGPD Art. 17 (direito ao apagamento),
**so that** consigo responder a pedidos de eliminação no período de soft-launch sem fluxo self-service e sem risco de cross-household data leakage, com evidência documentada da decisão de adiar o self-service.

## Acceptance Criteria

1. Existe o ficheiro `docs/runbooks/rgpd-account-deletion.md` com o processo passo-a-passo de eliminação manual via `getServiceDb()` (role `service_role` que ignora RLS), devidamente comentado com os guards de segurança obrigatórios (CLAUDE.md §Multi-tenancy, ADR-003 §D6).
2. O runbook mapeia, com base no schema real (`packages/db/src/schema/*.ts`), o que o `ON DELETE CASCADE` apaga automaticamente ao remover o `household` (cascata de domínio) e o que **não** apaga (dados externos: `auth.users` no Supabase Auth, logs Sentry/Grafana, exports em Supabase Storage, dados de terceiros).
3. O runbook documenta os passos adicionais que o operador tem de executar manualmente para os "resíduos" que o CASCADE não cobre — nomeadamente, eliminação do utilizador em `auth.users` via Supabase Dashboard ou API Admin (`supabase.auth.admin.deleteUser()`), e limpeza de eventuais exports em Storage.
4. Existe uma secção de decisão explícita no runbook (ou referenciada como ADR inline) que regista: (a) para soft-launch de volume reduzido o fluxo self-service é **deferido**; (b) a tabela `account_deletion_jobs` e os enums `account_deletion_status` existem no schema (auditado em `packages/db/src/schema/audit.ts`) mas a função Inngest `gdpr-purge` e a rota `/api/account/delete` **não estão implementadas**; (c) critério de reavaliação (volume de pedidos ou milestone de lançamento alargado).
5. O runbook inclui uma checklist de passos de auditoria que o operador deve registar no `audit_log` após a eliminação (`account_deletion_requested` + `account_deletion_executed` — acções já definidas no enum `audit_action` em `packages/db/src/schema/audit.ts`).
6. O runbook explicita que `getServiceDb()` **só pode ser invocado num script de admin ou num job Inngest controlado** — nunca em response handlers de utilizador final — citando o guard JSDoc adicionado em SEC-10 (`packages/db/src/client.ts::getServiceDb()`).
7. A story não introduz nenhuma migration SQL, alteração de schema Drizzle, nem modificação de código de produção (`apps/`, `packages/db/src/`). Se durante a implementação se concluir que é necessária alguma alteração de código/schema, o @dev DEVE parar, registar em Dev Notes e consultar o @po antes de prosseguir.
8. A story não toca em billing (`subscriptions`, `invoices`, `payment_methods`) — CONGELADO por directiva de 29/05/2026.

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI não está activo em `core-config.yaml` (precedente series SEC-1→SEC-10).
> A validação de qualidade usa o processo de revisão manual pelo @qa.

## Tasks / Subtasks

- [x] T1 — Recolher evidências técnicas do schema (AC: 2, 4)
  - [x] T1.1 — Listar todas as tabelas com `household_id` + FK `ON DELETE CASCADE` ancoradas em `households.id` a partir de `packages/db/src/schema/*.ts` (referência: tenancy, billing, agent, tasks, finance, audit, prefs)
  - [x] T1.2 — Confirmar tabelas com FK CASCADE directo em `auth.users` (fora de `households`) que NÃO são apagadas ao apagar o household (ex: `user_prefs.user_id`, `audit_log.user_id`, membros de outros households)
  - [x] T1.3 — Confirmar estado actual: `account_deletion_jobs` e `accountDeletionStatusEnum` existem no schema (`packages/db/src/schema/audit.ts`), mas não há rota `/api/account/delete` nem função Inngest `gdpr-purge` registada em `apps/web/src/app/api/inngest/route.ts`
  - [x] T1.4 — Verificar se há dados em Supabase Storage (`data_export_jobs.storage_path`) que NÃO são cobertos pelo CASCADE e que precisam de limpeza manual

- [x] T2 — Criar `docs/runbooks/rgpd-account-deletion.md` (AC: 1, 2, 3, 5, 6)
  - [x] T2.1 — Secção §1: âmbito e pré-condições (quem pode executar, qual o ambiente, env vars necessárias)
  - [x] T2.2 — Secção §2: mapa do CASCADE — o que é apagado automaticamente vs o que fica (resíduos)
  - [x] T2.3 — Secção §3: passo-a-passo do processo manual com snippets de referência (pseudocódigo — NÃO código de produção) usando `getServiceDb()`, com citação do guard JSDoc de SEC-10
  - [x] T2.4 — Secção §4: passos para resíduos externos (eliminação de `auth.users` via Supabase Auth Admin API / Dashboard, limpeza Storage, confirmação de Sentry/Grafana)
  - [x] T2.5 — Secção §5: registar no `audit_log` as acções `account_deletion_requested` e `account_deletion_executed` via script admin (pseudocódigo com INSERT directo via `getServiceDb()`)
  - [x] T2.6 — Secção §6: decisão de deferimento do self-service (AC 4) — incluir critério de reavaliação
  - [x] T2.7 — Secção §7: referências (CLAUDE.md §Multi-tenancy, ADR-003 §D6/§12.3/§12.5, SEC-10, NFR10/FR29)

- [x] T3 — Validação de conformidade da story (AC: 7, 8)
  - [x] T3.1 — Confirmar que `git diff` não inclui alterações em `packages/db/migrations/`, `packages/db/src/schema/`, `apps/web/src/` nem `apps/web/src/app/api/`
  - [x] T3.2 — Confirmar que `docs/runbooks/rgpd-account-deletion.md` é o único ficheiro novo/modificado
  - [x] T3.3 — Confirmar que billing não é mencionado como objecto de eliminação activa no runbook (scope CONGELADO)

## Dev Notes

### Contexto e âmbito

Esta story é de DOCUMENTAÇÃO PURA — sem código de produção, sem migrations, sem alterações de schema. O output é um runbook operacional.

**Origem:** `mj-handoff-followups-soft-launch-20260615.yaml` §`follow_ups_seguranca_e_conformidade` + confirmado por `mj-handoff-sec10-done-next-followups-20260616.yaml` §`next_action`.

### Estado actual comprovado do schema (evidência directa — não suposição)

**Tabelas com `ON DELETE CASCADE` ancoradas em `households.id`** (fonte: `packages/db/src/schema/`):

| Schema file | Tabelas cascade em households.id |
|-------------|----------------------------------|
| `tenancy.ts` | `household_members`, `household_invites`, `kanban_columns` |
| `billing.ts` | `subscriptions`, `invoices`, `payment_methods`, `feature_flags` (billing — fora do âmbito de purge MVP) |
| `agent.ts` | `agent_runs`, `intent_classifications`, `agent_reverse_ops`, `agent_quotas`, `agent_rate_limit_counters` |
| `tasks.ts` | `tasks`, `task_recurrences`, `tags`, `task_tags` |
| `finance.ts` | `accounts`, `cards`, `categories`, `transactions`, `recurrences`, `installments` |
| `audit.ts` | `audit_log` (household_id nullable), `data_export_jobs`, `account_deletion_jobs`, `feature_flags` |
| `prefs.ts` | `user_prefs` (household_id cascade + `user_id` FK cascade para `auth.users`) |

**Conclusão CASCADE:** apagar o `household` via `DELETE FROM households WHERE id = $householdId` (com `getServiceDb()`) apaga em cascata todos os dados de domínio acima. O `ON DELETE CASCADE` do Postgres garante purge atómico dos dados de aplicação.

**Resíduos NOT cobertos pelo CASCADE:**

1. **`auth.users`** — gerido pelo schema `auth` do Supabase, fora do schema público. `DELETE FROM households` NÃO apaga o utilizador de `auth.users`. Requer chamada à Supabase Auth Admin API (`supabase.auth.admin.deleteUser(userId)`) ou via Supabase Dashboard → Authentication → Users → Delete. [Fonte: `packages/db/src/schema/auth.ts` + CLAUDE.md "auth.users NÃO acessível via getDb()"]
2. **Supabase Storage** — exports de dados (`data_export_jobs.storage_path` = `exports/{household_id}/{job_id}.zip`) não são apagados pelo CASCADE na DB. Requer chamada à Storage Admin API ou limpeza manual no Dashboard.
3. **Logs Sentry / Grafana Cloud** — dados de observabilidade não são PII directo (sem prompts em claro, apenas `user_id`/`household_id` como labels). Retenção standard; não há acção obrigatória de purge nestes sistemas no MVP.
4. **`audit_log.user_id`** — o campo `user_id` em `audit_log` é `ON DELETE SET NULL` (não CASCADE), portanto linhas do audit_log do household ficam com `user_id = NULL` após eliminação do utilizador. As linhas do household são apagadas pelo CASCADE de `household_id` (quando o household é eliminado). Verificar o DDL para confirmar este comportamento exacto.

### Estado da infraestrutura Inngest (evidência directa)

Funções registadas actualmente em `apps/web/src/app/api/inngest/route.ts`:
- `cleanupExpiredReverseOps`
- `generateRecurringTasks`
- `generateFinanceRecurrences`

**Ausente:** função `gdpr-purge` (mencionada no `.env.example` como futura e em `architecture.md` §12.1 e §14.5, mas NÃO registada). A tabela `account_deletion_jobs` e os enums `account_deletion_status` existem no schema (definidos em `packages/db/src/schema/audit.ts` linha 122 e 214), mas são infra preparatória — não há endpoint nem job que os consuma.

### Guard JSDoc de SEC-10 (referência crítica para o runbook)

`packages/db/src/client.ts::getServiceDb()` tem guard JSDoc explícito (adicionado em SEC-10) com:
- String indexável: `"NUNCA usar em response handlers de utilizador final"`
- 3 categorias de uso legítimo (migrações, jobs Inngest controlados, excepções documentadas)
- Referências: `CLAUDE.md §Multi-tenancy`, `ADR-003 §D6/§12.3/§12.5`, `SEC-10`

O runbook DEVE citar este guard e seguir o mesmo padrão de justificação.

### Decisão de deferimento — justificação técnica

Para soft-launch de volume reduzido (PT-PT exclusivo, early adopters conhecidos):
- O fluxo self-service exige: rota autenticada `/api/account/delete`, UI em `/conta`, função Inngest `gdpr-purge` multi-step (com step de confirmação 30d + step de hard-delete + step de cleanup Storage + step de Auth Admin delete). Estimativa: 1-2 stories médias de implementação.
- O processo manual via operador é proporcional para soft-launch: o Eurico consegue responder a um pedido de eliminação em menos de 15 minutos com o runbook.
- O schema já está preparado: `account_deletion_jobs` existe, `audit_action` inclui `account_deletion_requested`/`account_deletion_executed`. O self-service é uma questão de implementar o fluxo, não de alterar o schema.
- Critério de reavaliação: quando o volume de pedidos ou a abertura pública justificar operacionalização.

### Padrão Inngest para referência futura (esboço — NÃO implementar nesta story)

O runbook pode incluir (em secção claramente marcada como "Fase futura") a estrutura esperada da função Inngest `gdpr-purge`:
```
gdpr-purge/
  trigger: inngest event "gdpr/account.deletion.scheduled"
  step 1: validar account_deletion_jobs.status === 'scheduled' e scheduledFor <= now()
  step 2: getServiceDb() → DELETE FROM households WHERE id = householdId (cascade)
  step 3: supabase.auth.admin.deleteUser(requestedByUserId)
  step 4: supabase.storage.remove([storagePath]) para data_export_jobs pendentes
  step 5: UPDATE account_deletion_jobs SET status='completed', completedAt=now()
  step 6: INSERT INTO audit_log (action='account_deletion_executed', ...)
```
Isto documenta a intenção arquitectural sem implementar nada.

### Ficheiros relevantes (referência — NÃO modificar)

- `packages/db/src/client.ts` — `getServiceDb()` com guard JSDoc SEC-10
- `packages/db/src/schema/audit.ts` — `accountDeletionJobs`, `accountDeletionStatusEnum`, `auditActionEnum`
- `packages/db/src/schema/tenancy.ts` — `households` (alvo do DELETE principal)
- `apps/web/src/app/api/inngest/route.ts` — confirma que `gdpr-purge` NÃO está registado
- `apps/web/src/lib/agent/db-shim.ts` — wrapper `getServiceDb()` (também tem guard JSDoc SEC-10)
- `.env.example` — `DATABASE_URL_SERVICE_ROLE` (variável necessária para qualquer script admin)
- `docs/architecture.md` §12.1 (GDPR checklist), §12.4 (audit logs)
- `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` §D6, §12.3, §12.5

### Ficheiro a criar (output único desta story)

`docs/runbooks/rgpd-account-deletion.md`

### Testing

Esta story não tem código de produção — não há testes automatizados a escrever.

**Validação manual (gate @qa):**

- Leitura crítica do runbook: verificar que os passos são executáveis e não contraditórios com o schema real.
- Verificar que os nomes de tabelas/enums referenciados no runbook existem em `packages/db/src/schema/*.ts`.
- Verificar que o guard `getServiceDb()` é citado correctamente (copiar a string do JSDoc de `packages/db/src/client.ts`).
- Confirmar que `git diff --name-only` lista APENAS `docs/runbooks/rgpd-account-deletion.md` (zero alterações em `apps/`, `packages/`).
- Confirmar que billing não é incluído no âmbito de purge (scope CONGELADO).

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-16 | v1.0 | Draft inicial — documentação processo manual RGPD Art. 17 + decisão deferimento self-service | @sm (River) |
| 2026-06-16 | v1.1 | @po GO 9,0/10 (5 PO-FIX) → @dev runbook `rgpd-account-deletion.md` → @qa CONCERNS 8,5/10 (DOC-001) → DOC-001 resolvido → **PASS 9,0/10, Status Done**. Aguarda `@devops *push`. | ciclo /sdc |

## Dev Agent Record

### Agent Model Used

`aiox-dev` (Dex) — Opus 4.8. A sessão do agente terminou por erro de servidor (529) na fase de bookkeeping; o runbook (output substantivo) ficou completo e verificado. Registo da story e gates concluídos pelo orquestrador do `/sdc` (trabalho mecânico; revisão fica na lane do @qa).

### Debug Log References

- `git status --porcelain` → apenas `docs/runbooks/rgpd-account-deletion.md` (novo) + a própria story (AC7 satisfeito).
- `pnpm check:rls` → todas as tabelas com cobertura de policies (NFR5 intacta — zero touch DB).
- `pnpm typecheck` → 10/10 (FULL TURBO cache; nenhum código alterado).

### Completion Notes List

- Output único: `docs/runbooks/rgpd-account-deletion.md` (309 linhas, documentação pura).
- 5 PO-FIX do GATE 2 aplicados: (1) ordem multi-household no SET NULL — §2.5, com descoberta de que `households.owner_user_id` é `RESTRICT` (impõe ordem households→auth.users); (2) correcção factual `.env.example` (só comentário, não var "gdpr") — §6; (3) canal+prazo do pedido (Art. 12, 1 mês) — §1.5; (4) aviso billing/fiscal (`invoices.nif_customer` retenção fiscal vs apagamento; Stripe manual fora de âmbito) — §2.4; (5) `account_deletion_canceled` citado — §5/§6.
- Decisão registada: self-service DEFERIDO para pós-soft-launch; schema já preparado (`account_deletion_jobs` + enums existem); falta apenas o fluxo (rota + Inngest `gdpr-purge`). Critério de reavaliação documentado — §6.
- Nomes de tabelas/enums/colunas verificados contra `packages/db/src/schema/*.ts`; DDL `audit_log.user_id ON DELETE SET NULL` confirmado em `0000_initial_schema.sql:691`.
- ZERO migrations, ZERO código de produção, ZERO alteração de schema. Billing não tocado.

### File List

- `docs/runbooks/rgpd-account-deletion.md` (novo)

## QA Results

### Review Date: 2026-06-16

### Reviewed By: Quinn (@qa — Test Architect)

Revisão adversarial: cada alegação factual do runbook foi confirmada contra o schema/DDL/código de produção (não contra o runbook). 16 de 17 pontos verificados verde, incluindo todos os pontos de segurança críticos:

- `households.owner_user_id` RESTRICT (`tenancy.ts:55`) — impõe ordem households→auth.users. CONFIRMADO (ponto crítico bem apanhado pelo @dev).
- `audit_log.user_id` SET NULL (`0000_initial_schema.sql:691`) — CONFIRMADO byte-a-byte.
- Guard JSDoc "NUNCA usar em response handlers de utilizador final" (`client.ts:146` + `db-shim.ts:53`) — CONFIRMADO.
- `gdpr-purge` ausente do Inngest (`route.ts:29`) — CONFIRMADO.
- Enums GDPR + `account_deletion_jobs` (`audit.ts`) — CONFIRMADO.
- 5 PO-FIX do GATE 2 aplicados (canal+prazo §1.5; billing/fiscal §2.4; ordem multi-household §2.5; `account_deletion_canceled` §5/§6; correcção `.env.example` §6) — CONFIRMADO.
- Âmbito (AC7/AC8): `git status --porcelain` lista apenas o runbook + a story. Zero código/migrations/schema. Billing não é objecto de eliminação activa.

**8/8 Acceptance Criteria MET** (AC2 com ressalva não-bloqueante).

**1 finding MEDIUM (DOC-001):** o runbook §2.1 e a Dev Notes (linha 81) listam a tabela `projects` como cascade em `tasks.ts`. Essa tabela **NÃO existe** no schema (`tasks.ts` tem 4 tabelas: tasks, task_recurrences, tags, task_tags; nenhuma migration cria `projects`). Erro factual que engana o operador e contradiz a auto-declaração "byte-a-byte" do próprio §2.1. Correcção de 1 linha — devolvido ao @dev. As restantes 16 alegações estão verdes.

**1 finding LOW (DOC-002):** §1.3 poderia clarificar a resolução real da connection string `service_role`. WAIVED — não bloqueante.

Sem findings HIGH/CRITICAL. Processo de eliminação seguro, atómico e na ordem correcta.

### Gate Status

Gate: **PASS** → docs/qa/gates/RGPD-1-qa-gate.md (CONCERNS 8,5/10 elevado a PASS 9,0/10 após resolução do DOC-001)

**DOC-001 RESOLVIDO** (2026-06-16): tabela `projects` removida de §2.1 do runbook e da Dev Notes (linha 81) desta story. Alegação reconfirmada de forma independente antes da correcção (`tasks.ts` tem 4 tabelas: `tasks`, `task_recurrences`, `tags`, `task_tags`). Correcção mecânica de 1 linha, sem impacto nos 16 pontos adversariais já verdes. DOC-002 (LOW) permanece WAIVED. Conforme pré-autorização do gate, o veredicto subiu a PASS sem nova revisão substantiva.
