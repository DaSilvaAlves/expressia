# QA Gate — Story RGPD-1 (Documentar processo manual de eliminação de conta — RGPD Art. 17)

**Reviewer:** Quinn (@qa) — Test Architect & Quality Advisor
**Data:** 2026-06-16T00:00:00Z
**Story:** `docs/stories/active/RGPD-1.account-deletion-purge-process.story.md`
**Output revisto:** `docs/runbooks/rgpd-account-deletion.md` (309 linhas, documentação pura)
**Modo:** Revisão adversarial — cada alegação factual do runbook confirmada contra o schema/DDL/código real
**CodeRabbit:** Disabled (não activo em `core-config.yaml`) — validação por revisão manual

---

## Verdict

**PASS** — Score **9,0 / 10** (CONCERNS 8,5/10 elevado a PASS após resolução do DOC-001)

O runbook é tecnicamente sólido, operacionalmente proporcional e factualmente preciso na esmagadora maioria das alegações de segurança (todas as confirmadas byte-a-byte abaixo). Os 5 PO-FIX foram aplicados. O único finding bloqueante era um erro factual MEDIUM (tabela fantasma `projects` em §2.1) — **RESOLVIDO** (ver Resolução abaixo). Conforme pré-autorizado por este gate ("após correcção, o gate sobe a PASS sem nova revisão substantiva"), o veredicto efectivo é PASS.

### Resolução DOC-001 (2026-06-16, orquestrador `/sdc`)

A tabela `projects` foi removida da linha `tasks.ts` em §2.1 do runbook **e** da Dev Notes (linha 81) da story. A alegação do QA foi reconfirmada de forma independente antes da correcção: `grep "pgTable" tasks.ts` → 4 tabelas (`tasks`, `taskRecurrences`, `tags`, `taskTags`); `projects` não existe em `packages/db/src/schema/*.ts` nem em nenhuma migration. As 4 tabelas restantes da linha estão correctas. Correcção mecânica de 1 linha, sem impacto nos 16 pontos adversariais já verdes. DOC-002 (LOW) permanece WAIVED.

```yaml
schema: 1
story: 'RGPD-1'
gate: PASS
status_reason: 'Runbook RGPD Art. 17 tecnicamente sólido e seguro; 5 PO-FIX aplicados; DOC-001 (tabela fantasma `projects`) RESOLVIDO por correcção de 1 linha no runbook + story. DOC-002 (LOW) WAIVED. 8/8 ACs MET.'
reviewer: 'Quinn (gate) + orquestrador /sdc (resolução DOC-001)'
updated: '2026-06-16T00:00:00Z'
resolved_findings:
  - id: 'DOC-001'
    resolution: 'Tabela `projects` removida de §2.1 do runbook e Dev Notes linha 81 da story. Alegação reconfirmada independentemente (tasks.ts tem 4 tabelas).'
top_issues:
  - id: 'DOC-001'
    severity: medium
    finding: 'Runbook §2.1 (e story Dev Notes linha 81) listam a tabela `projects` como cascade em households via tasks.ts. A tabela `projects` NÃO existe em packages/db/src/schema/*.ts nem em nenhuma migration. tasks.ts tem 4 tabelas (tasks, task_recurrences, tags, task_tags), não 5. Contradiz a nota de verificação "byte-a-byte" do próprio §2.1.'
    suggested_action: 'Remover `projects` da linha tasks.ts em §2.1 do runbook (e da Dev Notes linha 81 da story). As restantes 4 tabelas de tasks.ts estão correctas.'
  - id: 'DOC-002'
    severity: low
    finding: 'O runbook não menciona explicitamente que getServiceDb() usa DATABASE_URL_DIRECT como fallback efectivo se DATABASE_URL_SERVICE_ROLE não estiver definida (client.ts). §1.3 diz "tipicamente igual" — correcto mas poderia ser mais directo sobre o fallback real para evitar ambiguidade ao operador.'
    suggested_action: 'Opcional — clarificar em §1.3 o comportamento exacto de resolução da connection string service_role. Não bloqueante.'
waiver: { active: false }
```

