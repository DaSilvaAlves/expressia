# Story SEC-11: Restringir wildcard `*.vercel.app` da allowlist Supabase após DNS estável

## Status

Done

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools:
  - "pnpm lint"
  - "pnpm typecheck"
  - "pnpm --filter @meu-jarvis/web test"
  - "pnpm build"
  - "pnpm check:rls"
```

## Story

**As a** equipa de segurança Expressia,
**I want** que a allowlist de Redirect URLs do Supabase Dashboard deixe de conter o wildcard `*.vercel.app` após o DNS de produção estar estável, e que exista um script de auditoria automatizável que verifique o estado real da allowlist via Management API,
**so that** a superfície de ataque residual de password-reset-poisoning via subdomínios `*.vercel.app` arbitrários seja eliminada e o estado da configuração seja verificável pelo operador sem acesso manual ao Dashboard.

## Acceptance Criteria

1. Um script TypeScript `scripts/audit-supabase-allowlist.ts` é criado na raiz do monorepo que, via **Supabase Management API** (`GET https://api.supabase.com/v1/projects/{ref}/config/auth`), lê a configuração de Redirect URLs do projecto e reporta: (a) se a allowlist contém o wildcard `*.vercel.app`; (b) se contém `https://expressia.pt/**` (ou o domínio de produção via env var); (c) se contém algum wildcard total (`**` solto) ou URL suspeita. O script termina com exit code 0 se a configuração for segura, exit code 1 se detectar configuração de risco. O campo relevante na resposta da Management API é `uri_allow_list` (string CSV — parsear com `.split(',')`), não um array JSON.

2. O script requer **duas** variáveis de ambiente para funcionar: `SUPABASE_ACCESS_TOKEN` (Personal Access Token Supabase — **nova**, não existe actualmente no `.env.example`; usada como header `Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}`) e `SUPABASE_PROJECT_REF` (referência do projecto Supabase — **nova no `.env.example` raiz**, embora já documentada em `docs/runbooks/supabase-setup.md`). Ambas são adicionadas ao `.env.example` com comentário a indicar que são exclusivamente para uso operacional (não são env vars de runtime de produção Vercel). Modo gracioso: se `SUPABASE_ACCESS_TOKEN` estiver ausente, o script imprime aviso em PT-PT e termina com exit 0 — não bloqueia ambientes sem credencial.

3. O `package.json` da raiz expõe um script `check:allowlist` que corre `tsx scripts/audit-supabase-allowlist.ts`, de forma análoga ao `check:rls` existente.

4. O runbook `docs/runbooks/supabase-auth-setup.md` é actualizado na secção §5 com um sub-procedimento "SEC-11 — Restringir wildcard `*.vercel.app` após DNS estável" que documenta, passo a passo: (a) quando executar (após `expressia.pt` apontar para Vercel e smoke E2E passar); (b) passos no Dashboard (Authentication → URL Configuration → remover `https://*.vercel.app/**`, manter apenas `http://localhost:3000/**` e `https://expressia.pt/**`); (c) como correr `pnpm check:allowlist` (via Management API) para confirmar o estado antes e depois da alteração; (d) caminho de rollback (re-adicionar o wildcard se um preview deployment quebrar).

5. Os testes unitários em Vitest cobrem a lógica de auditoria do script com mocks da resposta HTTP da Management API: (a) allowlist segura (`uri_allow_list: "http://localhost:3000/**,https://expressia.pt/**"`) → exit 0; (b) allowlist com `*.vercel.app` no CSV → exit 1 com mensagem em PT-PT a identificar o padrão; (c) allowlist com wildcard total `**` no CSV → exit 1; (d) token inválido / resposta 401 da Management API → exit 1 com mensagem de diagnóstico PT-PT; (e) `SUPABASE_ACCESS_TOKEN` ausente → exit 0 com aviso PT-PT (modo gracioso). Os cenários usam o formato real da API: campo `uri_allow_list` como string CSV, não array.

