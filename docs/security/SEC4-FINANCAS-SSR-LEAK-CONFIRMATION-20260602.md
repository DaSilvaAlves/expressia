# SEC-4 — Confirmação empírica: leak cross-tenant nas SSR pages de Finanças

| Campo | Valor |
|-------|-------|
| Autor | @architect (Aria) — dono do ADR-003 |
| Data | 02/06/2026 |
| Pedido por | @sm (durante o draft da Story SEC-4) |
| Veredicto | **LEAK REAL — CONFIRMADO** |
| Severidade | **CRITICAL** |
| Exploitável em prod hoje | **SIM** (sem pré-condições especiais) |
| Prova empírica | **SIM** — Postgres 16 real (Testcontainers), 5/5 testes verde |
| Scope | NÃO editei a story SEC-4 (validação @po em paralelo). Sem push. |

---

## 1. Resumo executivo

O achado do @sm está **confirmado e é mais grave do que um risco teórico**: é um vazamento
cross-tenant **live de leitura** em produção. As 5 SSR pages do módulo Finanças
(`/financas/{este-mes,cartoes,patrimonio,recorrentes,variaveis}`) renderizam dados financeiros
agregados de **TODOS os households**, não apenas o do utilizador autenticado.

A causa é a conjunção de dois factos já provados independentemente:

1. **`getDb()` liga como role `postgres`/bypassrls em runtime** → RLS inerte (ADR-003 §1.1,
   CROSS-TENANT-AUDIT-20260602, SEC-1 AC-K1). As policies existem mas nunca são avaliadas.
2. **Os 6 helpers em `apps/web/src/lib/finance/*` executam queries de domínio SEM filtro
   `household_id`** — confiam explicitamente em "RLS via `getDb()` authenticated" (declarado em
   comentário no próprio código). Com a RLS inerte, não há rede de segurança nenhuma.

Resultado: um utilizador do household A, ao abrir qualquer vista de Finanças, vê património,
faturas de cartões, transacções variáveis, recorrências e totais do mês de **todos os outros
clientes do SaaS**. Numa app família-first multi-tenant, é a fuga de dados mais sensível possível
(saldos bancários, IBAN last4, despesas pessoais).

Esta superfície **NÃO foi coberta** por nenhuma fase anterior: a auditoria
`CROSS-TENANT-AUDIT-20260602.md` cobriu `api/financas/*` (rotas mutáveis) e o RSC da Visão
(`lib/visao/queries.ts`), mas **zero menções a `lib/finance`** (grep: 0 matches) e zero às SSR
pages de Finanças. SEC-2/SEC-3 (withHousehold) também não tocaram nestes paths.

---

## 2. Evidência por código

### 2.1 Zero filtro `household_id` nos helpers e pages

```
Grep household_id  apps/web/src/lib/finance/                 → 0 matches
Grep household_id  apps/web/src/app/(app)/financas/**         → 0 matches
Grep lib/finance   docs/security/CROSS-TENANT-AUDIT-20260602  → 0 matches (fora de scope da auditoria)
```

Os 6 helpers afectados (todos `db`-injectáveis, query-shape fixa sem tenant scope):

| Helper | Vista | Query-shape sem filtro (verbatim) |
|--------|-------|-----------------------------------|
| `account-balances.ts` | `/financas/patrimonio` | `from public.accounts where archived_at is null` |
| `month-summary.ts` | `/financas/este-mes` | `from public.transactions where transaction_date between … and is_projected=false` |
| `month-projection.ts` | `/financas/este-mes` | projecção lê `transactions`/`recurrences` sem tenant scope |
| `list-card-statements.ts` | `/financas/cartoes` | `from public.cards c left join accounts a … where c.archived_at is null` |
| `list-recurrences.ts` | `/financas/recorrentes` | `from public.recurrences` |
| `list-variable-transactions.ts` | `/financas/variaveis` | WHERE construído por array `conditions[]` que **nunca** inclui `household_id` |

O próprio código declara a dependência (auto-incriminatório):
`account-balances.ts` L8-9 — *"O household scoping é feito pela RLS (`getDb()` authenticated, R-4.9.4)."*
`month-summary.ts` L23 — *"Cliente Drizzle RLS-scoped (`getDb()`) — injectado pelo RSC."*

### 2.2 A page tem o `householdId` em mãos mas NÃO o injecta

`app/(app)/financas/patrimonio/page.tsx` é o exemplo canónico da falha:

```ts
const householdId = await resolveHouseholdId(user.id);   // L39 — resolvido…
if (!householdId) { /* early-return empty state */ }      // L40 — …mas só usado para o guard
const db = getDb();
netWorth = await getAccountBalances({ db });              // L58 — householdId NÃO é passado
```

O `householdId` é resolvido e depois descartado — usado apenas para decidir "tem household sim/não",
nunca para filtrar a query. As 5 pages seguem este mesmo padrão (resolvem identidade, passam só `db`).

---

## 3. Prova empírica (Postgres real, role = runtime bypassrls)

Escrevi um teste dedicado que replica as **query-shapes verbatim** dos helpers e as corre com o
cliente `admin()` do harness db-test — que é o role superuser/bypassrls, **equivalente exacto ao
role de runtime de `getDb()`** (mesma premissa que SEC-1 AC-K1 / `cross_tenant_isolation.test.ts`).

