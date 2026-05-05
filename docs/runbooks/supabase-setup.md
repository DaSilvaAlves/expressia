# Supabase Setup — meu-jarvis (Expressia)

**Última actualização:** 2026-05-04
**Owner:** @data-engineer (Dara) + @dev (Dex)
**Trace:** Story 1.3 AC8, Architecture §11.2, PRD NFR11

---

## Projecto Supabase

| Campo | Valor |
|-------|-------|
| Project ref | `llpotuxlyiyjvvxzetoo` |
| URL | `https://llpotuxlyiyjvvxzetoo.supabase.co` |
| Região | `eu-west-1` (Ireland) |
| Postgres | 17.6 |
| Compliance | EU (GDPR) — equivalente a Frankfurt para data residency (NFR11) |

> **Nota sobre região:** A Architecture §11.2 menciona Frankfurt (`eu-central-1`)
> como referência. O projecto Supabase está em **`eu-west-1` (Ireland)**, que
> também está dentro do espaço UE/EEE e cumpre os mesmos requisitos GDPR/NFR11.
> A localização é equivalente para efeitos de residency. Quando necessário,
> migrar para Frankfurt requer recriar o projecto Supabase.

---

## Variáveis de ambiente

O package `@meu-jarvis/db` usa um padrão **dual-URL** alinhado com a recomendação Supabase:

| Variável | Porta | Modo pgbouncer | Uso |
|----------|-------|----------------|-----|
| `DATABASE_URL` | 6543 | Transaction-mode | Runtime queries (Server Components, Route Handlers, Inngest) |
| `DIRECT_URL` | 5432 | Session-mode | Migrations, `drizzle-kit`, scripts admin |

**Ambas as URLs apontam para o pooler regional**
(`aws-0-eu-west-1.pooler.supabase.com`) — IPv4-compatível, evita problemas com
hosts directos `db.<ref>.supabase.co` que requerem IPv6.

### Ficheiro `.env.local`

Criar `packages/db/.env.local` com:

```bash
SUPABASE_URL=https://llpotuxlyiyjvvxzetoo.supabase.co
SUPABASE_PROJECT_REF=llpotuxlyiyjvvxzetoo
SUPABASE_SERVICE_ROLE_KEY=<service_role_jwt>
SUPABASE_SECRET_KEY=<sb_secret_…>

# Transaction pooler (porta 6543) — runtime queries
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres

# Session pooler (porta 5432) — migrations e Drizzle Kit
DIRECT_URL=postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

> **NUNCA commitar `.env.local`.** Está protegido pelo `.gitignore` raiz.

---

## Aplicar schema + RLS + seeds (primeira corrida)

```bash
# A partir da raiz do monorepo:
pnpm --filter @meu-jarvis/db install        # garantir dotenv + tsx + postgres

pnpm --filter @meu-jarvis/db db:migrate     # aplica 0000_initial_schema.sql + 0001_rls_policies.sql
pnpm --filter @meu-jarvis/db db:seed        # aplica seeds/0001_default_categories.sql
pnpm --filter @meu-jarvis/db db:check-rls   # verifica que cada tabela multi-tenant tem 4 policies
```

---

## Verificações pós-apply

Correr as queries seguintes via Supabase Dashboard → SQL Editor (ou via `psql $DIRECT_URL`):

```sql
-- 1) Número de tabelas em public (esperado: 27 — 26 domínio + __schema_migrations)
select count(*) as n from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';

-- 2) Número de policies RLS (esperado: >= 104)
select count(*) from pg_policies where schemaname = 'public';

-- 3) Categorias default PT-PT seeded (esperado: >= 18)
select count(*) from public.categories where is_default = true;

-- 4) Helpers SQL existem
select proname from pg_proc
where proname in ('current_household_id', 'is_household_member', 'is_household_owner_or_admin');

-- 5) Extensions activadas
select extname, extversion from pg_extension
where extname in ('pgcrypto', 'pg_stat_statements', 'vector');
```

---

## Re-aplicar migrations num ambiente novo

O runner custom (`packages/db/src/scripts/apply-migrations.ts`) é **idempotente**:

- Cada migration é registada em `public.__schema_migrations`
- Re-correr `pnpm db:migrate` skip ficheiros já aplicados
- As migrations 0000 e 0001 usam `create … if not exists` / `create or replace`, por isso re-aplicar manualmente também é safe

---

## Reset em dev local

> **NUNCA correr em produção.**

```sql
-- No SQL Editor da Supabase em modo "danger":
drop schema public cascade;
create schema public;
-- depois: pnpm --filter @meu-jarvis/db db:migrate && db:seed
```

Em alternativa para dev local com Docker Postgres, ver `packages/db/docker-compose.yml`
(se/quando criado em story posterior).

---

## Smoke tests

```bash
pnpm --filter @meu-jarvis/db test
```

Os testes em `src/__tests__/db-connection.test.ts` skipam automaticamente se
`DATABASE_URL` / `DIRECT_URL` não estiverem definidos. Em CI sem credenciais,
o smoke test passa como skipped — em local com `.env.local` configurado, valida
que tabelas, policies, helpers e seeds existem.

---

## Connection pooling em produção (Vercel)

Em produção (Vercel), a única env var disponível em runtime é `DATABASE_URL`
(pooler 6543 transaction-mode). `DIRECT_URL` só é usada em CI/CD para correr
migrations via GitHub Actions com approval gate (Architecture §11.4).

| Env | Onde | Quando |
|-----|------|--------|
| `DATABASE_URL` | Vercel runtime | Cada request runtime |
| `DIRECT_URL` | GitHub Actions secrets | Apenas no job `db-migrate` |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + GitHub | Inngest jobs, scripts admin |

---

## Troubleshooting

### `error: prepared statement … already exists`

Causa: `prepare: true` (default) com pooler 6543 (transaction-mode pgbouncer).
**Fix:** o cliente em `packages/db/src/client.ts` já passa `prepare: false`.
Se aparecer noutros sítios, garantir que toda a chamada `postgres()` usa essa flag.

### `error: connection refused`

Causa típica: tentar usar a host directa `db.<ref>.supabase.co` (requer IPv6
e algumas redes corporativas/Vercel não suportam).
**Fix:** usar **sempre** a host do pooler regional `aws-0-eu-west-1.pooler.supabase.com`.

### Migrations falham com erro de permissões em RLS helpers

Causa: o utilizador `postgres` do pooler não tem `security definer` em alguns contextos.
**Fix:** os helpers em `0000_initial_schema.sql` já são `security definer` —
aplicar com a connection do role `postgres` (não anon, não authenticated).
A `DIRECT_URL` no `.env.local` usa o role correcto.

---

## Próximos passos

- [ ] Story 1.4 — RLS test suite (testes pgTAP ou SQL custom)
- [ ] Story 1.5 — Supabase Auth (email/password + custom JWT claim `household_id`)
- [ ] Story 1.6 — Endpoint canary `/api/health` que valida client Drizzle em runtime Vercel

---

## Referências

- Architecture §3.2 (RLS helpers) e §11.2 (connection pooling)
- PRD NFR5 (RLS coverage), NFR11 (data residency UE)
- db-schema.md §2 (migrations) e §6 (migration strategy)
- Story 1.3 (esta story)
