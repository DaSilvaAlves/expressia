# Runbook — Eliminação manual de conta (RGPD Art. 17)

> **Tipo:** runbook operacional manual (soft-launch).
> **Story de origem:** `RGPD-1` (`docs/stories/active/RGPD-1.account-deletion-purge-process.story.md`).
> **Estado do self-service:** **DEFERIDO** — ver §6. No soft-launch, a eliminação é executada manualmente por um operador autorizado seguindo este runbook.
> **Âmbito legal:** RGPD Art. 17 (direito ao apagamento) + Art. 12 (prazos de resposta). FR29 / NFR10.
> **AVISO:** este runbook contém **pseudocódigo de referência**, não código de produção a colar. Os comandos SQL e os snippets são ilustrativos; o operador adapta-os ao caso concreto e valida cada passo antes de executar.

---

## 1. Âmbito e pré-condições

### 1.1 Quem pode executar

Apenas o operador técnico do Expressia (DaSilvaAlves / Eurico ou equipa técnica designada) com acesso à connection string `service_role` e ao Supabase Dashboard do projecto de produção (`eu-central-1`).

### 1.2 Quando se executa

Quando o titular dos dados exerce o direito ao apagamento (RGPD Art. 17) e o pedido foi recebido e validado pelo canal definido em §1.5.

### 1.3 Ambiente e ferramentas necessárias

| Recurso | Detalhe |
|---------|---------|
| Connection string `service_role` | Variável `DATABASE_URL_SERVICE_ROLE` (porta 5432, session pooler). Consumida por `getServiceDb()` em `packages/db/src/client.ts`. Tipicamente igual a `DATABASE_URL_DIRECT`. |
| Supabase Dashboard (produção) | Acesso a **Authentication → Users** (eliminação de `auth.users`) e a **Storage** (limpeza de exports). |
| Script admin / job controlado | Qualquer SQL com `getServiceDb()` corre **só** num script admin ou job Inngest controlado — **nunca** num response handler de utilizador. Ver §3.1. |

### 1.4 Restrição de segurança crítica — `getServiceDb()`

`getServiceDb()` usa o role `service_role` (`rolbypassrls = TRUE`) e **ignora por completo as 104 RLS policies** do schema. O guard JSDoc em `packages/db/src/client.ts::getServiceDb()` (adicionado em SEC-10) declara, textualmente, a regra indexável:

> **NUNCA usar em response handlers de utilizador final**

O mesmo guard existe no wrapper `getServiceDb()` de `apps/web/src/lib/agent/db-shim.ts`. Em caminhos de utilizador final usa-se sempre `getDb()` (role `authenticated`, filtro `household_id` app-enforced — 1.ª rede SEC-1) ou `withHousehold()` (RLS activa — 2.ª rede SEC-2).

A eliminação de conta enquadra-se na **categoria 1 de uso legítimo** descrita no guard: *migrações e scripts de admin (sem JWT de utilizador no contexto)*. No futuro, quando o self-service for implementado, enquadrar-se-á na **categoria 2**: *jobs Inngest controlados, disparados por evento/cron (sem JWT de utilizador)* — a função `gdpr-purge` (ver §6 e §7).

Referências canónicas do guard:
- `CLAUDE.md` §Multi-tenancy via Postgres RLS — regra `getServiceDb` vs `getDb`.
- `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` §D6 / §12.3 / §12.5.
- `SEC-10` (auditoria de usos de `getServiceDb()`).

### 1.5 Canal do pedido e prazo legal de resposta (RGPD Art. 12)

| Item | Definição |
|------|-----------|
| **Canal do pedido** | O titular exerce o direito ao apagamento por **email para o endereço de privacidade publicado** no site (página `/privacidade`). No soft-launch, este é o endereço de contacto de privacidade/RGPD indicado nas páginas legais (a confirmar/preencher por Eurico — placeholder `[email]` em `/privacidade`). Pedidos por outros canais (suporte, chat) são reencaminhados para esse endereço para deixar rasto auditável. |
| **Verificação de identidade** | Antes de executar, confirmar que o pedido vem do email associado à conta (ou de identidade comprovada de forma equivalente), para não eliminar dados de terceiro. |
| **Prazo de resposta (Art. 12.º, n.º 3)** | A eliminação deve ser efectuada **sem demora injustificada** e, em qualquer caso, **no prazo de 1 mês a contar da recepção do pedido**. O prazo pode ser prorrogado por mais 2 meses em casos complexos, informando o titular nesse primeiro mês. No soft-launch de volume reduzido, a expectativa operacional é executar em **menos de 15 minutos** com este runbook, muito dentro do prazo legal. |
| **Confirmação ao titular** | Após executar, responder ao titular confirmando a eliminação (sem reproduzir dados pessoais na resposta). |