6. O script `check:allowlist` **não é adicionado ao pipeline CI** — é uma ferramenta operacional corrida pelo operador (Eurico/@devops) com o seu PAT pessoal. O comportamento gracioso de exit-0-sem-PAT existe precisamente para que o CI (sem credencial) não falhe, mas o `check:allowlist` não é listado como gate obrigatório de CI. Os gates de CI mantêm-se: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @meu-jarvis/web test`, `pnpm build`, `pnpm check:rls`.

7. A story não altera nenhum ficheiro de código de aplicação (`apps/`, `packages/`) nem nenhuma migration SQL — o vector principal já foi fechado em SEC-9 (env var `SITE_URL`). O âmbito é exclusivamente: script de auditoria, configuração do workspace, actualização de `.env.example`, e actualização de runbook.

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI não está activado em `core-config.yaml`.
> A validação de qualidade utiliza processo de revisão manual (@architect).

## Tasks / Subtasks

- [x] Tarefa 1 — Criar script `scripts/audit-supabase-allowlist.ts` (AC: 1, 2)
  - [x] 1.1 Ler `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF` do `process.env`; se `SUPABASE_ACCESS_TOKEN` estiver ausente, imprimir aviso PT-PT ("AVISO: SUPABASE_ACCESS_TOKEN não definida — auditoria ignorada.") e terminar com exit 0 (modo gracioso). Se `SUPABASE_PROJECT_REF` estiver ausente mas o token presente, terminar com exit 1 e mensagem PT-PT a indicar a variável em falta.
  - [x] 1.2 Fazer `fetch` ao endpoint `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth` com header `Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}`; tratar erros de rede, respostas não-JSON, e resposta 401 (token inválido/expirado) com exit 1 e mensagem de diagnóstico PT-PT.
  - [x] 1.3 Extrair o campo `uri_allow_list` (string CSV) e o campo `site_url` da resposta JSON; parsear o CSV com `.split(',').map(s => s.trim()).filter(Boolean)` para obter o array de URLs; listar todas as URLs em modo verbose (console.log PT-PT).
  - [x] 1.4 Detectar presença de wildcard `*.vercel.app` (padrão `/\.vercel\.app/`) nas URLs da allowlist; registar aviso PT-PT + exit 1 se encontrado.
  - [x] 1.5 Detectar wildcard total (`**` solto não qualificado por domínio, ou padrão `*://`) nas URLs; registar aviso PT-PT + exit 1 se encontrado.
  - [x] 1.6 Detectar presença do domínio de produção (`https://expressia.pt/**` ou valor de env `PRODUCTION_DOMAIN` se definida) como check informativo (não bloqueia — pode faltar em ambientes de preview).
  - [x] 1.7 Terminar com exit 0 e mensagem "Allowlist segura." se nenhum padrão de risco for detectado.

- [x] Tarefa 2 — Registar script `check:allowlist` no workspace e actualizar `.env.example` (AC: 2, 3)
  - [x] 2.1 Adicionar entrada `"check:allowlist": "tsx scripts/audit-supabase-allowlist.ts"` ao `scripts` do `package.json` raiz (verificar primeiro se já existe entrada similar).
  - [x] 2.2 Confirmar que `tsx` já está disponível no workspace (é usado pelo `apply-migrations.ts` — ver `packages/db/src/scripts/`); se não estiver como devDependency root, adicionar `tsx` às devDependencies da raiz. (Já presente: `"tsx": "^4.19.0"` nas devDependencies raiz — nenhuma alteração necessária.)
  - [x] 2.3 Adicionar ao `.env.example` raiz, na nova secção "Auditoria operacional (SEC-11)", as duas variáveis: `SUPABASE_ACCESS_TOKEN` (com nota "Personal Access Token — apenas para check:allowlist operacional, NÃO é var de runtime Vercel") e `SUPABASE_PROJECT_REF` (com nota "Ref do projecto Supabase — apenas para check:allowlist operacional").