---

## Verificação adversarial — alegações confirmadas contra a realidade

Cada item foi confirmado lendo o schema/DDL/código de produção, não o runbook.

| # | Alegação do runbook | Fonte verificada | Veredicto |
|---|---------------------|------------------|-----------|
| 1 | `households.owner_user_id` é `RESTRICT` e impõe ordem households→auth.users (§2.3/§2.5) | `tenancy.ts:55` → `onDelete: 'restrict'` | CONFIRMADO — ponto crítico bem apanhado |
| 2 | `audit_log.user_id` é `ON DELETE SET NULL` (DDL `0000_initial_schema.sql:691`) | `0000_initial_schema.sql:691` → `user_id uuid references auth.users(id) on delete set null` + `audit.ts:141` | CONFIRMADO byte-a-byte |
| 3 | `audit_log.household_id` nullable + cascade (DDL `:690`) | `0000_initial_schema.sql:690` + `audit.ts:138-140` | CONFIRMADO |
| 4 | `household_members.user_id` é CASCADE | `tenancy.ts:89` → `onDelete: 'cascade'` | CONFIRMADO |
| 5 | `user_prefs.user_id` é CASCADE para auth.users | `prefs.ts:97` → `onDelete: 'cascade'` | CONFIRMADO |
| 6 | `gdpr-purge` NÃO registado no Inngest | `apps/web/src/app/api/inngest/route.ts:29` regista só cleanupExpiredReverseOps, generateRecurringTasks, generateFinanceRecurrences | CONFIRMADO |
| 7 | Guard JSDoc "NUNCA usar em response handlers de utilizador final" | `client.ts:146` + `db-shim.ts:53` | CONFIRMADO em ambos |
| 8 | Enums `account_deletion_requested/canceled/executed` + `account_deletion_status` existem | `audit.ts:42-44` (acções) + `audit.ts:122-128` (status) | CONFIRMADO |
| 9 | `account_deletion_jobs` e `data_export_jobs` existem; storage_path `exports/{household_id}/{job_id}.zip` | `audit.ts:214` + `audit.ts:176`, `storagePath` linha 187-188 | CONFIRMADO |
| 10 | Billing (subscriptions, payment_methods, invoices, payment_events) é CASCADE | `billing.ts:77,121,155,203` | CONFIRMADO |
| 11 | `invoices.nif_customer` existe (retenção fiscal §2.4) | `billing.ts:164` | CONFIRMADO — aviso fiscal factualmente correcto |
| 12 | ADR-003 §D6 refere getServiceDb GDPR purge | `ADR-003-rls-enforced-runtime-hardening.md:51,156` | CONFIRMADO |
| 13 | `.env.example` apenas menciona "GDPR purge" num comentário, não define var "gdpr" | `.env.example:19-21` (comentário) + `:28` (`DATABASE_URL_SERVICE_ROLE=`) | CONFIRMADO — PO-FIX factual correcto |
| 14 | finance.ts: accounts, cards, categories, transactions, recurrences, installments (6) cascade | `finance.ts` — 6 FKs households cascade | CONFIRMADO |
| 15 | agent.ts: agent_runs, intent_classifications, agent_reverse_ops, agent_quotas, agent_rate_limit_counters (5) | `agent.ts` — 5 pgTable, todas cascade households | CONFIRMADO |
| 16 | **tasks.ts: `projects`, tasks, task_recurrences, tags, task_tags (5)** | `tasks.ts` tem 4 pgTable (tasks, task_recurrences, tags, task_tags). **`projects` NÃO existe** | **FALHA — DOC-001** |
| 17 | Âmbito: SÓ runbook + story tocados, zero código/migrations/schema | `git status --porcelain` → só `docs/runbooks/rgpd-account-deletion.md` + a story | CONFIRMADO (AC7/AC8) |

---

## Avaliação dos 8 Acceptance Criteria