---

## 2. Mapa do `ON DELETE CASCADE` — o que é apagado vs o que fica

A unidade de tenancy é o `household` (`households` em `packages/db/src/schema/tenancy.ts`). Eliminar o household via `DELETE FROM households WHERE id = $householdId` (com `getServiceDb()`) propaga o `ON DELETE CASCADE` do Postgres por toda a árvore de dados de domínio. O purge é **atómico** ao nível da base de dados.

### 2.1 Apagado automaticamente pelo CASCADE (ancorado em `households.id`)

Fonte: `packages/db/src/schema/*.ts`. Todas as tabelas abaixo têm FK `household_id ... references households.id, { onDelete: 'cascade' }`.

| Schema | Tabelas eliminadas em cascata |
|--------|-------------------------------|
| `tenancy.ts` | `household_members`, `household_invites`, `kanban_columns` |
| `billing.ts` | `subscriptions`, `payment_methods`, `invoices`, `payment_events` (ver aviso fiscal em §2.4) |
| `agent.ts` | `agent_runs`, `intent_classifications`, `agent_reverse_ops`, `agent_quotas`, `agent_rate_limit_counters` |
| `tasks.ts` | `tasks`, `task_recurrences`, `tags`, `task_tags` |
| `finance.ts` | `accounts`, `cards`, `categories`, `transactions`, `recurrences`, `installments` |
| `audit.ts` | `audit_log` (linhas com este `household_id`), `data_export_jobs`, `account_deletion_jobs`, `feature_flags` |
| `prefs.ts` | `user_prefs` (FK `household_id` cascade **e** FK `user_id` cascade para `auth.users`) |

> **Nota de verificação:** os nomes acima foram confirmados byte-a-byte contra `packages/db/src/schema/*.ts`. A própria coluna `households.id` é referenciada com `onDelete: 'cascade'` em cada uma destas tabelas.

### 2.2 NÃO apagado pelo CASCADE — resíduos a tratar manualmente (§4)

1. **`auth.users` (Supabase Auth).** O registo do utilizador vive no schema `auth`, gerido pelo Supabase Auth, **fora** do schema público. `DELETE FROM households` **não** apaga o utilizador de `auth.users`. Requer eliminação explícita via Supabase Auth Admin API (`supabase.auth.admin.deleteUser(userId)`) ou Dashboard → Authentication → Users → Delete. (`packages/db/src/schema/auth.ts` é apenas uma tabela-espelho para tipagem das FKs; não gera migração nem altera DDL.)
2. **Supabase Storage.** Exports de dados (`data_export_jobs.storage_path`, formato `exports/{household_id}/{job_id}.zip`) ficam no bucket de Storage. O CASCADE apaga a **linha** `data_export_jobs` na DB, mas **não** o ficheiro físico no Storage. Requer limpeza via Storage Admin API ou Dashboard.
3. **Logs Sentry / Grafana Cloud (EU).** Dados de observabilidade não contêm PII directo (sem prompts em claro; apenas `user_id` / `household_id` como labels/trace IDs). Retenção standard configurada por região UE; **não há acção obrigatória de purge** nestes sistemas no MVP. Documentar como tal na checklist de auditoria.
4. **Dados de terceiros / Stripe.** O cancelamento da subscrição no Stripe é um passo **manual fora do âmbito** deste runbook — ver §2.4 (billing CONGELADO).

### 2.3 Caso `auth.users` — `audit_log.user_id` é `SET NULL`, não CASCADE

O campo `user_id` em `audit_log` é `ON DELETE SET NULL` — confirmado no DDL real em `packages/db/migrations/0000_initial_schema.sql:691`:

```sql
user_id uuid references auth.users(id) on delete set null,
```