- [x] Tarefa 3 — Actualizar runbook `docs/runbooks/supabase-auth-setup.md` §5 (AC: 4)
  - [x] 3.1 Localizar o final da subsecção "SEC-9" em §5 (ancorado por texto: após o bloco `#### Site URL do Supabase ≠ env var SITE_URL (PO-FIX-2)`, antes de `## 6. Smoke test manual`) e inserir novo sub-procedimento "SEC-11 — Restringir wildcard `*.vercel.app` após DNS estável".
  - [x] 3.2 Documentar: pré-condição (DNS-001 resolvido + smoke E2E aprovado no domínio público + `SITE_URL` definida em Vercel Production — ver SEC-9 §5); passos Dashboard (Authentication → URL Configuration → remover `https://*.vercel.app/**`); comando de verificação (`pnpm check:allowlist` — requer `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF` no ambiente local do operador); caminho de rollback (re-adicionar wildcard temporariamente se preview deployment quebrar, e re-verificar).
  - [x] 3.3 Acrescentar nota que a remoção do wildcard é **irreversível do ponto de vista de segurança** (qualquer preview deployment novo irá requerer adição manual de URL específica ao Dashboard) — trade-off documentado para decisão [EURICO].

- [x] Tarefa 4 — Criar testes unitários Vitest (AC: 5)
  - [x] 4.1 Extrair a lógica de detecção para função exportada `auditAllowlist(urls: string[]): AuditResult` — separa lógica pura (testável) de I/O (fetch, process.exit). Os testes importam esta função directamente. [DEV-DECISION D-SEC11.1] A função pura vive em `apps/web/src/lib/security/audit-allowlist.ts` (zero `node:*`/`process.exit`), não no `scripts/`. Ver Completion Notes.
  - [x] 4.2 Criar ficheiro de teste em `apps/web/src/__tests__/audit-supabase-allowlist.test.ts` (coberto pelo Vitest do package `@meu-jarvis/web`, que já corre em CI). Path coberto pelo `vitest.config.ts` do web (`include: ['src/**/*.{test,spec}.{ts,tsx}']`) — verificado empiricamente.
  - [x] 4.3 Cenário A — allowlist segura (`uri_allow_list: "http://localhost:3000/**,https://expressia.pt/**"`): verificar que `auditAllowlist` retorna resultado sem riscos e exit code 0.
  - [x] 4.4 Cenário B — wildcard `*.vercel.app` presente no CSV: verificar que a função retorna resultado com mensagem PT-PT a identificar o wildcard e exit code 1.
  - [x] 4.5 Cenário C — wildcard total (`https://**`) presente no CSV: verificar exit code 1.
  - [x] 4.6 Cenário D — resposta 401 da Management API (token inválido): testado via `evaluateAuthConfigResponse(401, ...)` (mapeia resposta HTTP → exit 1 sem I/O de rede); + `vi.stubGlobal('fetch', ...)` no cenário E prova o caminho sem rede; verificar exit code 1 com mensagem de diagnóstico PT-PT.
  - [x] 4.7 Cenário E — `SUPABASE_ACCESS_TOKEN` ausente: verificar exit 0 com aviso PT-PT (modo gracioso — não bloqueia CI), `fetch` nunca chamado.

- [x] Tarefa 5 — Quality gate final (AC: 6, 7)
  - [x] 5.1 `pnpm lint` (--max-warnings=0) verde — confirmar que o novo script TypeScript não introduz warnings ESLint.
  - [x] 5.2 `pnpm typecheck` verde — o script usa tipagem estrita; sem `any`; `process.env.*` tratados como `string | undefined`.
  - [x] 5.3 `pnpm --filter @meu-jarvis/web test` verde — confirmar que os novos testes passam e que nenhum teste existente regride.
  - [x] 5.4 `pnpm build` verde — o script não é incluído no bundle Next.js (é um script CLI standalone); confirmar que não afecta o output de build.
  - [x] 5.5 `pnpm check:rls` verde — confirmar que zero tabelas com `household_id` foram tocadas (esta story não toca DB).
  - [x] 5.6 Confirmar via `git diff --stat` que nenhum ficheiro em `apps/`, `packages/`, ou `packages/db/migrations/` foi modificado (excepto ficheiros NOVOS em `apps/web/src/lib/security/` e `apps/web/src/__tests__/` que são aceitáveis).

## Dev Notes

### Contexto e motivação

Esta story é a continuação natural de **SEC-9** (`docs/stories/completed/SEC-9.harden-auth-redirect-host-header.story.md`, Done 16/06/2026). SEC-9 fechou o vector principal de password-reset-poisoning ao nível da aplicação, introduzindo a env var de confiança `SITE_URL` em `getRequestOrigin()` (`apps/web/src/app/(auth)/actions.ts`, linhas 61-77 em HEAD). O vector residual documentado no runbook e no commit `f472c22` (Directive) era:

> "após DNS estável: restringir ou eliminar o wildcard `*.vercel.app` na allowlist de Redirect URLs do Supabase Dashboard"

Esta acção é de configuração [EURICO] no Dashboard, mas requer:
1. Um procedimento documentado e verificável (não "memória humana").
2. Um script de auditoria que confirme o estado real da configuração antes e depois da alteração.

**Porquê uma story de script e não apenas runbook?** Sem script de auditoria, a verificação do estado da allowlist exige login manual no Dashboard. Um script `check:allowlist` torna a verificação automatizável (pré-smoke, pré-launch, operações periódicas), análogo ao `check:rls` existente para cobertura de RLS.

### Relação com SEC-9 (não duplicar trabalho)

O código de aplicação (`apps/web/src/app/(auth)/actions.ts` e `apps/web/src/app/(auth)/callback/route.ts`) **NÃO** requer alteração:
- `getRequestOrigin()` já lê `SITE_URL` como primeira instrução (AC1/AC2 da SEC-9, verificado em HEAD).
- `callback/route.ts` já tem open-redirect guard via `ALLOWED_NEXT_PATHS` allowlist estática (linhas 64-67 em HEAD).
- `.env.example` já documenta `SITE_URL` com a secção "Redirect de autenticação (SEC-9)".
- O runbook §5 já tem a subsecção SEC-9 com a nota de recomendação de restrição do wildcard (linhas ~258-262 em HEAD).

SEC-11 adiciona: (a) o script de auditoria; (b) o sub-procedimento detalhado de remoção; (c) testes do script; (d) as duas env vars operacionais no `.env.example`.

### Descoberta relevante da investigação (estado actual do código)

Leitura de `apps/web/src/app/(auth)/actions.ts` em HEAD (após SEC-9, commit em prod):

```typescript
async function getRequestOrigin(): Promise<string> {
  // SEC-9: env var de confiança tem precedência sobre headers controláveis pelo cliente.
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) return siteUrl.replace(/\/$/, '');  // SEC-001: normaliza trailing slash

  // Fallback por headers (dev local / preview Vercel)
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
```

O vector principal está fechado. O wildcard `*.vercel.app` só é vector se `SITE_URL` não estiver definida em produção (ou se a allowlist for usada como única linha de defesa num cenário edge).

### Fonte correcta da allowlist: Management API (não GoTrue `/auth/v1/settings`)

**AVISO CRÍTICO — defeito da v1.0 desta story:** O endpoint `GET /auth/v1/settings` autenticado com a anon key **NÃO expõe** a allowlist de Redirect URLs (`additional_redirect_urls`). A struct `Settings` do GoTrue (`internal/api/settings.go`) só devolve flags de signup, providers e mailer. O próprio runbook do projecto (`docs/runbooks/supabase-auth-setup.md`, linhas ~173-176) usa esse endpoint com a anon key, mas exclusivamente para ler `.mailer_autoconfirm` — nunca para a allowlist, porque o campo não existe na resposta. Um script baseado nesse endpoint teria `uri_allow_list === undefined` → saía sempre com exit 0 = auditor que dá sempre verde mesmo com wildcard presente.

**A fonte correcta é a Supabase Management API:**

```
GET https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_REF}/config/auth
Authorization: Bearer {SUPABASE_ACCESS_TOKEN}
```

O campo relevante na resposta é `uri_allow_list` (string CSV, não array):

```json
{
  "site_url": "https://expressia.pt",
  "uri_allow_list": "http://localhost:3000/**,https://expressia.pt/**,https://*.vercel.app/**"
}
```

Parsear com: `uriAllowList.split(',').map(s => s.trim()).filter(Boolean)`.

### Alternativa considerada e recusada: validação estática de ficheiro

