# Supabase Auth Setup — meu-jarvis (Expressia)

**Última actualização:** 2026-05-29
**Owner:** @dev (Dex) + @devops (Gage)
**Trace:** Story 1.5 AC3 + AC4 + AC7, Story 6.1 AC2/AC3/AC4/AC9 (verificação de email ON — DP1), Architecture §5.1 §5.2 §5.3, PRD FR24/FR25/FR33

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

## 4. Email confirmation (DP1 — ON desde Story 6.1)

### Decisão actual

A verificação de email nativa do Supabase é **a activar** (DP1, Story 6.1),
revertendo a decisão D8 da Story 1.5 (que a mantinha OFF para o MVP). O código
da app já suporta o fluxo de confirmação end-to-end:

- `signUpAction` (`apps/web/src/app/(auth)/actions.ts`) passa
  `emailRedirectTo: {origin}/callback` e, quando o Supabase devolve `user` sem
  `session`, encaminha para `/confirm` (estado pendente).
- `apps/web/src/app/(auth)/callback/route.ts` troca `code`→sessão
  (`exchangeCodeForSession`) e encaminha para `/confirm?status=ok|error`.
- `apps/web/src/app/(auth)/confirm/page.tsx` comunica os estados pendente /
  sucesso / erro em PT-PT.

### Activação no Dashboard (BLOQUEADOR EXTERNO — acção Eurico/@devops)

Pré-condição para o fluxo funcionar end-to-end (AC9). Análoga ao registo do
Auth Hook (§2). Passos:

1. **Activar confirmação:** Dashboard → **Authentication → Sign In / Up →
   Email** → ligar `Confirm email` (ON). Verificar via:
   ```bash
   curl -s "https://<project-ref>.supabase.co/auth/v1/settings" \
     -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>" | jq '.mailer_autoconfirm'
   ```
   - `false` → confirmation ON (esperado a partir da Story 6.1).
2. **Redirect URL `/callback`:** garantir que a allowlist (§5) cobre
   `{origin}/callback` — os wildcards `http://localhost:3000/**`,
   `https://expressia.pt/**` e `https://*.vercel.app/**` já o cobrem.
3. **SMTP custom (Resend) — recomendado antes de produção:** Dashboard →
   **Authentication → SMTP Settings**:
   - Provider: Resend · Host: `smtp.resend.com` · Port: 465 / 587
   - User: `resend` · Pass: `<resend-api-key>` (Vercel env: `RESEND_API_KEY`).
   Sem SMTP custom o Supabase usa o serviço default partilhado (4 emails/hora —
   suficiente só para smoke em dev/staging).
4. **Templates PT-PT:** Dashboard → **Authentication → Templates** (Confirm
   signup, Magic link, Reset password — todos PT-PT).

### Reverter (se necessário voltar a entrada directa)

Desligar `Confirm email` (OFF). O código degrada graciosamente: sem
confirmação, `signUp` devolve sessão activa e `signUpAction` cai no fallback
`redirect('/visao')` — sem ecrã partido.

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

#### SEC-9 — env var `SITE_URL` na Vercel (endurecimento contra header poisoning)

Antes da Story SEC-9, a aplicação derivava o `redirectTo` dos links de
confirmação/reset a partir dos headers HTTP (`Origin` → `Host` +
`X-Forwarded-Proto`). Esses headers são, em cenários edge (proxy mal
configurado, SSRF), controláveis pelo cliente — abrindo um vector residual de
**password-reset-poisoning**: um atacante envenena o `Host`, o link de reset
gerado pelo Supabase aponta para `https://atacante.com/callback?...`, e o
utilizador entrega-lhe o token ao clicar.

SEC-9 introduz a env var de confiança **`SITE_URL`**, lida em
`getRequestOrigin()` (`apps/web/src/app/(auth)/actions.ts`) como primeira
instrução: quando definida, a app devolve esse valor sem tocar em nenhum
header, tornando o vector inviável em produção independentemente da allowlist.