Consequências práticas:
- As linhas de `audit_log` **deste household** são apagadas pelo CASCADE de `household_id` quando o household é eliminado (passo §3.2).
- Se existirem linhas de `audit_log` com este `user_id` mas de **outro** `household_id` (utilizador membro de múltiplos households), essas linhas **não** são apagadas: ao eliminar o utilizador de `auth.users` (passo §4.1), o seu `user_id` nessas linhas fica `NULL` (SET NULL). Isto é o comportamento desejado para preservar a integridade do log de auditoria do(s) household(s) que **permanece(m)**, ao mesmo tempo que remove o vínculo ao titular eliminado.

Outras FKs relevantes para o caso multi-household (confirmadas no schema):
- `household_members.user_id` → `auth.users` **CASCADE**: ao eliminar `auth.users`, a participação do utilizador em qualquer household é removida automaticamente.
- `households.owner_user_id` → `auth.users` **RESTRICT** (`tenancy.ts:55`): **o Postgres recusa** eliminar um utilizador em `auth.users` enquanto ele for `owner_user_id` de algum household existente. Isto **impõe a ordem de operações** descrita em §2.5 — apagar os households primeiro, o utilizador depois.

### 2.4 Aviso billing / fiscal (scope CONGELADO)

As tabelas `subscriptions`, `payment_methods`, `invoices` e `payment_events` **são apagadas em cascata** ao eliminar o household (FK `household_id` cascade, confirmado em `billing.ts`). Contudo:

> **AVISO (conflito RGPD × retenção fiscal):** as `invoices` contêm dados com **obrigação legal de conservação** independente do RGPD — nomeadamente `invoices.nif_customer` (NIF do cliente, FR35) e dados de facturação para a Autoridade Tributária. A legislação fiscal portuguesa exige conservação de documentos de facturação por vários anos. O apagamento RGPD do household **não revoga** essa obrigação: o RGPD Art. 17.º, n.º 3, alínea b) ressalva o tratamento necessário ao cumprimento de obrigação legal. Antes de apagar um household com facturação emitida, **avaliar com aconselhamento jurídico** se as facturas devem ser **retidas fora do household** (ex.: arquivo contabilístico/Stripe) antes do purge, em vez de apagadas. No soft-launch, billing está **CONGELADO** (directiva de 29/05/2026) e não há facturação real emitida — o conflito é, na prática, teórico, mas fica documentado.

> **Cancelamento Stripe — passo manual FORA do âmbito.** O cancelamento da subscrição no painel/API do Stripe **não** é coberto por este runbook nem pelo `DELETE FROM households`. Quando billing estiver activo, cancelar a subscrição Stripe é um passo manual adicional (billing CONGELADO — não implementar aqui).

### 2.5 Ordem de operações correcta (multi-household)

Por causa do `RESTRICT` em `households.owner_user_id` (§2.3), a ordem é **obrigatoriamente**:

1. **Identificar** todos os households de que o titular é membro (`household_members`) e, dentro desses, quais devem ser eliminados.
2. **Eliminar primeiro o(s) household(s)** que devem desaparecer — tipicamente aquele(s) de que o titular é o **único dono / único membro** ou cujo apagamento foi pedido. Cada `DELETE FROM households` propaga o CASCADE (§2.1) e remove também o vínculo do titular via `household_members ... CASCADE`.
3. **Só depois** eliminar o utilizador em `auth.users` (§4.1). Nesse momento, ele já não é `owner_user_id` de nenhum household existente, pelo que o `RESTRICT` não bloqueia.

> **Caso de borda — membro de múltiplos households:** se o titular for membro (mas **não o único dono**) de outros households que **devem permanecer** (ex.: household partilhado de família que continua a existir), **não** eliminar esses households. Para esses:
> - Remover o titular do household partilhado (`DELETE FROM household_members WHERE household_id = $outroHousehold AND user_id = $userId`) **antes** de apagar o utilizador, ou deixar que o CASCADE de `household_members.user_id` o faça automaticamente ao eliminar `auth.users` no passo §4.1.
> - As linhas de `audit_log` desses households que tinham o titular como `user_id` ficam com `user_id = NULL` (SET NULL — §2.3), preservando o log do household que continua.
> - **Atenção ao `owner_user_id`:** se o titular for `owner_user_id` de um household que deve **permanecer** (com outros membros), é necessário **transferir a posse** (UPDATE `households.owner_user_id` para outro membro) **antes** de eliminar o utilizador — caso contrário o `RESTRICT` bloqueia. Avaliar caso a caso; transferência de posse não é coberta pelo fluxo simples e deve ser confirmada com o titular e os membros restantes.