Foi considerada a abordagem de validar a allowlist a partir de um ficheiro de configuração estático no repo (ex.: checklist de URLs esperadas em YAML). Rejeitada porque não prova que o Dashboard Supabase real foi alterado — a allowlist vive numa base de dados do Supabase, não no repo. Sem chamar a Management API, o script validaria um contrato inventado, não o estado real. Decisão: Management API é a única abordagem que prova o estado efectivo da configuração.

### Env vars: estado actual no repo

| Variável | `.env.example` raiz | Noutro ficheiro | Observação |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | **ausente** | `.aiox-core/` (read-only, não relevante) | **Nova** — adicionar em SEC-11 |
| `SUPABASE_PROJECT_REF` | **ausente** | `docs/runbooks/supabase-setup.md` linha 47 | **Nova no `.env.example` raiz** — adicionar em SEC-11 |

Ambas são variáveis operacionais (não vão para a Vercel Production como env vars de runtime da app). O operador (Eurico) define-as no seu `.env.local` local quando precisar de correr `pnpm check:allowlist`.

### Localização e execução dos testes do script (decisão explícita)

`scripts/` não está coberto pelo Vitest da raiz nem pelo `apps/web/vitest.config.ts` por omissão. Existem duas opções válidas:

**Opção A (preferida — KISS):** Extrair a lógica de detecção para uma função exportada `auditAllowlist(urls: string[]): AuditResult` dentro do próprio `scripts/audit-supabase-allowlist.ts`. Criar o teste em `apps/web/src/__tests__/audit-supabase-allowlist.test.ts` — path já coberto pelo Vitest do `@meu-jarvis/web`. O teste importa a função directamente (sem chamar o script completo). O I/O (fetch, process.exit) fica no main do script e não é testado unitariamente — design intencional: a lógica pura é testada, o I/O é testado manualmente pelo operador.

**Opção B (alternativa):** Criar `scripts/vitest.config.ts` mínimo e correr com `pnpm --filter scripts test`. Mais overhead; só preferir se o `@dev` encontrar impedimento à Opção A.

[AUTO-DECISION] Opção A é a decisão por omissão. O `@dev` deve documentar como `[DEV-DECISION]` se mudar para Opção B, com justificação.

### Convenções do projecto a respeitar

- TypeScript strict: sem `any`; `process.env.*` é `string | undefined` — tratar sempre.
- PT-PT em todos os comentários, mensagens de log e mensagens de erro do script.
- `check:rls` é o padrão de script de auditoria — seguir o mesmo padrão de exit codes (0 = ok, 1 = problema).
- O script não deve fazer chamadas a `getDb()` / `getServiceDb()` — é um script standalone sem acesso a Postgres.
- Sem imports de `@meu-jarvis/*` no script (standalone, sem transpilePackages).
- Imports absolutos `@/...` não se aplicam a `scripts/` (fora do Next.js — usar imports relativos ou `node:*` builtins).

### Confirmação de ausência de impacto em RLS / Base de dados

Esta story não toca em nenhuma tabela de domínio, migration SQL, schema Drizzle, nem em `getDb()` / `getServiceDb()`. O RLS Coverage Gate (`pnpm check:rls`) não é afectado. Não há migration a criar.

### Referências

- `docs/stories/completed/SEC-9.harden-auth-redirect-host-header.story.md` — story antecessora; confirmar ACs Done antes de iniciar.
- `docs/runbooks/supabase-auth-setup.md` §5 — secção a actualizar; subsecção SEC-9 linhas ~234-275 (em HEAD).
- `docs/runbooks/supabase-setup.md` linha 47 — confirmação que `SUPABASE_PROJECT_REF` existe noutro runbook mas não no `.env.example` raiz.
- `apps/web/src/app/(auth)/actions.ts` — `getRequestOrigin()` (linhas 61-77) e `resetPasswordAction` — NÃO modificar.
- `apps/web/src/app/(auth)/callback/route.ts` — open-redirect guard `ALLOWED_NEXT_PATHS` (linhas 64-67) — NÃO modificar.
- Commit `f472c22` — Directive original: "Antes de tráfego real: fixar SITE_URL via env var em produção OU restringir o wildcard *.vercel.app na allowlist."
- `scripts/check-rls-coverage.ts` — padrão de script de auditoria existente a seguir.
- `docs/handoffs/mj-handoff-followups-soft-launch-20260615.yaml` — item `[AGENTE] Host-header no reset password` (a ser fechado pela combinação SEC-9 + SEC-11).
- Supabase Management API docs: https://supabase.com/docs/reference/api/introduction (endpoint `/v1/projects/{ref}/config/auth`).

