# Supabase Auth Setup — meu-jarvis (Expressia)

**Última actualização:** 2026-05-06
**Owner:** @dev (Dex) + @devops (Gage)
**Trace:** Story 1.5 AC3 + AC4 + AC7, Architecture §5.1 §5.2 §5.3, PRD FR24/FR25/FR33

---

## Visão geral

Este runbook documenta a configuração end-to-end de autenticação Supabase
para a Expressia. Cobre:

1. Variáveis de ambiente em `apps/web/.env.local` e Vercel (NFR8).
2. Auth Hook `custom_access_token_hook` no Dashboard (injecta `household_id`
   no JWT).
3. Trigger SQL `on_auth_user_created` aplicado via migration 0003 (cria
   household default + membership owner + subscription trial 14d família +
   audit log).
4. Email confirmation (D8: OFF para MVP — follow-up quando Resend integrar).
5. URLs de redirect (Vercel preview deployments — D14).
6. Smoke test manual após cada deploy fresh.
7. Troubleshooting comum.

---

## 1. Variáveis de ambiente

### Local — `apps/web/.env.local`

```bash
# Supabase Auth (públicas, expostas ao browser).
NEXT_PUBLIC_SUPABASE_URL=https://llpotuxlyiyjvvxzetoo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-do-Dashboard>

# Service role (server-only — NUNCA exposta).
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-do-Dashboard>
```

Obter keys em: **Dashboard → Project Settings → API** → secção `Project API keys`.

### Vercel (Production / Preview / Development)

Configurar as três variáveis em **Vercel → Project → Settings → Environment Variables**.

| Variável                        | Production | Preview | Development                  |
| ------------------------------- | ---------- | ------- | ---------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | ✅         | ✅      | ✅                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅         | ✅      | ✅                           |
| `SUPABASE_SERVICE_ROLE_KEY`     | ✅         | ✅      | ❌ (usar `.env.local` local) |

Importante: NUNCA copiar `SUPABASE_SERVICE_ROLE_KEY` para um ficheiro committed.

---

## 2. Auth Hook — `custom_access_token_hook`

### Estado actual (2026-05-06)

✅ Função SQL aplicada (`packages/db/migrations/0002_auth_hook.sql`).
✅ Hook registado e enabled no Dashboard.

### Como verificar

1. Abrir **Supabase Dashboard → Authentication → Hooks**.
2. Confirmar que está listado:
   - **Name:** `Customize Access Token (JWT) Claims`
   - **Type:** `Postgres function`
   - **Schema:** `public`
   - **Function:** `custom_access_token_hook`
   - **Status:** Enabled (toggle azul/on).

### O que faz

Em cada login (e refresh), Supabase invoca esta função antes de assinar o JWT.
A função procura o primeiro membership do utilizador em `household_members`
(ordenado por `joined_at asc`) e adiciona `household_id` às claims do JWT.

Resultado: o JWT da sessão contém algo como:

```json
{
  "sub": "9f3c…",
  "email": "eurico@…",
  "household_id": "7a12…",
  "role": "authenticated",
  "exp": 1757...
}
```

A claim `household_id` é depois lida pelas policies RLS via
`public.current_household_id()` (helper definido em `0000_initial_schema.sql`).

### Re-enable após uma falha

Se o hook for desactivado por engano (por exemplo durante troubleshooting):

1. Dashboard → Authentication → Hooks → toggle.
2. Validar que continua a apontar para `public.custom_access_token_hook`.
3. Re-aplicar grants se necessário (raramente — o `0002` é idempotente):
   ```bash
   pnpm --filter @meu-jarvis/db db:migrate
   ```

---

## 3. Trigger `on_auth_user_created` — auto-criação de household

### Estado actual (2026-05-06)

✅ Trigger aplicado via migration `packages/db/migrations/0003_auth_user_trigger.sql`.

### O que faz

Quando o Supabase Auth insere uma row em `auth.users` (signup), o trigger
SQL `on_auth_user_created` dispara `public.handle_new_user()` e cria de forma
atómica (D2 — fail-hard):

| Tabela              | Conteúdo                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `households`        | nome `Casa de {username}`, plan `familia`, currency `EUR`, locale `pt-PT`, timezone `Europe/Lisbon` |
| `household_members` | role `owner`, ligação user ↔ household                                                              |
| `subscriptions`     | plan `familia`, status `trialing`, trial 14 dias, current*period*\* coerentes                       |
| `audit_log`         | action `household_created`, after_state com snapshot completo                                       |

### Verificação automatizada

```bash
pnpm --filter @meu-jarvis/db exec tsx src/scripts/verify-0003.ts
```