---

## 3. Passo-a-passo do processo manual (DB de domínio)

> Todos os comandos desta secção correm via `getServiceDb()` num **script admin** (categoria 1 do guard §1.4). **Pseudocódigo de referência** — adaptar e validar.

### 3.1 Padrão de invocação `getServiceDb()` (referência)

```ts
// PSEUDOCÓDIGO — script admin (NÃO é response handler de utilizador).
// getServiceDb() ignora RLS: legítimo SÓ em script admin ou job Inngest controlado.
// Guard JSDoc (client.ts): "NUNCA usar em response handlers de utilizador final".
import { getServiceDb } from '@meu-jarvis/db/client';
import { sql } from 'drizzle-orm';

const db = getServiceDb(); // role service_role — requer DATABASE_URL_SERVICE_ROLE
```

### 3.2 Recolher contexto e eliminar o household (cascata atómica)

```ts
// PSEUDOCÓDIGO — passo §3.2
// 1. Identificar households do titular e classificar (único dono vs partilhado).
const memberships = await db.execute(sql`
  select hm.household_id, h.owner_user_id, h.name,
         (select count(*) from household_members x where x.household_id = hm.household_id) as member_count
  from household_members hm
  join households h on h.id = hm.household_id
  where hm.user_id = ${userId}
`);

// 2. Para cada household a eliminar (ver §2.5 — único dono / pedido de apagamento):
//    O DELETE propaga ON DELETE CASCADE por toda a árvore de domínio (§2.1).
await db.execute(sql`delete from households where id = ${householdId}`);

// 3. Repetir para cada household a eliminar. Households partilhados que devem
//    permanecer NÃO entram aqui (§2.5 — caso de borda).
```

> **Verificação pós-DELETE:** confirmar que `select count(*) from tasks where household_id = $householdId` (e equivalentes) devolve `0`. O CASCADE garante-o, mas a verificação documenta a evidência para auditoria.

---

## 4. Resíduos externos (não cobertos pelo CASCADE)

### 4.1 Eliminar o utilizador em `auth.users` (Supabase Auth)

> Executar **depois** de eliminados os households de que o titular é dono (§2.5), senão o `RESTRICT` em `owner_user_id` bloqueia.

Opção A — Supabase Auth Admin API (pseudocódigo):

```ts
// PSEUDOCÓDIGO — script admin com a service role key (SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from '@supabase/supabase-js';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Apaga o registo em auth.users. Dispara CASCADE em household_members.user_id,
// user_prefs.user_id (CASCADE) e SET NULL em audit_log.user_id (§2.3).
await admin.auth.admin.deleteUser(userId);
```

Opção B — Supabase Dashboard: **Authentication → Users** → localizar o utilizador → **Delete user**.

### 4.2 Limpar exports em Supabase Storage

```ts
// PSEUDOCÓDIGO — antes de apagar o household (ou imediatamente após), recolher os
// storage_path dos exports e remover os ficheiros físicos do bucket.
// Nota: o CASCADE apaga a LINHA data_export_jobs, não o ficheiro no Storage.
const paths = await db.execute(sql`
  select storage_path from data_export_jobs
  where household_id = ${householdId} and storage_path is not null
`);
await admin.storage.from('exports').remove(paths.map((r) => r.storage_path));
```

> Em alternativa, no Dashboard → **Storage** → bucket `exports` → apagar a pasta `exports/{household_id}/`.

### 4.3 Sentry / Grafana Cloud

Sem acção obrigatória no MVP (§2.2 ponto 3): os dados são labels/trace IDs sem PII directo, em retenção UE standard. Registar na checklist (§5) que foi avaliado e que não há purge adicional necessário.

---

## 5. Registo de auditoria (`audit_log`)

O `audit_action` enum (`packages/db/src/schema/audit.ts`) inclui as três acções GDPR relevantes — confirmado no schema:

- `account_deletion_requested`
- `account_deletion_canceled`  *(existe no enum; usado quando um pedido é revogado antes da execução — relevante no fluxo self-service futuro com janela de 30 dias)*
- `account_deletion_executed`