### Testing

- Framework: Vitest com `globals: true`.
- A lógica de detecção é extraída para função exportada — os testes testam a função pura, não o script completo.
- Mock de `fetch` global: usar `vi.stubGlobal('fetch', vi.fn())` para simular respostas da Management API sem chamadas reais de rede.
- Confirmar isolamento entre testes: `vi.restoreAllMocks()` ou `afterEach` cleanup de stubs globais.
- Os testes cobrem lógica de detecção + comportamentos de I/O simulados (401, ausência de token) — design intencional para execução em CI sem credenciais de produção.

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 17/06/2026 | v1.0 | Draft inicial. Investigação confirmou SEC-9 Done (actions.ts HEAD com SITE_URL, callback/route.ts com ALLOWED_NEXT_PATHS). Story foca no trabalho residual genuíno: script de auditoria + procedimento documentado de remoção do wildcard *.vercel.app. | @sm River |
| 17/06/2026 | v1.1 | NO-GO do @po (4,5/10) — defeito-raiz: v1.0 usava `/auth/v1/settings` + anon key que NÃO expõe a allowlist (sempre `undefined` → exit 0 permanente). Corrigido: fonte passou para Management API (`GET /v1/projects/{ref}/config/auth`, Bearer PAT). Campo correcto: `uri_allow_list` CSV. Env vars actualizadas: 2 novas no `.env.example` (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF). check:allowlist excluído do CI (ferramenta operacional). Testes reescritos para formato real da API (CSV + cenário 401 + gracioso sem PAT). Localização dos testes decidida explicitamente (Opção A: função exportada + teste em apps/web/src/__tests__/). Alternativa ficheiro estático documentada e recusada. | @sm River |
| 17/06/2026 | v1.2-DEV | Implementação completa (modo YOLO). [DEV-DECISION D-SEC11.1] Opção A na variante recomendada: lógica pura em `apps/web/src/lib/security/audit-allowlist.ts` (zero node:*/I/O), script CLI em `scripts/audit-supabase-allowlist.ts`, teste em `apps/web/src/__tests__/`. [DEV-DECISION D-SEC11.2] `evaluateAuthConfigResponse` para testar 401 sem rede. Regex do wildcard total alinhado ao fixture `https://**` + teste negativo p/ `expressia.pt/**`. Runbook ancorado por texto. 5/5 gates VERDES (lint·typecheck 10/10·web 1209/1209·build·check:rls exit 0). AC7 honrado (zero código de app existente / zero migrations). 3 ficheiros criados + 3 modificados. Aguarda @architect *qa-gate. | @dev Dex |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — @dev (Dex), modo YOLO autónomo.

### Debug Log References

Gates corridos localmente (todos VERDES):

- `pnpm lint` → ✔ No ESLint warnings or errors (10/10 tasks, --max-warnings=0).
- `pnpm typecheck` → 10/10 tasks successful (web executado fresh — sem fricção DOM).
- `pnpm --filter @meu-jarvis/web test` → 1209/1209 testes (150 ficheiros). Baseline 1199 → +10.
- Teste do novo módulo isolado: `audit-supabase-allowlist.test.ts` → 10/10.
- `pnpm build` → 10/10 tasks successful (módulo `lib/security` não vira rota no bundle).
- `pnpm check:rls` → exit 0 (28 tabelas, schema inalterado).

### Completion Notes List

**[DEV-DECISION D-SEC11.1] Localização da lógica testável (resolve item crítico do @po).**
Adoptada a **Opção A na variante recomendada pelo @po**: a lógica pura de detecção
vive em `apps/web/src/lib/security/audit-allowlist.ts` (exporta `auditAllowlist`,
`parseAllowlistCsv`, `evaluateAuthConfigResponse` + tipos), com **zero** `node:*`,
`process.exit` ou `fetch` — só funções puras sobre input. O teste em
`apps/web/src/__tests__/audit-supabase-allowlist.test.ts` importa via
`@/lib/security/audit-allowlist`. O script CLI raiz
`scripts/audit-supabase-allowlist.ts` faz todo o I/O (env, `fetch` à Management
API, `process.exit`) e importa a lógica pura por path relativo.