| AC | Critério | Veredicto | Evidência |
|----|----------|-----------|-----------|
| 1 | Runbook existe com processo manual via `getServiceDb()` + guards (CLAUDE.md, ADR-003 §D6) | **MET** | `rgpd-account-deletion.md` §1.4 + §3 citam guard JSDoc, CLAUDE.md §Multi-tenancy, ADR-003 §D6/§12.3/§12.5 (todos confirmados existentes) |
| 2 | Mapa CASCADE (apaga) vs externos (não apaga) com base no schema real | **MET (com ressalva DOC-001)** | §2.1 mapa CASCADE — 6/7 linhas correctas; §2.2 resíduos (auth.users, Storage, Sentry/Grafana, Stripe) correctos. A linha tasks.ts inclui `projects` inexistente (DOC-001) mas as restantes tabelas dessa linha existem |
| 3 | Passos manuais para resíduos (auth.users via Admin API, Storage) | **MET** | §4.1 (`supabase.auth.admin.deleteUser`) + §4.2 (Storage remove) + §4.3 (Sentry/Grafana avaliados) |
| 4 | Decisão self-service DEFERIDO + estado infra + critério de reavaliação | **MET** | §6: deferimento justificado, `account_deletion_jobs`+enums existem mas `gdpr-purge`/rota ausentes (confirmado), critério (volume ou milestone público) |
| 5 | Checklist de auditoria (`account_deletion_requested`+`account_deletion_executed`) | **MET** | §5.1 sequência + §5.2 checklist; ambas as acções confirmadas no enum `audit.ts:42-44`. Bónus: `account_deletion_canceled` citado (PO-FIX 5) |
| 6 | `getServiceDb()` só em script admin/job Inngest — nunca em response handler, citando guard SEC-10 | **MET** | §1.4 cita textualmente o guard de `client.ts:146` + `db-shim.ts:53` (ambos confirmados) |
| 7 | Zero migration/schema/código de produção alterado | **MET** | `git status --porcelain` → apenas o runbook + a story. Zero touch em `apps/`, `packages/db/src/`, `packages/db/migrations/` |
| 8 | Billing não tocado como objecto de eliminação activa (CONGELADO 29/05/2026) | **MET** | §2.4 documenta billing apenas como CASCADE passivo + aviso fiscal + Stripe fora de âmbito; nenhuma operação de eliminação activa sobre billing |

**8/8 ACs MET.** AC2 com ressalva não-bloqueante (DOC-001).

---

## Findings (por severidade)

| ID | Severidade | Finding |
|----|-----------|---------|
| DOC-001 | **MEDIUM** | Tabela fantasma `projects` em §2.1 (e Dev Notes story linha 81) — não existe no schema. Erro factual que engana o operador e contradiz a auto-declaração "byte-a-byte" do runbook |
| DOC-002 | **LOW** | §1.3 poderia ser mais explícito sobre a resolução real da connection string `service_role` (fallback DATABASE_URL_DIRECT) |

Zero findings HIGH ou CRITICAL. Zero issues de segurança. O processo de eliminação descrito é seguro, atómico e na ordem correcta (households→auth.users imposta pelo RESTRICT).

---

## CONCERNS — o que aceito vs o que devolvo

- **DOC-001 (MEDIUM) — devolver ao @dev:** correcção trivial de uma linha. Remover `projects` da linha tasks.ts em §2.1 do runbook e da Dev Notes (linha 81) da story. É a única correcção que torna o runbook 100% fiel ao schema. Trabalho de @dev, não meu (não estou autorizado a editar o runbook nem o corpo da story fora de QA Results).
- **DOC-002 (LOW) — WAIVED:** melhoria opcional de clareza, não bloqueante para o soft-launch. Pode ser endereçada na próxima revisão do runbook.

**Recomendação:** devolver ao @dev para aplicar DOC-001 (correcção de 1 linha). Após correcção, o gate sobe a PASS sem nova revisão substantiva — a verificação adversarial dos 16 outros pontos já está completa e verde.

---

*Gate produzido na story RGPD-1 — revisão adversarial completa contra schema/DDL/código de produção. PT-PT.*