### 5.1 Sequência de registo

> **Ordem importante:** registar `account_deletion_requested` num household/contexto **antes** do `DELETE`, e `account_deletion_executed` num contexto que **sobreviva** ao purge.

> **Caveat técnico:** as linhas de `audit_log` com o `household_id` eliminado são apagadas pelo CASCADE (§2.1). Para manter rasto de auditoria pós-eliminação, registar o evento `account_deletion_executed` **sem** o `household_id` apagado (deixar `household_id` a `NULL` — a coluna é nullable, DDL `0000_initial_schema.sql:690`) ou guardar evidência fora da DB (ticket do pedido + log do script admin). Documentar a abordagem escolhida no registo do pedido.

```ts
// PSEUDOCÓDIGO — registo de auditoria via getServiceDb()
// 1. Antes do purge (rasto do pedido):
await db.execute(sql`
  insert into audit_log (household_id, user_id, action, entity_table, entity_id)
  values (${householdId}, ${userId}, 'account_deletion_requested', 'households', ${householdId})
`);

// 2. Após o purge (rasto da execução — household_id a NULL para sobreviver ao CASCADE):
await db.execute(sql`
  insert into audit_log (household_id, user_id, action, before_state)
  values (null, null, 'account_deletion_executed', ${JSON.stringify({ deletedHouseholdIds, deletedUserId: userId, requestedAt, executedAt })})
`);
```

### 5.2 Checklist de auditoria a registar pelo operador

- [ ] Pedido recebido pelo canal de privacidade (§1.5) e identidade do titular verificada.
- [ ] Data/hora do pedido e prazo legal (1 mês — Art. 12) anotados.
- [ ] Households do titular identificados e classificados (único dono vs partilhado — §2.5).
- [ ] `account_deletion_requested` registado no `audit_log`.
- [ ] Exports em Storage recolhidos e removidos (§4.2).
- [ ] Household(s) eliminado(s) via `DELETE FROM households` (CASCADE verificado).
- [ ] Posse transferida onde aplicável (household partilhado que permanece — §2.5).
- [ ] Utilizador eliminado em `auth.users` (§4.1).
- [ ] Sentry / Grafana avaliados (sem purge adicional — §4.3).
- [ ] Stripe: subscrição cancelada manualmente **se** billing estiver activo (FORA do âmbito — §2.4).
- [ ] `account_deletion_executed` registado (com `household_id` a `NULL` ou evidência externa — §5.1).
- [ ] Confirmação enviada ao titular (sem reproduzir PII).

---

## 6. Decisão — self-service DEFERIDO (ADR inline)

**Decisão:** para o soft-launch (PT-PT exclusivo, volume reduzido, early adopters conhecidos), o fluxo **self-service** de eliminação de conta é **DEFERIDO**. A eliminação é feita manualmente pelo operador segundo este runbook.

**Estado da infraestrutura (evidência directa):**
- A tabela `account_deletion_jobs` e o enum `account_deletion_status` **existem** no schema (`packages/db/src/schema/audit.ts`, linhas ~122 e ~214) — infra preparatória.
- O enum `audit_action` já inclui `account_deletion_requested` / `account_deletion_canceled` / `account_deletion_executed`.
- **NÃO** existe a rota `/api/account/delete` nem a função Inngest `gdpr-purge` registada. As funções registadas em `apps/web/src/app/api/inngest/route.ts` são apenas: `cleanupExpiredReverseOps`, `generateRecurringTasks`, `generateFinanceRecurrences`.
- **Correcção factual (origem documental):** a função `gdpr-purge` é mencionada em `docs/architecture.md` (§12.1 — `/api/account/delete` agenda Inngest job 30d; §14.5 / ADR-005 — "GDPR purge multi-step" como caso de uso do Inngest) e em `docs/adr/ADR-003 §D6`. O `.env.example` contém **um comentário** (linha ~20) que lista "GDPR purge" entre os crons Inngest futuros, ao descrever `DATABASE_URL_SERVICE_ROLE` — mas **não** define nenhuma variável de ambiente chamada `gdpr` nem regista a função. Ou seja: a intenção arquitectural está documentada em `architecture.md`/ADR-003; o `.env.example` apenas a menciona de passagem num comentário. (Ver [DEV-DECISION D-RGPD1.2] nas notas da story.)