**Acção de configuração [EURICO/@devops]:**

- **Definir `SITE_URL` em Vercel → Project → Settings → Environment Variables**,
  ambiente **Production**, valor `https://expressia.pt` (URL absoluto, **sem
  barra final** — é concatenado directamente com `/callback`). Obrigatória
  antes do soft-launch com tráfego real.
- Deixar `SITE_URL` **vazia/ausente** em Preview e Development, para que os
  deploys de preview Vercel (subdomínios `*.vercel.app` dinâmicos) e o
  desenvolvimento local continuem a funcionar via fallback por headers.
- **Após o DNS de produção estar estável**, recomenda-se **restringir ou
  eliminar o wildcard `https://*.vercel.app/**`** da allowlist de Redirect URLs
  acima — passa a ser superfície de ataque desnecessária quando o tráfego real
  corre no domínio próprio. Esta é uma acção de configuração [EURICO] no
  Dashboard, não gera código.

#### `Site URL` do Supabase ≠ env var `SITE_URL` da Vercel (PO-FIX-2)

São **dois conceitos homónimos e independentes** — não os confundir:

| Conceito | Onde se configura | O que controla |
| --- | --- | --- |
| Campo **`Site URL`** | Supabase Dashboard → Authentication → URL Configuration (tabela do §5, linha do `Site URL`) | Destino **default** que o Supabase usa para magic links quando o `redirectTo` não é fornecido — lado **Supabase**. |
| Env var **`SITE_URL`** | Vercel → Settings → Environment Variables (Production) | Origin que a **aplicação** usa em `getRequestOrigin()` para construir explicitamente o `redirectTo` — lado **app** (introduzida por SEC-9). |

São **camadas de defesa complementares**: ambas devem apontar para o **mesmo
domínio de produção** (`https://expressia.pt`). Configurar uma não dispensa a
outra.

#### SEC-11 — Restringir wildcard `*.vercel.app` após DNS estável

Mesmo com a env var `SITE_URL` definida (SEC-9), o wildcard
`https://*.vercel.app/**` na allowlist de Redirect URLs continua a ser
superfície de ataque residual: qualquer preview deployment `*.vercel.app`
arbitrário continua a ser um destino de redirect aceite pelo Supabase. Após o
DNS de produção estar estável, este wildcard deve ser removido.

**Pré-condições (todas obrigatórias antes de remover):**

- DNS-001 resolvido — `expressia.pt` aponta para a Vercel.
- Smoke E2E aprovado no domínio público (`https://expressia.pt`).
- `SITE_URL=https://expressia.pt` definida em Vercel Production (ver subsecção
  SEC-9 acima).

**Passos no Dashboard:**

1. Supabase Dashboard → Authentication → URL Configuration.
2. Na lista de **Redirect URLs**, remover `https://*.vercel.app/**`.
3. Manter apenas: `http://localhost:3000/**` (dev local) e
   `https://expressia.pt/**` (produção).
4. Guardar.

**Verificação automatizada (antes e depois da alteração):**

O script de auditoria `pnpm check:allowlist` consulta a Supabase **Management
API** (`GET /v1/projects/{ref}/config/auth`) e confirma o estado REAL da
allowlist — não depende de inspecção manual do Dashboard.

```bash
# Requer no .env.local local do operador:
#   SUPABASE_ACCESS_TOKEN  (Personal Access Token: Dashboard → Account → Tokens)
#   SUPABASE_PROJECT_REF   (ref do projecto, da URL do Dashboard)
pnpm check:allowlist
```

- **Antes da remoção:** o script termina com **exit 1** e identifica o wildcard
  `*.vercel.app` (confirma que a auditoria detecta o risco).
- **Depois da remoção:** o script termina com **exit 0** com "Allowlist segura.".
- Sem `SUPABASE_ACCESS_TOKEN` o script avisa e termina com exit 0 (modo
  gracioso — não bloqueia ambientes sem credencial).