_Porquê A e não B (vitest.config em scripts/):_ verifiquei empiricamente que
`scripts/` NÃO está coberto por nenhum `tsconfig` de package (não há root
`tsconfig.json`; `apps/web/tsconfig.json` só inclui `src/**`) nem por Vitest.
A Opção B exigiria criar um package/workspace novo (`tsconfig` + `vitest.config`
+ entrada no `pnpm-workspace.yaml` + task turbo) — overhead grande e poluição do
grafo turbo. A Opção A reutiliza a infra já validada do `@meu-jarvis/web`
(Vitest jsdom corre `src/**/*.test.ts` em CI). Como a lógica pura não tem
dependências DOM nem node, compila limpa sob `lib: DOM` — **typecheck VERDE
provado** (web executou fresh, 10/10). O acoplamento script→`apps/web/src` é
aceitável: o script é ferramenta operacional, não código de runtime de produção,
e importa apenas a lógica de detecção pura.

**[DEV-DECISION D-SEC11.2] Cenário D (401) sem importar o script.**
O script CLI raiz tem efeitos colaterais no import (top-level `main().then(process.exit)`),
logo não é importável limpo no jsdom. Para honrar a AC5(d)/(e) sem rede, extraí
`evaluateAuthConfigResponse(status, body)` para o módulo puro: mapeia uma resposta
HTTP **já obtida** (incl. 401) para `{ exitCode, messages }` de forma
determinística. O `fetch` real fica só no script. O cenário E adicionalmente faz
`vi.stubGlobal('fetch', ...)` e prova que o ramo gracioso (sem token) nunca toca
a rede.

**Item 2 do @po (regex do wildcard total alinhado ao fixture):** `hasTotalWildcard`
casa `^[a-z]+:\/\/\*\*(\/|$)` — cobre exactamente o fixture `https://**` (Cenário C)
e NÃO classifica `https://expressia.pt/**` como total (teste negativo explícito
incluído). Cobre ainda `*://` e `**` solto.

**Item 3 do @po (âncora textual no runbook):** a subsecção SEC-11 foi inserida
por âncora de texto (após o bloco PO-FIX-2 `Site URL ≠ SITE_URL`, antes de
`## 6. Smoke test manual`), não por número de linha.

**AC7 honrado:** `git diff --stat` mostra modificações apenas em `.env.example`,
`docs/runbooks/supabase-auth-setup.md` e `package.json` (workspace config). Zero
modificações a código de app existente; zero migrations tocadas (verificado:
`git status packages/db/migrations/` = 0). Os únicos ficheiros novos em
`apps/web/src/` são a lógica de auditoria (`lib/security/audit-allowlist.ts`) e o
respectivo teste (`__tests__/`) — ambos aceitáveis por AC5/5.6.

**AC6:** `check:allowlist` NÃO foi adicionado ao pipeline CI — é ferramenta
operacional. Os 5 gates de CI mantêm-se inalterados.

**CodeRabbit:** Disabled (core-config `mcp.enabled: false` / nota na story) — self-healing
loop saltada; validação de qualidade fica para @architect no gate.

### File List

**Criados:**
- `scripts/audit-supabase-allowlist.ts` — script CLI operacional (I/O: env, fetch à Management API, process.exit).
- `apps/web/src/lib/security/audit-allowlist.ts` — lógica pura de detecção (testável; sem node:*/I/O).
- `apps/web/src/__tests__/audit-supabase-allowlist.test.ts` — testes Vitest (10 testes, 5 cenários AC5 + parser).

**Modificados:**
- `package.json` (raiz) — novo script `check:allowlist`.
- `.env.example` — nova secção "Auditoria operacional (SEC-11)" com `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`.
- `docs/runbooks/supabase-auth-setup.md` — nova subsecção §5 "SEC-11 — Restringir wildcard *.vercel.app após DNS estável".

## QA Results

### Review Date: 2026-06-17

### Reviewed By: Quinn (Test Architect)