**Justificação do deferimento:**
- O self-service exigiria: rota autenticada `/api/account/delete`, UI em `/conta`, e a função Inngest `gdpr-purge` multi-step (confirmação 30 dias revogável + hard-delete + cleanup Storage + Auth Admin delete). Estimativa: 1-2 stories médias.
- O processo manual é **proporcional** para soft-launch: executável em <15 min, muito dentro do prazo legal de 1 mês (Art. 12).
- O schema já está preparado — implementar o self-service é uma questão de construir o fluxo, **não** de alterar o schema.

**Critério de reavaliação:** operacionalizar o self-service quando (a) o volume de pedidos de eliminação tornar o processo manual ineficiente, **ou** (b) for atingido um milestone de lançamento público alargado (abertura geral / saída do soft-launch).

### 6.1 Padrão Inngest `gdpr-purge` (Fase futura — NÃO implementar nesta story)

Esboço da estrutura esperada da função, para referência arquitectural:

```
gdpr-purge/
  trigger: evento Inngest "gdpr/account.deletion.scheduled"
  step 1: validar account_deletion_jobs.status === 'scheduled' && scheduledFor <= now()
  step 2: getServiceDb() → DELETE FROM households WHERE id = householdId (CASCADE)
  step 3: supabase.auth.admin.deleteUser(requestedByUserId)
  step 4: supabase.storage.from('exports').remove([storagePath]) (data_export_jobs pendentes)
  step 5: UPDATE account_deletion_jobs SET status='completed', completedAt=now()
  step 6: INSERT INTO audit_log (action='account_deletion_executed', ...)
```

A janela de 30 dias (`account_deletion_jobs.scheduledFor`) suporta a revogação (`account_deletion_canceled`) antes da execução. Nesse fluxo, `getServiceDb()` enquadra-se na **categoria 2** do guard (job Inngest controlado, sem JWT de utilizador).

---

## 7. Referências

| Fonte | Conteúdo |
|-------|----------|
| `CLAUDE.md` §Multi-tenancy via Postgres RLS | Regra canónica `getServiceDb()` vs `getDb()`; guard "NUNCA usar em response handlers de utilizador final". |
| `packages/db/src/client.ts::getServiceDb()` | Guard JSDoc SEC-10 (3 categorias de uso legítimo). |
| `apps/web/src/lib/agent/db-shim.ts` | Wrapper `getServiceDb()` com o mesmo guard. |
| `packages/db/src/schema/audit.ts` | `auditActionEnum` (3 acções GDPR), `accountDeletionJobs`, `accountDeletionStatusEnum`, `auditLog` (`household_id` nullable). |
| `packages/db/src/schema/tenancy.ts` | `households` (alvo do DELETE; `owner_user_id` RESTRICT), `household_members` (`user_id` CASCADE). |
| `packages/db/src/schema/prefs.ts` | `user_prefs` (`user_id` CASCADE para `auth.users`). |
| `packages/db/src/schema/billing.ts` | `subscriptions`/`payment_methods`/`invoices`/`payment_events` (CASCADE); `invoices.nif_customer` (retenção fiscal). |
| `packages/db/src/schema/auth.ts` | Tabela-espelho `auth.users` (gerida pelo Supabase Auth; fora do CASCADE de domínio). |
| `packages/db/migrations/0000_initial_schema.sql:691` | DDL real: `user_id ... on delete set null` em `audit_log`. |
| `apps/web/src/app/api/inngest/route.ts` | Confirma que `gdpr-purge` NÃO está registado. |
| `docs/architecture.md` §12.1 (GDPR checklist), §12.4 (audit), §14.5 (ADR-005 Inngest) | Intenção arquitectural do self-service e do `gdpr-purge`. |
| `docs/adr/ADR-003-rls-enforced-runtime-hardening.md` §D6 / §12.3 / §12.5 | `getServiceDb()` ignora RLS por design; jobs/GDPR purge. |
| `SEC-10` | Auditoria de usos de `getServiceDb()` + guard JSDoc indexável. |
| RGPD Art. 17 (apagamento), Art. 12 (prazos), Art. 17.º n.º 3 b) (ressalva obrigação legal) | Base legal. FR29 / NFR10. |

---

*Runbook produzido na story `RGPD-1` — documentação pura, sem código de produção, migrations ou alterações de schema.*