**Rollback:** se um preview deployment legítimo quebrar por causa da remoção,
re-adicionar `https://*.vercel.app/**` temporariamente no Dashboard e
re-verificar com `pnpm check:allowlist`. A remoção volta a ser feita assim que
o fluxo de previews deixar de depender do wildcard.

> **AVISO — trade-off [EURICO]:** a remoção do wildcard é **irreversível do
> ponto de vista de segurança** no sentido em que, a partir daí, **cada novo
> preview deployment** que precise de testar fluxos de auth (confirmação de
> email, reset de palavra-passe) exigirá a **adição manual da URL específica**
> do preview à allowlist do Dashboard. É o custo operacional de fechar a
> superfície de ataque — decisão de aceitação do trade-off é do operador.

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
- Em Server Components (não Server Actions / Server Routes / middleware),
  `setAll` falha silenciosamente — comportamento esperado, mas o
  middleware tem de cobrir o request seguinte para refresh token.
- Verificar HTTPS em Production (cookies `Secure` flag).

### Signup mostra mensagem genérica e login falha (TASK-1, 2026-05-26)

**Sintoma:**

- `/registar` mostra "Não foi possível concluir o registo. Tenta novamente."
  ou "Conta criada. Verifica o teu email para confirmar e depois entra."
  e o utilizador nunca recebe o email.
- `/entrar` falha com "Tens de confirmar o teu email antes de entrar."

**Root cause:**

`Confirm email` foi reactivado no Dashboard (Authentication → Sign In / Up →
Email), revertendo a decisão D8 da Story 1.5. Sem SMTP custom configurado
(Resend ainda não integrado), o Supabase usa o serviço default partilhado,
que tem rate limit baixo (4 emails/hora) e bloqueia muitos domínios.
Resultado: utilizadores ficam em `auth.users` com `email_confirmed_at = NULL`
e não conseguem entrar.

**Verificar a configuração actual** (via API pública GoTrue settings):

```bash
curl -s "https://<project-ref>.supabase.co/auth/v1/settings" \
  -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>" | jq '.mailer_autoconfirm'
```

- `true`  → confirmation OFF (D8 honorado). OK.
- `false` → confirmation ON. Fix abaixo.

**Fix recomendado (Dashboard):**

1. **Dashboard → Authentication → Sign In / Up → Email** → desligar `Confirm email`.
2. Recarregar a config no curl acima — `.mailer_autoconfirm` passa a `true`.
3. Testar registo em `/registar` com email novo — deve cair em `/visao` directo.

**Fix alternativo (sem mexer Dashboard) — criar utilizador via admin API:**

Útil para smoke visual quando não se quer/pode mexer no Dashboard:

```bash
pnpm --filter @meu-jarvis/db exec tsx src/scripts/dev-create-user.ts \
  --email=dex+smoke1@expressia.pt \
  --password=Smoke12345!
```

O script:

- Usa `SUPABASE_SERVICE_ROLE_KEY` para criar o utilizador com
  `email_confirm: true` (bypassa confirmação).
- Trigger 0003 corre normalmente (household + membership + subscription + audit).
- Devolve credenciais imediatamente prontas para `/entrar`.

Apenas para uso em desenvolvimento — nunca em produção.

**Prevenção:**

O helper `apps/web/src/app/(auth)/_lib/error-messages.ts` (TASK-1, 2026-05-26)
mapeia explicitamente os códigos GoTrue mais comuns (`email_not_confirmed`,
`email_address_invalid`, `over_email_send_rate_limit`, `weak_password`,
`email_exists`, `user_banned`) para mensagens PT-PT accionáveis. Mantém este
helper actualizado sempre que aparecer um novo `code` real em produção —
mensagens genéricas escondem root causes e custam dias de debug.