Saída esperada:

- Função `public.handle_new_user` existe com `security_type=DEFINER`.
- Trigger `on_auth_user_created` em `auth.users` (`AFTER INSERT`).
- Migration registada em `__schema_migrations`.
- `search_path=public` configurado.

### Suite de testes (Testcontainers)

```bash
pnpm --filter @meu-jarvis/db-test test src/tests/handle-new-user.trigger.test.ts
```

4 cenários cobertos: caminho feliz, email com pontos, email null (fallback),
fail-hard arquitectural (sem `EXCEPTION WHEN`).

---

## 4. Email confirmation (D8 — OFF no MVP)

### Decisão actual

Email confirmation está **desactivado** no Supabase Dashboard. Após signUp o
utilizador entra directamente na app.

### Como confirmar / alterar

Dashboard → **Authentication → Sign In / Up → Email**:

- `Confirm email`: **OFF**.

### Quando ligar

Quando a integração com Resend (Story do Epic 1) estiver pronta:

1. Configurar SMTP custom em Dashboard → **Authentication → SMTP Settings**:
   - Provider: Resend
   - Host: `smtp.resend.com`
   - Port: 465 / 587
   - User: `resend`
   - Pass: `<resend-api-key>` (Vercel env: `RESEND_API_KEY`).
2. Configurar templates PT-PT em **Authentication → Templates** (Confirm signup,
   Magic link, Reset password — todos PT-PT).
3. Activar `Confirm email` toggle.
4. Actualizar `apps/web/src/app/(auth)/registar/page.tsx`: substituir o redirect
   imediato por uma página "Verifica o teu email".

---

## 5. Redirect URLs (Vercel previews — D14)

### Decisão actual

Não bloqueante para Story 1.5 — a configuração é necessária quando o deploy
começar a acontecer. Documentado aqui como acção futura para `@devops` /
Eurico antes do primeiro merge para `main`.

### Configuração

Dashboard → **Authentication → URL Configuration**:

| Campo                     | Valor                               |
| ------------------------- | ----------------------------------- |
| Site URL                  | `https://expressia.pt` (production) |
| Redirect URLs (allowlist) | Lista abaixo                        |

Allowlist Redirect URLs:

```
http://localhost:3000/**
https://expressia.pt/**
https://*.vercel.app/**
```

O wildcard `*.vercel.app` permite que qualquer preview deployment da Vercel
funcione sem alteração ao Dashboard. Restrito ao domínio `vercel.app` por
segurança (não usar `**` solto).

### Notas de segurança

- O `Site URL` é o destino default para magic links / reset password.
- Os Redirect URLs são uma allowlist — Supabase rejeita redirects fora desta
  lista.
- Não incluir `*` (wildcard total) — abre vector de open redirect.

---

## 6. Smoke test manual (Task 3.4)

### Pré-requisitos

- `apps/web/.env.local` com as 3 keys configuradas.
- Supabase Auth Hook + trigger 0003 aplicados (verificar §2 e §3 acima).
- App dev a correr: `pnpm --filter @meu-jarvis/web dev`.

### Procedimento

1. **Registo**: abrir `http://localhost:3000/registar`, preencher email
   `dex-smoke-{timestamp}@meu-jarvis.test` + password 8+ chars, submeter.
   - Esperado: redirect para `/visao` (rota dummy criada na Story 1.5).

2. **Verificar trigger** no Supabase Dashboard → SQL Editor:

   ```sql
   select
     u.id, u.email,
     h.id as household_id, h.name, h.plan,
     m.role,
     s.status, s.trial_ends_at,
     a.action
   from auth.users u
   left join public.households h on h.owner_user_id = u.id
   left join public.household_members m on m.user_id = u.id
   left join public.subscriptions s on s.household_id = h.id
   left join public.audit_log a on a.user_id = u.id and a.action = 'household_created'
   where u.email = 'dex-smoke-XXXX@meu-jarvis.test';
   ```

   - Esperado: 1 linha, `name='Casa de dex-smoke-XXXX'`, `plan='familia'`,
     `role='owner'`, `status='trialing'`, `trial_ends_at` aproximadamente
     14 dias no futuro, `action='household_created'`.

3. **Logout**: `POST /api/auth/logout` (Server Action `logoutAction`) →
   redirect `/entrar`.

4. **Login**: voltar a `/entrar`, mesmas credenciais, submeter.
   - Esperado: redirect para `/visao`.

