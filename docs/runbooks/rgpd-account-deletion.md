# Runbook — Eliminação de conta / purge RGPD (processo manual)

**Última actualização:** 2026-06-15
**Owner:** @aiox-master (Orion) — origem: follow-up [AGENTE+EURICO] do soft-launch
**Trace:** NFR10 (purge RGPD), tenancy.ts (cascade model), `.env.example` (`DATABASE_URL_SERVICE_ROLE`)
**Estado:** processo MANUAL para o soft-launch. Self-service (FR) fica como fast-follow.

---

## 1. Âmbito

A Expressia ainda **não tem fluxo self-service** de eliminação de conta nem
função Inngest de purge (apesar de mencionada em `.env.example`/`CLAUDE.md`).
Para o soft-launch — audiência pequena, pedidos raros — este runbook documenta o
processo **manual** que satisfaz o direito ao apagamento (RGPD art. 17.º). Cada
pedido é executado por um operador com acesso `service_role`/Postgres direto.

> AVISO: operação destrutiva e irreversível. Confirmar a identidade do titular e
> registar o pedido antes de executar. Fazer sempre num momento de baixa carga.

## 2. Modelo de cascade (porque a ordem importa)

Definido em `packages/db/src/schema/tenancy.ts`:

| FK | Alvo | `onDelete` | Consequência |
|----|------|-----------|--------------|
| `<tabela_dominio>.household_id` | `households.id` | **CASCADE** | apagar o household apaga TODO o domínio (tarefas, transações, contas, cartões, recorrências, audit, agent_*, etc.) |
| `household_members.household_id` | `households.id` | **CASCADE** | membros do household apagado caem com ele |
| `household_members.user_id` | `auth.users.id` | **CASCADE** | apagar o utilizador remove as suas memberships |
| `household_invites.household_id` | `households.id` | **CASCADE** | convites caem com o household |
| **`households.owner_user_id`** | `auth.users.id` | **RESTRICT** | ⚠️ **NÃO é possível apagar `auth.users` enquanto o utilizador for owner de algum household** |

### Gotcha central

O `ON DELETE RESTRICT` em `households.owner_user_id` significa que a abordagem
ingénua — "apagar a row em `auth.users`" — **falha** com erro de FK enquanto o
utilizador possuir um household. A ordem obrigatória é:

1. **Primeiro** apagar os households de que é owner (cascata limpa o domínio).
2. **Só depois** apagar o `auth.users` (cascata limpa memberships residuais
   noutros households onde era só membro).

## 3. Pré-condições

- Pedido do titular registado (email, data, identidade confirmada).
- Acesso à connection `service_role` (`DATABASE_URL_SERVICE_ROLE`, porta 5432) ou
  ao SQL Editor do Supabase Dashboard (corre como `postgres`, ignora RLS).
- Acesso à Supabase Auth Admin API ou ao Dashboard → Authentication → Users.

## 4. Procedimento

### Passo 0 — Identificar o utilizador e os seus households

```sql
-- user_id a partir do email
select id, email from auth.users where email = 'titular@exemplo.pt';

-- households de que é OWNER (têm de ser tratados primeiro)
select id, name from households where owner_user_id = '<user_id>'::uuid;

-- households de que é só MEMBRO (membership cai no Passo 2)
select hm.household_id, h.name, hm.role
from household_members hm join households h on h.id = hm.household_id
where hm.user_id = '<user_id>'::uuid;
```

### Passo 1 — Apagar os households owned (cascata de domínio)

> ⚠️ CAVEAT MULTI-MEMBRO: se o household tiver **outros membros**, apagá-lo
> destrói também os dados deles. No MVP família-first o caso típico é household
> com um único membro. Se houver co-membros, NÃO apagar o household — em vez
> disso transferir a propriedade (`update households set owner_user_id = ...`)
> para outro membro e remover só a membership do titular (Passo 2). Decidir
> caso a caso e registar a decisão.

```sql
-- Caso sole-owner / sole-member: apaga o household → cascata total do domínio
delete from households where id = '<household_id>'::uuid;
-- repetir para cada household owned do Passo 0
```

### Passo 2 — Apagar o utilizador em `auth.users`

Com os households owned já removidos, o RESTRICT está satisfeito. As memberships
residuais (households onde era só membro) caem por CASCADE.

Preferir a **Admin API** (limpa também sessões/identidades do GoTrue):

```ts
// Script admin com SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
await admin.auth.admin.deleteUser('<user_id>');
```

Alternativa: Dashboard → Authentication → Users → (utilizador) → Delete user.

### Passo 3 — Registo (audit)

O `audit_log` do(s) household(s) foi apagado pela cascata. Registar a eliminação
**fora** da BD do tenant (log do operador / ticket), com: email, user_id,
households apagados, timestamp ISO-8601, operador. Necessário para prova de
conformidade RGPD.

## 5. Verificação pós-purge

```sql
select count(*) from auth.users where id = '<user_id>'::uuid;          -- → 0
select count(*) from household_members where user_id = '<user_id>'::uuid; -- → 0
select count(*) from households where owner_user_id = '<user_id>'::uuid;  -- → 0
```

## 6. Follow-up (fast-follow, não soft-launch)

- **Self-service**: rota autenticada `/conta/eliminar` + confirmação forte, a
  chamar um job de purge controlado (Inngest, `getServiceDb()`), seguindo a ordem
  households→auth.users deste runbook. Reaproveita o modelo de cascade existente.
- **Transferência de propriedade**: UX para o owner transferir antes de sair de um
  household partilhado (resolve o caveat multi-membro do Passo 1).
- **Retenção**: definir política de retenção de backups (o purge lógico não
  apaga backups point-in-time do Supabase — documentar a janela na política de
  privacidade).
