# db-specialist-review — SEC-8 Fase 0 (§12.7 gate duro)

- **Autora:** Dara (@data-engineer)
- **Data:** 09/06/2026
- **Handoff origem:** `mj-handoff-sec8-adenda12-kickoff-20260609.yaml` (architect → data-engineer)
- **Contrato avaliado:** ADR-003 Adenda §12 (envolver `executeAtomic` em `withHousehold` RLS-enforced)
- **Fonte de verdade RLS:** `packages/db/migrations/0001_rls_policies.sql` + helpers `0000_initial_schema.sql`
- **Git baseline:** origin/main = `aadbf31`

---

## VEREDICTO GLOBAL: **GO** ✅

Todas as tabelas que as tools do cérebro escrevem dentro de `executeAtomic` têm cobertura de policy write (INSERT/UPDATE/DELETE) ancorada em `is_household_member(household_id)`, que **activa correctamente** sob os claims injectados pelo `withHousehold`. Quando a RLS deixar de estar inerte em runtime (objectivo do SEC-8), nenhum INSERT do caminho atómico passa a ser rejeitado. `@sm *draft SEC-8` libertado.

---

## Cadeia de identidade — porque a RLS activa (não fica inerte)

`withHousehold({userId, householdId}, fn)` (`packages/db/src/client.ts:119-153`) faz, dentro de uma transação, com `SET LOCAL`:

1. `set local role authenticated` — sai do `service_role`/`postgres` (que têm `bypassrls`).
2. `set_config('request.jwt.claims', {sub: userId, household_id, role:'authenticated'}, true)`.
3. `set_config('app.current_household_id', householdId, true)` (defense-in-depth para o COALESCE).

`auth.uid()` resolve de `request.jwt.claims->>'sub'` = `userId`. O helper `is_household_member(target)` (`0000:51-64`, `security definer`) corre `select exists(... where hm.user_id = auth.uid() and hm.household_id = target)`. Logo, sob `withHousehold`, `is_household_member(ctx.householdId)` = **true** sse o utilizador é membro — exactamente o predicado de todas as policies write de domínio. Mecânica já provada na Fase 0 do ADR-003 (`diag-adr003-phase0.ts` — VEREDICTO GO, ref. `client.ts:117`).

---

## 1. Cobertura de policies write por tabela (GO/NO-GO)

Superfície de escrita real do `executeAtomic`, verificada por grep em `packages/tools/src` (não assumida):

| Tabela | INSERT | UPDATE | DELETE | Predicado write | Linhas (0001) | Veredicto |
|--------|--------|--------|--------|-----------------|---------------|-----------|
| `tasks` | ✅ | ✅ | ✅ | `is_household_member(household_id)` | 374-384 | **GO** |
| `transactions` | ✅ | ✅ | ✅ | `is_household_member(household_id)` | 542-552 | **GO** |
| `recurrences` | ✅ | ✅ | ✅ | `is_household_member(household_id)` | 508-518 | **GO** |
| `cards` | ✅ | ✅ | ⚠️ owner/admin | INS/UPD `is_household_member`; DEL `is_household_owner_or_admin` | 463-473 | **GO** (ver nota A) |
| `installments` | ✅ | ✅ | ✅ | `is_household_member(household_id)` | 525-535 | **GO** |
| `agent_reverse_ops` | ✅ | ✅ | ✅ | `is_household_member(household_id)` | 330-340 | **GO** |

Tools que escrevem cada tabela: `criar_tarefa`→`tasks`; `create_card`→`cards`; `criar_recorrencia`→`recurrences`; `criar_financa_variavel`→`transactions`; `criar_prestacoes`→`installments`+`transactions`; **todas**→`agent_reverse_ops` (atomic.ts:245). Nenhuma tabela fora da lista do architect entra no caminho atómico.

Cruzamento com `ALLOWED_REVERSE_TABLES` (`undo/route.ts:279-285` = `{tasks, transactions, recurrences, cards, installments}`): coincide com a superfície de escrita forward (menos `agent_reverse_ops`, que é a própria tabela de undo). Consistente.

---

## 2. `agent_reverse_ops` INSERT a `authenticated` não é rejeitado

- Policy `agent_reverse_ops_insert_member` (`0001:330-332`): `with check (public.is_household_member(household_id))`.
- INSERT em `atomic.ts:244-250` insere `household_id = ${ctx.householdId}`. Sob `withHousehold`, `ctx.householdId` é o household dos claims → `is_household_member` = true → **WITH CHECK passa**. ✅