5. **Decode JWT** (verificar custom claim):
   - Em DevTools → Application → Cookies → copiar valor de
     `sb-llpotuxlyiyjvvxzetoo-auth-token`.
   - O cookie é base64 — procurar a parte do `access_token` (JWT).
   - Colar em `https://jwt.io` (ou usar `node -e "console.log(JSON.parse(Buffer.from(...))"`).
   - Verificar `payload.household_id` está presente e bate com o household
     criado no signup.

6. **Cleanup**: apagar o user de teste do Dashboard ou via SQL (cascada limpa
   tudo via FK ON DELETE CASCADE):
   ```sql
   delete from auth.users where email like 'dex-smoke-%';
   ```

---

## 7. Troubleshooting

### Erro: "Could not find function `custom_access_token_hook`"

- Verificar `pnpm --filter @meu-jarvis/db exec tsx src/scripts/verify-0002.ts`.
- Se a função não existe, re-aplicar: `pnpm --filter @meu-jarvis/db db:migrate`.
- Se existe mas Supabase não a chama, ir ao Dashboard → Auth → Hooks e
  re-seleccionar a função.

### JWT não contém `household_id`

- O hook só corre quando o user tem pelo menos 1 row em `household_members`.
- Se o trigger 0003 não disparou (signup antes da migration), o user fica
  sem household → JWT sem claim → RLS bloqueia tudo.
- Fix: criar membership manualmente via SQL Editor:
  ```sql
  -- Identificar user sem household.
  select u.id, u.email
  from auth.users u
  left join public.household_members m on m.user_id = u.id
  where m.user_id is null;
  ```
- Para re-criar manualmente o que o trigger faria, usar o template em
  `packages/db/migrations/0003_auth_user_trigger.sql` (replicar os 4 INSERTs
  com os valores explícitos D3-D7).

### "must be owner of relation users" ao aplicar migration

- O role `postgres` (pooler login) NÃO é owner de `auth.users` — owned por
  `supabase_auth_admin`. Operações que exigem ownership falham com 42501.
- Operações que exigem apenas privilégio TRIGGER funcionam (CREATE TRIGGER,
  DROP TRIGGER IF EXISTS, etc.).
- Operações bloqueadas: `COMMENT ON TRIGGER ... ON auth.users`, `ALTER TRIGGER
... RENAME`. Para descrição, comentar a função (`COMMENT ON FUNCTION`)
  em vez do trigger.

### Email reset não chega

- D8: SMTP custom não está configurado — Supabase usa o serviço default que
  só envia 4 emails/hora em projecto free.
- Para Production: configurar Resend (ver §4).

### Cookies de sessão não persistem

- Verificar que `apps/web/src/middleware.ts` está activo no path da rota
  (matcher inclui `/(app)/:path*` + `/api/((?!billing|cron).*)`).
- Em Server Components (não Server Actions / Route Handlers / middleware),
  `setAll` falha silenciosamente — comportamento esperado, mas o
  middleware tem de cobrir o request seguinte para refresh token.
- Verificar HTTPS em Production (cookies `Secure` flag).

---

## 8. Operações comuns

### Criar utilizador admin manualmente

Casos de teste / suporte. Via Dashboard:

1. Authentication → Users → Add user → email + password (auto-confirm).
2. Verificar que o trigger criou o household associado (SQL Editor:
   `select * from public.households where owner_user_id = '<user-id>'`).

### Resetar password de utilizador

1. Dashboard → Authentication → Users → seleccionar user → menu `…` → Reset password.
2. Supabase envia email (se SMTP configurado) ou gera link visível ao admin.

### Apagar utilizador

CASCADE limpa tudo automaticamente (`households.owner_user_id ON DELETE
RESTRICT` impede apagar user que ainda é owner; o admin precisa primeiro de
transferir ownership ou apagar o household).

```sql
-- Caminho seguro: apaga o household primeiro (cascade limpa tudo).
delete from public.households where owner_user_id = '<user-id>';
delete from auth.users where id = '<user-id>';
```

---

## Referências

- `packages/db/migrations/0002_auth_hook.sql` — função `custom_access_token_hook`.
- `packages/db/migrations/0003_auth_user_trigger.sql` — trigger `on_auth_user_created`.
- `packages/db/src/scripts/verify-0002.ts`, `verify-0003.ts` — scripts auditoria.
- `packages/auth/src/server.ts`, `browser.ts` — clientes SSR.
- `apps/web/src/middleware.ts` — auth gate + token refresh.
- `apps/web/src/app/(auth)/` — páginas e Server Actions PT-PT.
- `docs/architecture.md` §5 — Auth & Identity Architecture.
- `docs/runbooks/supabase-setup.md` — DB setup (complementar).