**Ficheiro:** `packages/db-test/src/tests/sec4_financas_ssr_leak.test.ts`
**Comando:** `pnpm --filter @meu-jarvis/db-test test -- src/tests/sec4_financas_ssr_leak.test.ts`
**Ambiente:** Postgres 16 efémero (Testcontainers) + bootstrap/migrations de produção (0000 + 0001).

**Resultado: 5/5 PASS (322ms).** Para cada helper, o teste prova as duas metades:

| Teste (query-shape verbatim) | SEM filtro (leak) | COM `and household_id = $A` (fix) |
|------------------------------|-------------------|-----------------------------------|
| `accounts where archived_at is null` (patrimonio) | vê `['Conta A','Conta B']` | vê só `['Conta A']` |
| totais do mês (este-mes) | soma `17740` = 8870 (A) + 8870 (B) | só `8870` (A) |
| `cards … where archived_at is null` (cartoes) | vê `['Cartão A','Cartão B']` | só `['Cartão A']` |
| `recurrences` (recorrentes) | vê A **e** B | `count = 1` (só A) |
| `transactions where is_projected=false` (variaveis) | vê A **e** B | `count = 1` (só A) |

A metade "soma 17740" é a demonstração mais didáctica: um utilizador de A vê, no total do mês, as
despesas de A **somadas às de B** — não só vê dados alheios, como contamina os seus próprios números.

> Nota: o teste foi mantido no repo (à semelhança de `cross_tenant_isolation.test.ts` do SEC-1) como
> evidência reproduzível e como regressão-guard para o fix SEC-4. Pode ser convertido em AC de SEC-4.

---

## 4. Veredicto, severidade e exploitabilidade

**Leak real?** SIM. Confirmado por código (zero filtros) **e** empiricamente (Postgres real, role de
runtime). Não é hipótese — é o comportamento actual de produção.

**Severidade: CRITICAL.**
- Confidencialidade: fuga total de dados financeiros sensíveis entre tenants (saldos, IBAN last4,
  faturas de cartão, despesas individuais, recorrências). PII financeira.
- Integridade dos dados apresentados: os agregados (total do mês, património total) **misturam**
  households — números errados além de vazados.
- Conformidade: viola NFR5 (isolamento multi-tenant inegociável) e RGPD (data residency UE não
  mitiga acesso indevido entre titulares).

**Exploitável em prod hoje?** SIM, sem ferramentas nem pré-condições:
- Basta um utilizador autenticado de qualquer household abrir `/financas/*`. Não requer manipulação
  de pedidos, IDs adivinhados, nem privilégios — o leak é o caminho normal de renderização (read-path,
  GET/RSC). É *mais* trivial de disparar que um IDOR clássico: não é preciso enumerar IDs.
- É read-only (não há escrita cross-tenant por aqui), mas a leitura é total e indiscriminada.

**Relação com SEC-1/2/3:** SEC-1 fechou o read-path de `api/financas/*` com filtros app-enforced;
SEC-2/3 introduziram `withHousehold` para o caminho de rotas. As **SSR pages de leitura ficaram de
fora de todas essas fases** — é a lacuna que SEC-4 (correctamente identificada pelo @sm) tem de fechar.

---

## 5. Recomendação (para a story SEC-4 — não editei a story)

Duas estratégias possíveis; recomendo a **A** como fix imediato e a **B** como hardening definitivo:

**A) App-enforced (consistente com SEC-1) — fix imediato, baixo risco.**
Cada helper aceita `householdId: string` e acrescenta `and household_id = ${householdId}::uuid` a
TODAS as queries de domínio (incluindo as joins — filtrar pela tabela-raiz `accounts`/`cards`/
`transactions`/`recurrences`). As pages já resolvem `householdId` — passa-se ao helper em vez de o
descartar. Esta é a abordagem provada na coluna "COM filtro" do teste acima (isola 100%).

**B) RLS-enforced via `withHousehold` (consistente com SEC-2/3) — hardening estrutural.**
Migrar as pages de `getDb()` para o wrapper `withHousehold` (SET LOCAL ROLE authenticated + claims),
tornando a RLS efectiva também no read-path SSR. Elimina a dependência de "lembrar o filtro" em cada
query futura. Maior esforço; ideal como fase 2 alinhada com o ADR-003.

Defesa em profundidade ideal = **A + B** (filtro explícito *e* RLS activa), mas A sozinho já fecha o
leak. Recomendo bloquear o merge de qualquer nova feature de Finanças até A estar aplicado, dado o
CRITICAL.

**Gate de regressão:** manter/expandir `sec4_financas_ssr_leak.test.ts` como AC executável de SEC-4
(a coluna "COM filtro" passa a ser a asserção de aceitação após o fix).

---

## 6. Limitações desta confirmação

- A prova empírica usa o role bypassrls do container Testcontainers como proxy do role `postgres` de
  runtime — é o mesmo proxy validado e aceite em SEC-1 AC-K1 e no diag ADR-003 Fase 0. A confirmação
  directa contra o role de prod (DIRECT_URL) está fora de scope (read-only de metadados já feita em
  diag-adr003-phase0.ts, que confirmou `rolbypassrls` no runtime real).
- Não testei o render React das pages (só a query-shape SQL, que é onde vive o leak). O caminho
  page → helper → query está confirmado por leitura de código (§2.2).
