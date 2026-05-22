# Runbook — Performance da Vista "Este mês" (Story 4.6 AC7 / PERF-001)

**Story:** 4.6 — Vista "Este mês"
**NFR:** NFR2 — latência p95 das operações de Finanças < 500ms
**Carry-over:** PERF-001 (diferido da Story 4.5; endereçado aqui)

---

## 1. Objectivo

Validar que a composição da vista mensal (`getMonthSummary` + `getMonthProjection`)
respeita o budget **p95 < 500ms** com volume realista, e confirmar que as queries
usam Index Scan (não Seq Scan).

---

## 2. Queries sob análise

A página `/financas/este-mes` dispara, via `getDb()` (RLS authenticated), 5 queries
em 2 helpers:

| # | Helper | Query | Índice esperado |
|---|--------|-------|-----------------|
| Q1 | `getMonthSummary` | Totais `SUM(...) FILTER` por `kind` no intervalo do mês | `transactions_date_range_idx (household_id, transaction_date)` |
| Q2 | `getMonthSummary` | Breakdown por categoria — `GROUP BY category_id, kind` + `LEFT JOIN categories` | `transactions_date_range_idx` (scan) + `categories_pkey` (join) |
| Q3 | `getMonthSummary` | Breakdown por dia — `GROUP BY transaction_date` | `transactions_date_range_idx` |
| Q4 | `getMonthProjection` | Prestações projectadas — `is_projected = true AND installment_id IS NOT NULL` na janela 30d | `transactions_projected_idx (household_id, is_projected, transaction_date)` |
| Q5 | `getMonthProjection` | Recorrências activas — `WHERE active = true` | `recurrences_next_run_idx (next_run_on, active)` ou seq scan aceitável (tabela pequena) |

> Os índices acima já existem no schema (`packages/db/src/schema/finance.ts`) —
> Story 4.6 NÃO adiciona índices. PERF-001 é validação, não criação.

---

## 3. Análise estática de planos (sem execução)

Com base no schema e nos índices declarados:

- **Q1/Q2/Q3** — o predicado dominante é `household_id = current_household_id()`
  (injectado pela policy RLS) + `transaction_date BETWEEN monthStart AND monthEnd`.
  O índice composto `transactions_date_range_idx (household_id, transaction_date)`
  cobre exactamente este acesso → **Index Scan** esperado, seguido de
  `HashAggregate` para os `GROUP BY`. O `FILTER (WHERE kind = ...)` é avaliado
  em memória sobre as rows já filtradas — custo desprezável.
- **Q2 join** — `LEFT JOIN categories c ON c.id = t.category_id` resolve por
  `categories_pkey` (PK lookup) → custo O(1) por row.
- **Q4** — `transactions_projected_idx (household_id, is_projected,
  transaction_date)` cobre o predicado `is_projected = true` + janela de datas →
  **Index Scan**. `installment_id IS NOT NULL` é filtro residual barato.
- **Q5** — `recurrences` é uma tabela pequena por household (dezenas de rows no
  pior caso MVP); um Seq Scan filtrado por RLS + `active = true` é aceitável.

**Conclusão estática:** nenhuma query exige Seq Scan sobre `transactions`. O
volume por household no MVP é baixo; o budget de 500ms tem folga ampla.

---

## 4. Procedimento de validação ao vivo (EXPLAIN ANALYZE)

> **Estado:** PENDENTE de captura — requer ambiente com Postgres seeded.
> O harness `@meu-jarvis/db-test` (Docker) não corre na máquina de
> desenvolvimento actual (carry-over conhecido das Stories 4.1-4.5; o CI job
> `rls-gate` cobre o RLS, não a performance). Executar contra staging ou um
> Postgres local seeded antes de promover a produção em escala.

### 4.1 Fixture

Gerar, para um household de teste:

- ≥ 500 `transactions` distribuídas num mês (mix `expense`/`income`/`transfer`).
- ≥ 20 `categories` (globais + per-household).
- ≥ 10 `recurrences` activas (frequências variadas).
- ≥ 5 `installments` com transactions `is_projected = true` na janela de 30 dias.

Seed sugerido: `pnpm --filter @meu-jarvis/db db:seed` estendido com um script
`finance-perf-fixture.sql`, ou inserção via as API routes `/api/financas/*`.

### 4.2 Captura

Para cada query (Q1-Q5), no `psql` ligado ao ambiente seeded, com o
`household_id` de teste no contexto RLS:

```sql
EXPLAIN (ANALYZE, BUFFERS)
<query — copiar de month-summary.ts / month-projection.ts>;
```

Colar o output abaixo e confirmar:

- [ ] Q1 — Index Scan em `transactions_date_range_idx` · tempo: ____ ms
- [ ] Q2 — Index Scan + PK join `categories` · tempo: ____ ms
- [ ] Q3 — Index Scan em `transactions_date_range_idx` · tempo: ____ ms
- [ ] Q4 — Index Scan em `transactions_projected_idx` · tempo: ____ ms
- [ ] Q5 — Scan de `recurrences` (Index ou Seq aceitável) · tempo: ____ ms
- [ ] **Soma p95 da composição da vista < 500ms (NFR2)**

```
-- EXPLAIN (ANALYZE, BUFFERS) output — Q1
(pendente)

-- EXPLAIN (ANALYZE, BUFFERS) output — Q2
(pendente)

-- ... Q3, Q4, Q5
```

### 4.3 Se uma query exceder o budget ou fizer Seq Scan

Documentar o achado e escalar a `@architect` no quality gate. A decisão de
adicionar um índice novo é do `@architect` — esta story NÃO adiciona índices
sem ratificação.

---

## 5. Observabilidade contínua em produção

A página é instrumentada com `withSpan('finance.month-view.render', ...)`. A
latência real é observável em Grafana Cloud (filtrar pelo span
`finance.month-view.render`). Definir um alerta se p95 > 500ms de forma
sustentada — confirma o budget NFR2 em produção, não apenas em teste.

---

*Runbook por Dex (@dev AIOX) — Story 4.6 AC7. A secção 4.2 fica pendente de
captura contra ambiente seeded; a análise estática (secção 3) confirma que os
índices necessários já existem e que nenhuma query degrada para Seq Scan.*