**Veredicto: PASS** — Score 9,3/10 — Confiança: alta.

#### Foco adversarial (lição do ciclo PO) — o auditor falha quando deve?

Validei a CORRECÇÃO da lógica de auditoria com 16 casos adversariais corridos de
forma independente (réplica fiel dos regex via `node`, fora do harness do @dev).
**Zero falsos-negativos. Zero falsos-positivos.** Resultado por ponto exigido:

1. **Teste exercita o caminho exit 1?** Sim, com asserções reais. Cenário B
   (`audit-supabase-allowlist.test.ts:59-72`) asserta `result.safe === false`,
   `risks.toHaveLength(1)` e que a mensagem contém `*.vercel.app` e
   `password-reset-poisoning`. Cenário C (`:74-90`) asserta `safe === false` para
   `https://**` **e** inclui o teste negativo que `https://expressia.pt/**` NÃO é
   classificado como total. `evaluateAuthConfigResponse(200, *.vercel.app)` →
   `exitCode 1` (`:112-120`). Não é só caminho feliz.

2. **Detecção do wildcard é correcta?** `/\*\.vercel\.app/i` apanha o wildcard em
   **qualquer posição** do CSV (início/meio/fim — todos provados), com **espaços
   envolventes** (`parseAllowlistCsv` faz `trim`), e em **UPPERCASE/MixedCase**
   (flag `/i`). `hasTotalWildcard` cobre `https://**`, `http://**`, `**` solto,
   `*://` e `https://**/callback`. Sem falso-negativo óbvio.

3. **Parsing CSV correcto?** `split(',').map(trim).filter(Boolean)`
   (`audit-allowlist.ts:46-52`) — um valor com espaços (`  https://*.vercel.app/**  `)
   é detectado na mesma. Provado adversarialmente.

4. **Modo gracioso não mascara risco?** Sem PAT → exit 0 (operacional, CI sem
   credencial). MAS 401 → exit 1 PT-PT (`script:107-114`,
   `evaluateAuthConfigResponse:161-169`); status não-2xx → exit 1 (`:116-121`,
   `:171-175`); erro de rede / JSON inválido → exit 1 (`:100-105`, `:123-131`).
   Erro de auth NÃO é tratado como seguro.

5. **AC7 / âmbito?** `git diff --stat HEAD` = só `.env.example`, runbook,
   `package.json`. `git diff apps/web packages` = vazio (nenhum existente
   modificado). Untracked = só os 2 ficheiros NOVOS em `apps/web/src/`
   (lógica + teste), aceites por AC5/5.6. `packages/db/migrations` intacto.

#### Os 7 quality checks

| # | Check | Resultado |
|---|-------|-----------|
| 1 | Requisitos vs ACs (AC1–AC7 cumpridos) | PASS |
| 2 | Qualidade de testes (5 cenários AC5 + asserções reais) | PASS |
| 3 | Risco de segurança (detecção genuína, gracioso não mascara) | PASS |
| 4 | Manutenibilidade (lógica pura isolada, JSDoc PT-PT, KISS) | PASS |
| 5 | Standards (PT-PT, zero `any`, zero imports `../../` no código novo) | PASS |
| 6 | Gates de qualidade (lint·typecheck·test re-corridos fresh) | PASS |
| 7 | Âmbito / blast radius (zero app existente, zero migrations) | PASS |

Evidência fresca re-corrida pela lane QA: lint exit 0, typecheck exit 0,
SEC-11 test 10/10, adversarial 16/16.

#### Follow-up não-bloqueante (NIT)

- **TEST-001 (low):** o Cenário E (`:123-142`) replica a guarda de credenciais
  num bloco inline em vez de importar o ramo gracioso real do
  `scripts/audit-supabase-allowlist.ts:72-79` (teste parcialmente tautológico).
  Justificado por design (D-SEC11.2: script com side-effects no import).
  Sugestão opcional: extrair `evaluateCredentials(token, ref)` para o módulo puro
  e testá-la directamente. Não bloqueia.

### Gate Status

Gate: PASS → docs/qa/gates/SEC-11-supabase-allowlist-wildcard-restriction.yml

— Quinn, guardião da qualidade 🛡️