Actualização Story 6.1: o `Confirm email` passa a ON (DP1). O branch
`if (data.user && !data.session)` em `signUpAction` já encaminha para a página
`/confirm` dedicada (estados pendente/sucesso/erro) — ver §4.

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

## 9. Rate Limiting de Autenticação (SEC-10)

**Trace:** Story SEC-10 AC5/AC6/AC7. Higiene de segurança pré-soft-launch.

### Estado actual — limites nativos GoTrue aplicados pelo Supabase

O Supabase Auth (GoTrue) aplica rate-limiting nativo aos endpoints de
autenticação sem que a aplicação precise de fazer nada. A app já comunica esses
limites ao utilizador em PT-PT: `apps/web/src/app/(auth)/_lib/error-messages.ts`
mapeia explicitamente os dois códigos de rate-limit relevantes para mensagens
accionáveis (evidência de que os limites existem e chegam ao utilizador):

| Código GoTrue | Mensagem PT-PT (signUp / signIn) |
| --- | --- |
| `over_email_send_rate_limit` | "Demasiados pedidos de registo deste endereço nos últimos minutos. Aguarda alguns minutos e tenta de novo." |
| `over_request_rate_limit` | "Demasiados pedidos. Aguarda alguns minutos e tenta de novo." |

Limites padrão aplicáveis aos três endpoints em uso (`signUp`,
`signInWithPassword`, `resetPasswordForEmail`), conforme documentação Supabase
Auth — Rate Limits (https://supabase.com/docs/guides/auth/auth-rate-limiting):

| Limite | Default | Âmbito | Configurável |
| --- | --- | --- | --- |
| **Emails enviados** (`over_email_send_rate_limit`) | ~2/hora com SMTP default partilhado; até ~30/hora típico com SMTP custom | por servidor de email / projecto | Sim, com SMTP custom (Resend — §4) |
| **Token / signup / OTP verifications** (`over_request_rate_limit`) | ~30/5 min por IP (endpoints sem sessão: login, registo, reset) | por IP | Sim, Dashboard (planos pagos) |
| **Token refresh** | ~150/5 min por IP | por IP | Sim, Dashboard (planos pagos) |

> Nota: os números exactos do plano Free/Pro podem variar entre versões do
> Supabase — confirmar sempre na página de Rate Limits do Dashboard
> (`Authentication → Rate Limits`) antes de assumir um valor. A app não depende
> de valores exactos: degrada graciosamente comunicando ao utilizador que
> aguarde, qualquer que seja o limite atingido.

### Endpoint `/recuperar` (reset de password) — decisão de design anti-enumeration (SEC-10 PO-FIX-1)

⚠️ **Importante (corrige uma suposição incorrecta do draft):** o reset de
password **NÃO mapeia** `over_email_send_rate_limit` para uma mensagem
específica — e **não deve passar a fazê-lo**. Por design **anti-enumeration**,
`resetPasswordAction` (`apps/web/src/app/(auth)/actions.ts`) colapsa **todos** os
erros do GoTrue (incluindo o rate-limit) numa única mensagem neutra:

> "Não foi possível enviar o email. Tenta novamente."

Em caso de sucesso devolve igualmente um estado neutro ("se o email existir,
recebes um link"). Isto impede que um atacante distinga, pela resposta, entre um
email registado e um não registado — revelar "demasiados pedidos para este
email" confirmaria implicitamente a existência da conta.

O comportamento está blindado por teste:
`apps/web/src/app/(auth)/__tests__/actions.test.ts` →
*"erro do Supabase → mensagem neutra (anti-enumeration)"* (mocka
`{ error: { message: 'rate limit' } }` e exige a mensagem neutra). **Não
introduzir mapping de rate-limit no caminho do reset** — seria uma regressão de
segurança. O rate-limiting do reset continua a ser aplicado pelo GoTrue ao nível
do servidor (limite de emails enviados), apenas não é exposto ao utilizador de
forma distinta. A protecção contra abuso permanece intacta; a mensagem é que é
deliberadamente opaca.

`signUp` e `signIn` PODEM expor o rate-limit (ver tabela acima) porque aí não há
risco de enumeration adicional — o utilizador está a interagir com o próprio
fluxo e a mensagem é accionável.

### Avaliação de suficiência — `[AUTO-DECISION]`

`[AUTO-DECISION]` Os limites nativos do GoTrue são **suficientes** para o
soft-launch e **não** se implementa guard de app-level (rate-limiting por IP em
`middleware.ts` ou nas Server Actions de auth) nesta story. Justificação:

- **Volume baixo e controlado:** o soft-launch é por convite, com poucos
  utilizadores iniciais — o vector de brute-force em massa é marginal.
- **Cobertura nativa já existe:** o GoTrue limita por IP (requests) e por email
  (envios), e a app comunica ambos em PT-PT (`signUp`/`signIn`); o reset está
  protegido pelo limite de envios do GoTrue (mensagem neutra por design).
- **MVP sem Redis/Upstash:** um rate-limiter em-memória no middleware é inútil em
  serverless (Vercel `fra1`): cada lambda tem o seu próprio processo, o estado
  não é partilhado entre instâncias nem sobrevive a cold starts — daria uma
  falsa sensação de protecção. Um guard robusto exigiria store partilhado
  (Upstash/Redis), fora do âmbito do MVP e do soft-launch de baixo volume.
- **Reavaliar quando:** o tráfego crescer para além do convite, surgirem sinais
  de abuso nos logs/Sentry, ou se activar registo público aberto. Nessa altura,
  preferir Supabase Dashboard Rate Limits (plano pago) + CAPTCHA (acções
  `[EURICO]` abaixo) antes de código de app-level.

### Acções `[EURICO]` — Dashboard Supabase

Configurações disponíveis no Dashboard que reforçam o rate-limiting sem alterar
código. Executar antes (ou logo após) o soft-launch, conforme o plano permitir:

1. **`[EURICO]` Ajustar limites de rate-limiting** (se o plano o permitir —
   tipicamente planos pagos): Dashboard → **Authentication → Rate Limits**.
   - Campos relevantes: *Rate limit for sending emails*, *Rate limit for
     token verifications / sign ups / sign ins*, *Rate limit for token refreshes*.
   - Recomendação soft-launch: manter os defaults; baixar o limite de emails se
     o SMTP custom (Resend) ainda não estiver configurado (evita esgotar quota).

2. **`[EURICO]` Activar CAPTCHA (hCaptcha / Cloudflare Turnstile)**: Dashboard →
   **Authentication → Settings → Bot and Abuse Protection** (designação pode
   variar por versão; também listado como *Attack Protection*).
   - Activar o *Enable Captcha protection* e escolher o provider (hCaptcha por
     defeito). Requer chaves do provider (site key + secret) coladas no
     Dashboard, e o widget no frontend (`/registar`, `/entrar`, `/recuperar`).
   - **Nota de âmbito:** SEC-10 **não** implementa o widget de CAPTCHA no
     frontend (exige trabalho de UI fora do âmbito). Activar CAPTCHA no Dashboard
     SEM o widget no frontend **bloquearia** todos os pedidos — só activar em
     conjunto com uma story de frontend dedicada. Documentado aqui como opção
     futura.

3. **`[EURICO]` SMTP custom (Resend)** — ver §4: aumenta o limite de envio de
   emails (default partilhado é muito baixo) e remove o GoTrue do caminho
   crítico de entregabilidade. Recomendado antes de tráfego real.

> SEC-10 conclui que, para o soft-launch de baixo volume PT-PT, os limites
> nativos + a comunicação PT-PT já existente são adequados; as acções acima são
> reforços recomendados (Dashboard, sem código), não bloqueadores.

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