> **CORRECÇÃO ao pressuposto §12.7 (item 2):** o architect hipotetizou que o predicado seria `household_id = current_household_id()`. **Não é** — o predicado real é `is_household_member(household_id)`. É **mais robusto** (valida pertença, não apenas igualdade do claim) e passa na mesma. **Acção para o @sm/@dev/@qa:** qualquer AC ou teste que assira o literal `current_household_id()` nesta tabela está errado — usar `is_household_member(household_id)`.

---

## 3. Triggers de imutabilidade no caminho do `executeAtomic`

O único trigger de imutabilidade é `trg_agent_runs_immutability` (`0005:76-80`): `BEFORE UPDATE ON agent_runs ... WHEN old.status IN ('success','reverted','failed')`, bloqueia `current_user IN ('authenticated','anon')`.

- `executeAtomic` **não** faz UPDATE a `agent_runs` — esse UPDATE vive em `insertAgentRun`/`updateAfter*`, fora do `txRunner` (§12.3, fica `getDb()` app-enforced). A transição terminal de `agent_runs` é a do **undo**, que corre `service_role` (D-12C, excepção permanente).
- As tabelas escritas dentro do `txRunner` (6 acima) **não têm** trigger de imutabilidade. Os restantes triggers são inócuos para o caminho: `set_updated_at` (BEFORE UPDATE, harmless), `kanban_columns_max_check` (fora de âmbito), `user_prefs_set_updated_at` (fora do caminho).

**Veredicto:** nenhum trigger bloqueia `authenticated` no caminho de escrita atómico. ✅

---

## 4. SECURITY DEFINER functions não mascaram a RLS

Inventário de `security definer` (grep migrations):

| Função | Papel | Risco de mascarar RLS no caminho atómico? |
|--------|-------|-------------------------------------------|
| `current_household_id`, `is_household_member`, `is_household_owner_or_admin` (0000) | **Helpers das próprias policies** — só *lêem* `household_members` | Não — implementam a RLS, não a contornam |
| `custom_access_token_hook` (0002), `handle_new_user` (0003/0018/0019) | Auth hook / trigger de `auth.users` | Não — fora do caminho do cérebro |
| `seed_household_kanban_defaults`, `tr_seed_kanban...` (0009) | Trigger AFTER INSERT em `households` | Não — só dispara em criação de household |
| `accept_invite(...)` (0020/0022) | Aceitação de convite | Não — fora do caminho do cérebro |

As tools de escrita fazem `INSERT INTO <tabela>` via Drizzle/`tx.execute` directamente sobre `ctxWithTx.db = tx` (o `tx` do `withHousehold`). **Nenhuma** route através de uma função `SECURITY DEFINER` que escreva domínio com privilégios elevados. As únicas `SECURITY DEFINER` no caminho são os helpers de membership invocados *pelas policies* — desenhados para isso, só leitura. ✅

---

## Notas para o draft SEC-8

- **Nota A — `cards` DELETE owner/admin:** a policy DELETE de `cards` é `is_household_owner_or_admin` (mais estrita que as outras reverse tables). Sem impacto: (i) o caminho forward de `create_card` é INSERT (`is_household_member` ✅); (ii) o undo de cards corre `service_role` (RLS não aplica). **Mas** se um futuro tool tentar DELETE de `cards` como `authenticated` não-admin dentro do `executeAtomic`, será bloqueado. Fora de âmbito hoje — registar como invariante.
- **Sem migration nova necessária.** Billing permanece congelado. A cobertura de policies já existe integralmente; SEC-8 é puramente o salto de DI do `txRunner` (código), não schema.
- **Foco recomendado para o AC9 (@qa):** teste cross-household provando que um INSERT atómico com `householdId` de outro household é **rejeitado pelo Postgres** (não só pelo filtro app SEC-1). O harness de referência é `packages/db-test/src/rls-harness.ts` (`asUser`).

---

## Próximo passo

`@sm *draft SEC-8` a partir da Adenda §12 (ACs em §12.8). Sequência §12.10: draft → `@po *validate` → `@dev *develop` → `@qa *qa-gate` (foco AC9) → `@devops *push` (incluir a Adenda §12 não-commitada no commit de fecho).

— Dara, arquitetando dados 🗄️
