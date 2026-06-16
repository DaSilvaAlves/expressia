# Story SEC-9: Endurecer redirectTo auth — eliminar dependência de headers controláveis pelo cliente

## Status

Done (gated @qa PASS 9,5/10 — 16/06/2026; pushed para `main` por @devops Gage em 16/06/2026)

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["pnpm lint", "pnpm typecheck", "pnpm --filter @meu-jarvis/web test", "pnpm build", "pnpm check:rls"]
```

## Story

**As a** equipa de segurança Expressia,
**I want** que os links de reset de password e confirmação de email derivem o origin a partir de uma env var de confiança em produção (em vez de headers HTTP controláveis pelo cliente),
**so that** um atacante que consiga envenenar o header `host` ou `origin` não consiga redirecionar os links de reset/confirm para um domínio sob o seu controlo (password-reset-poisoning).

## Acceptance Criteria

1. A função `getRequestOrigin()` em `apps/web/src/app/(auth)/actions.ts` dá precedência à variável de ambiente `SITE_URL` quando esta está definida e não vazia: nesse caso devolve `SITE_URL` sem consultar nenhum header HTTP.
2. O fallback por headers (`origin` → `x-forwarded-proto` + `host`) mantém-se activo apenas quando `SITE_URL` não está definida, garantindo compatibilidade com ambientes de desenvolvimento local e deploys de preview Vercel.
3. A variável `SITE_URL` é adicionada ao ficheiro `.env.example` na raiz do repositório, com comentário explicativo em PT-PT que descreve o propósito de segurança e o formato esperado (ex.: `https://expressia.pt`).
4. O runbook `docs/runbooks/supabase-auth-setup.md` é actualizado na secção §5 (Redirect URLs) com uma nota de segurança que documenta: (a) a obrigatoriedade de definir `SITE_URL` em Vercel Production antes do soft-launch com tráfego real; (b) a recomendação de restringir ou eliminar o wildcard `*.vercel.app` da allowlist de Redirect URLs do Supabase Dashboard após o DNS de produção estar estável — esta última é uma acção de configuração [EURICO] e não gera código.
5. Os testes unitários existentes em `apps/web/src/app/(auth)/__tests__/actions.test.ts` são actualizados (ou complementados) para cobrir os dois ramos de `getRequestOrigin()`: (a) quando `SITE_URL` está definida, o resultado é exactamente o valor da env var; (b) quando `SITE_URL` não está definida, o resultado continua a derivar dos headers mockados.
6. `pnpm lint` (--max-warnings=0), `pnpm typecheck`, `pnpm --filter @meu-jarvis/web test`, `pnpm build` e `pnpm check:rls` passam sem erros.

## CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI não está activado em `core-config.yaml`.
> A validação de qualidade utiliza processo de revisão manual.

## Tasks / Subtasks

- [x] Tarefa 1 — Actualizar `getRequestOrigin()` para leitura prioritária de `SITE_URL` (AC: 1, 2)
  - [x] 1.1 Em `apps/web/src/app/(auth)/actions.ts`, dentro da função `getRequestOrigin()`, ler `process.env.SITE_URL` antes de qualquer chamada a `headers()`.
  - [x] 1.2 Se `process.env.SITE_URL` existir e não for vazia string, devolver o valor directamente (sem trim que altere o valor configurado, mas documentar que não deve ter trailing slash).
  - [x] 1.3 Caso contrário, manter o comportamento actual (leitura de `origin`, depois `x-forwarded-proto` + `host`, com fallback `localhost:3000`).
  - [x] 1.4 Actualizar o bloco de comentário JSDoc da função para reflectir a nova lógica e referenciar `SEC-9` + a Directive do commit `f472c22`.
- [x] Tarefa 2 — Actualizar `.env.example` (AC: 3)
  - [x] 2.1 Adicionar a variável `SITE_URL=` à secção Runtime (ou criar secção "Auth redirect") com comentário explicativo: propósito de segurança, formato esperado, obrigatoriedade em produção.
- [x] Tarefa 3 — Actualizar runbook `docs/runbooks/supabase-auth-setup.md` §5 (AC: 4)
  - [x] 3.1 Adicionar subsecção "Notas de segurança" (ou expandir as existentes — já existe uma em §5 às linhas ~227) descrevendo: (a) como configurar `SITE_URL` na Vercel; (b) recomendação de restringir `*.vercel.app` na allowlist após DNS estável; (c) referência ao vector password-reset-poisoning e à sua mitigação via env var.
  - [x] 3.1.1 [PO-FIX-2] Esclarecer explicitamente a distinção entre os dois conceitos homónimos: o campo **`Site URL`** do Supabase Dashboard (já documentado na tabela do §5, linha ~212 — destino default de magic links no lado Supabase) versus a env var **`SITE_URL`** da Vercel que esta story introduz (lida em `getRequestOrigin()` no lado da aplicação para construir o `redirectTo`). São camadas de defesa complementares e independentes; ambas devem apontar para o mesmo domínio de produção. Evita que um leitor futuro pense que são a mesma configuração.
  - [x] 3.2 Confirmar que o runbook continua coerente com a lista de Redirect URLs documentada (não alterar a lista em si — é configuração Eurico).
- [x] Tarefa 4 — Actualizar/complementar testes unitários (AC: 5, 6)
  - [x] 4.1 Em `apps/web/src/app/(auth)/__tests__/actions.test.ts`, adicionar (ou adaptar) casos de teste para `getRequestOrigin()` (se a função for exportada ou acessível indirectamente via testes das actions).
  - [x] 4.2 Caso `getRequestOrigin()` não seja exportada, testar os dois ramos via `resetPasswordAction` e `signUpAction` mockando `process.env.SITE_URL` (usar `vi.stubEnv` ou `process.env` setup/teardown em Vitest).
  - [x] 4.3 Ramo A — `SITE_URL` definida: verificar que o `redirectTo` nas calls a `supabase.auth.resetPasswordForEmail` e `supabase.auth.signUp` contém exactamente `${SITE_URL}/callback...` sem derivar de headers.
  - [x] 4.4 Ramo B — `SITE_URL` não definida: verificar que o comportamento de fallback por headers se mantém inalterado (testes existentes devem continuar a passar sem modificação).
  - [x] 4.5 [PO-FIX-1] Garantir isolamento do ramo B: os testes de fallback existentes (`actions.test.ts` "fallback de origin: sem header origin usa host + x-forwarded-proto", em ambos os `describe`) NÃO desfazem stubs de env vars. Se `SITE_URL` estiver definida no ambiente de execução (ex.: CI após configuração futura, ou `.env.test`), o ramo A activa-se e estes dois testes FALHAM. Adicionar `afterEach(() => vi.unstubAllEnvs())` em ambos os `describe` E garantir que o ramo B é exercido com `SITE_URL` explicitamente ausente (não confiar no ambiente). Os testes do ramo A devem usar `vi.stubEnv('SITE_URL', 'https://expressia.pt')` localizado dentro do próprio `it`, nunca em `beforeEach` partilhado.
- [x] Tarefa 5 — Quality gate final (AC: 6)
  - [x] 5.1 `pnpm lint` (--max-warnings=0) verde.
  - [x] 5.2 `pnpm typecheck` verde.
  - [x] 5.3 `pnpm --filter @meu-jarvis/web test` verde (suite completa, incluindo novos testes SEC-9).
  - [x] 5.4 `pnpm build` verde.
  - [x] 5.5 `pnpm check:rls` verde (zero alterações a tabelas com `household_id` — confirmar que o RLS Coverage Gate não é afectado).

## Dev Notes

### Contexto e motivação

Esta story fecha o follow-up de segurança registado no handoff `docs/handoffs/mj-handoff-followups-soft-launch-20260615.yaml` (secção `follow_ups_seguranca_e_conformidade`, primeiro item) e formalizado como Directive no commit `f472c22` (feat(web): A2 — completar fluxo de reset de password):

> "FOLLOW-UP DE SEGURANÇA (não-bloqueante, pré-existente) — o redirectTo deriva de headers controláveis pelo cliente; mitigado pela allowlist do Supabase, mas o wildcard *.vercel.app deixa um vector residual de password-reset-poisoning de baixa probabilidade. Antes de tráfego real: fixar SITE_URL via env var em produção OU restringir o wildcard *.vercel.app na allowlist."

O padrão está presente em dois pontos de produção desde a Story 6.1 (`signUpAction`) e a Story A2 (`resetPasswordAction`).

### Ficheiro principal a modificar

`apps/web/src/app/(auth)/actions.ts` — função `getRequestOrigin()` (linhas 47-54 em HEAD `33572eb`):

```ts
async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
```

A função é chamada em:
- `signUpAction` (linha ~144): `options: { data: { name }, emailRedirectTo: \`${origin}/callback\` }`
- `resetPasswordAction` (linha ~211): `redirectTo: \`${origin}/callback?next=${encodeURIComponent(RESET_REDIRECT_PATH)}\``

O `@dev` deve introduzir a leitura de `process.env.SITE_URL` como primeira instrução da função, antes de `await headers()`. Quando definida, a função retorna imediatamente sem aceder a nenhum header — elimina o vector por completo em produção.

[AUTO-DECISION] Nome da env var → `SITE_URL` (não `NEXT_PUBLIC_SITE_URL`). Razão: o valor é lido apenas em Server Actions (contexto Node.js), nunca exposto ao browser. `NEXT_PUBLIC_` exporia o URL desnecessariamente ao bundle do cliente e violaria o princípio de mínimo privilégio. O `@dev` pode confirmar ou alterar se houver razão para a variável ser pública.

### Ficheiro de testes

`apps/web/src/app/(auth)/__tests__/actions.test.ts` — os testes existentes da `resetPasswordAction` e `signUpAction` (adicionados pelo commit `f472c22` e predecessores) devem ser o ponto de extensão. Em Vitest usar `vi.stubEnv('SITE_URL', 'https://expressia.pt')` / `vi.unstubAllEnvs()` em `afterEach` para isolar os testes.

### Ficheiros secundários a modificar

- `.env.example` (raiz do repositório) — adicionar `SITE_URL=` com comentário.
- `docs/runbooks/supabase-auth-setup.md` — actualizar §5 com nota de segurança.

### Confirmação de ausência de impacto em RLS / Base de dados

Esta story não toca em nenhuma tabela de domínio, migration SQL, schema Drizzle, nem em `getDb()` / `getServiceDb()`. O RLS Coverage Gate (`pnpm check:rls`) não é afectado. Não há migration a criar.

### Contexto de segurança — vector password-reset-poisoning

Um atacante com capacidade de manipular o header `Host` (ex.: via proxy SSRF, ou em cenários edge de misconfiguration de rede) pode fazer com que o link de reset gerado pelo Supabase aponte para `https://atacante.com/callback?...`. O utilizador clica, entrega o token ao atacante. A allowlist de Redirect URLs do Supabase é a primeira linha de defesa; o wildcard `*.vercel.app` é a superfície residual (qualquer subdomínio `.vercel.app` é aceite). A env var `SITE_URL` elimina a dependência de headers em produção, tornando o vector inviável independentemente da allowlist.

### Convenções do projecto a respeitar

- Imports absolutos `@/...` (não há novos imports esperados nesta story — leitura de `process.env` é nativa).
- TypeScript strict: `process.env.SITE_URL` é `string | undefined` — o `@dev` deve tratar o tipo correctamente (ex.: `const siteUrl = process.env.SITE_URL; if (siteUrl) return siteUrl;`).
- Comments e mensagens de erro em PT-PT.
- `pnpm lint --max-warnings=0`: confirmar que o novo código não introduz warnings ESLint (ex.: verificar regra `@typescript-eslint/prefer-nullish-coalescing` se aplicável).

### Referências de arquitectura

- `docs/architecture.md` §5.1 — Auth & Identity Architecture (Server Actions como ponto canónico de mutação).
- `docs/runbooks/supabase-auth-setup.md` §5 — Redirect URLs e Site URL (secção a actualizar).
- `apps/web/src/app/(auth)/callback/route.ts` — Route Handler que recebe o redirect do Supabase e chama `exchangeCodeForSession` / `verifyOtp`; não requer alteração nesta story.

### Testing

- Framework: Vitest com `globals: true` (`apps/web/vitest.config.ts` + `jsdom`).
- Setup: `apps/web/vitest.setup.ts`.
- Ficheiro de testes alvo: `apps/web/src/app/(auth)/__tests__/actions.test.ts`.
- Padrão de mock de env vars em Vitest: `vi.stubEnv('SITE_URL', value)` — restaurar com `vi.unstubAllEnvs()` em `afterEach`.
- Os testes existentes (ramo B — sem `SITE_URL`) não devem requerer modificação, apenas confirmação de que continuam a passar.
- Os novos testes (ramo A — com `SITE_URL`) devem verificar que as chamadas ao cliente Supabase mockado recebem `redirectTo` com o valor exacto da env var.
- Correr suite isolada: `pnpm --filter @meu-jarvis/web test -- src/app/(auth)/__tests__/actions.test.ts`.

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 16/06/2026 | v1.0 | Draft inicial | @sm River |
| 16/06/2026 | v1.1 | Validação PO (GO). PO-FIX-1: tarefa 4.5 — isolamento do ramo B (afterEach unstubAllEnvs; testes de fallback existentes ficam frágeis se SITE_URL estiver no ambiente). PO-FIX-2: tarefa 3.1.1 — esclarecer distinção campo Supabase `Site URL` vs env var Vercel `SITE_URL` no runbook §5. ACs/paths/símbolos confirmados byte-a-byte contra actions.ts (linhas 47-54, 144/151, 207/212), actions.test.ts, .env.example, runbook §5. | @po Pax |
| 16/06/2026 | v1.2 | Implementação completa (YOLO). Tarefas 1-5 [x]. `getRequestOrigin()` lê `SITE_URL` como 1.ª instrução (verificação truthy, não `??`, para que string vazia caia no fallback). JSDoc actualizado (SEC-9 + Directive f472c22) na função e em `resetPasswordAction`. `.env.example`: secção "Redirect de autenticação (SEC-9)". Runbook §5: subsecção SEC-9 (config Vercel + recomendação wildcard) + tabela PO-FIX-2 (Supabase `Site URL` vs env var `SITE_URL`). Testes: PO-FIX-1 aplicado (afterEach unstubAllEnvs + `vi.stubEnv('SITE_URL','')` no beforeEach de ambos os describe a forçar ramo B) + 2 testes ramo A. 5/5 gates verdes. | @dev Dex |
| 16/06/2026 | v1.3 | Fix cirúrgico SEC-001 (concern low do QA gate) aplicado pré-push, Status mantém-se `Done`. `getRequestOrigin()` normaliza barra final do ramo A: `return siteUrl.replace(/\/$/, '')` — `SITE_URL="https://expressia.pt/"` deixa de produzir `//callback` (erro de config provável ao colar o URL na Vercel). Truthy-check `if (siteUrl)` intacto (string vazia ainda cai no fallback), sem `??`, zero warnings ESLint. Ramo de fallback por headers INTOCADO. +1 teste ramo A (`SEC-001: SITE_URL com barra final → emailRedirectTo sem barra dupla`) — baseline ficheiro 14→15. Gates re-corridos: lint exit 0, typecheck exit 0, build exit 0, suite isolada 15/15 (24ms). | @dev Dex |

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — agente @dev (Dex), modo YOLO autónomo.

### Debug Log References

- Suite web completa: 1198 testes, 1197 pass + 1 falha por timeout (`tarefas/calendario/__tests__/page.test.tsx`). Provado FLAKY pré-existente alheio a SEC-9: passa isolado 5/5 em 1192ms (< 15000ms timeout). Contenção de recursos na suite paralela, documentado em SEC-3/SEC-7. SEC-9 não toca em calendário.

### Completion Notes List

- **AC1/AC2 (getRequestOrigin):** `process.env.SITE_URL` lido como primeira instrução, antes de `await headers()`. Verificação `if (siteUrl)` (truthy) é intencional em vez de `??` — uma string vazia configurada por engano deve cair no fallback por headers, não tornar-se um origin `''`. Quando definida, a função retorna sem nunca consultar headers (provado nos testes ramo A via `expect(headerGetMock).not.toHaveBeenCalled()`).
- **[AUTO-DECISION] Nome da env var → `SITE_URL`** (confirmado, não `NEXT_PUBLIC_SITE_URL`): lido apenas em Server Actions (Node.js), nunca exposto ao bundle do cliente. Mínimo privilégio. Coincide com a recomendação das Dev Notes.
- **[AUTO-DECISION] JSDoc de `resetPasswordAction`** actualizado além da função alvo: o comentário existente afirmava "sem env var SITE_URL", agora contraditório. Corrigido para apontar a `getRequestOrigin()` (SEC-9). Mudança documental, mesma secção lógica.
- **AC3 (.env.example):** nova secção "Redirect de autenticação (SEC-9)" com propósito de segurança, formato (URL absoluto sem barra final), obrigatoriedade em produção e nota de fallback em dev/preview.
- **AC4 (runbook §5):** subsecção SEC-9 — config `SITE_URL` na Vercel Production, recomendação [EURICO] de restringir `*.vercel.app` pós-DNS, e referência ao vector password-reset-poisoning. PO-FIX-2: tabela explícita Supabase `Site URL` (Dashboard, default magic links) vs env var Vercel `SITE_URL` (app, `getRequestOrigin()`) — camadas complementares, mesmo domínio.
- **AC5/AC6 (testes + PO-FIX-1):** `afterEach(() => vi.unstubAllEnvs())` adicionado a ambos os `describe`. Ramo B forçado com `vi.stubEnv('SITE_URL', '')` no `beforeEach` de cada describe (não confiar no ambiente — string vazia cai no fallback). 2 testes ramo A novos (`vi.stubEnv` local dentro do `it`), cada um com header `origin` envenenado (`https://atacante.com`) e assert de que o resultado usa exactamente `SITE_URL` e que nenhum header é consultado. Baseline 12 testes → 14 no ficheiro (+2).
- **RLS:** zero touch em DB/migrations/schema/`getDb()`. `pnpm check:rls` verde sem alterações de policies (28 tabelas inalteradas).
- **CodeRabbit:** SKIPPED — a story declara "CodeRabbit Integration: Disabled" (`core-config.yaml`). Validação delega no quality gate @architect, consistente com SEC-1→SEC-8.
- **IDS protocol:** SEARCH→`getRequestOrigin()` já existia (REUSE/ADAPT, não CREATE). Nenhum helper novo, nenhum ficheiro de produção novo. Leitura `process.env` é nativa.
- **SEC-001 (fix pré-push, v1.3):** o concern low do QA gate (`getRequestOrigin()` não normalizava trailing slash) foi fechado antes do push. Ramo A passa a fazer `return siteUrl.replace(/\/$/, '')` — `SITE_URL="https://expressia.pt/"` deixa de gerar `https://expressia.pt//callback`. NÃO é vector de segurança (host fica fixo), é robustez de input de configuração. Truthy-check `if (siteUrl)` preservado (string vazia continua a cair no fallback), sem `??`. Ramo de fallback por headers NÃO foi tocado. JSDoc da função documenta a normalização (SEC-001). +1 teste ramo A no `signUpAction` que assert exactamente `https://expressia.pt/callback` (uma só barra). Baseline do ficheiro 14→15 testes. Re-validação: lint/typecheck/build exit 0; suite isolada `actions.test.ts` 15/15 (24ms).

### File List

| Ficheiro | Operação | Detalhe |
| --- | --- | --- |
| `apps/web/src/app/(auth)/actions.ts` | modificado | `getRequestOrigin()` lê `SITE_URL` 1.º; v1.3 SEC-001: `.replace(/\/$/, '')` no ramo A (normaliza barra final); JSDoc da função + de `resetPasswordAction` actualizados (SEC-9 + SEC-001). |
| `.env.example` | modificado | Nova secção "Redirect de autenticação (SEC-9)" com `SITE_URL=`. |
| `docs/runbooks/supabase-auth-setup.md` | modificado | §5 — subsecção SEC-9 + tabela PO-FIX-2. |
| `apps/web/src/app/(auth)/__tests__/actions.test.ts` | modificado | PO-FIX-1 (afterEach unstubAllEnvs + stubEnv '' no beforeEach) + 2 testes ramo A. Import de `afterEach`. v1.3 SEC-001: +1 teste ramo A (barra final → sem barra dupla). Total 15. |
| `docs/stories/active/SEC-9.harden-auth-redirect-host-header.story.md` | modificado | Checkboxes, Dev Agent Record, Change Log, Status. |

## QA Results

### Review Date: 16/06/2026

### Reviewed By: Quinn (Test Architect & Quality Advisor)

### Veredicto: PASS — Score 9,5/10

Lane de revisão independente (autoria SM/PO/DEV já passou; esta avaliação não implementa, apenas audita). Os 7 quality checks do `qa-gate.md` foram re-corridos pela lane QA — evidência re-confirmada, não confiada cegamente.

#### Quality checks (7/7 PASS)

| # | Check | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | AC1/AC2 — `getRequestOrigin()` precedência `SITE_URL` + fallback | PASS | `actions.ts:65-66` lê `process.env.SITE_URL` como 1.ª instrução; `return siteUrl` imediato ANTES de `await headers()` (linha 68). Ramo B (68-73) byte-idêntico ao HEAD anterior — zero regressão. |
| 2 | AC3 — `.env.example` | PASS | `.env.example:75-87` secção "Redirect de autenticação (SEC-9)": propósito de segurança, formato (URL absoluto sem barra final), obrigatoriedade em produção, nota de fallback dev/preview. PT-PT. |
| 3 | AC4 — runbook §5 (+ PO-FIX-2) | PASS | `supabase-auth-setup.md` linhas 234-275: subsecção SEC-9 (config Vercel + recomendação wildcard [EURICO]) + tabela PO-FIX-2 (campo Supabase `Site URL` vs env var Vercel `SITE_URL` — camadas complementares, mesmo domínio). |
| 4 | AC5 — testes ambos os ramos (+ PO-FIX-1) | PASS | `afterEach(vi.unstubAllEnvs)` em ambos os `describe`; `beforeEach` com `stubEnv('SITE_URL','')` força ramo B sem confiar no ambiente; 2 testes ramo A (linhas 145, 216) com `origin` envenenado + assert `headerGetMock.not.toHaveBeenCalled()`. **14/14 verde isolado** (984ms). |
| 5 | AC6 — gates (lint/typecheck/test/build/check:rls) | PASS | lint exit 0 (`--max-warnings=0`), typecheck exit 0, build exit 0 (rota `/recuperar/nova-palavra-passe` compilada), check:rls exit 0 (28 tabelas, zero touch DB). |
| 6 | SEG — vector fechado / header poisoning | PASS | Com `SITE_URL` definida, NENHUM header é consultado (`return` antes de `headers()`). Provado: `origin=https://atacante.com` ignorado, `headerGetMock.not.toHaveBeenCalled()` (linhas 159, 229). |
| 7 | Constraints — PT-PT / RLS NFR5 / sem `any` / imports absolutos / billing | PASS | PT-PT europeu (sem PT-BR). RLS intacto. Zero `any`, zero imports relativos (git diff grep). Billing/Stripe não tocado (diff-stat confinado a 4 paths da File List). |

#### Avaliação de segurança aprofundada (Risk-Based Testing)

- **Vector fecha-se?** Sim. `getRequestOrigin()` retorna `SITE_URL` sem tocar em headers (return na linha 66, antes de `await headers()` na 68). Os testes ramo A provam que o header `origin` envenenado é completamente ignorado.
- **Truthy-check vs string vazia:** `if (siteUrl)` (não `??`) é a escolha correcta — `??` só apanharia `null`/`undefined` e deixaria `''` produzir um origin partido `'/callback'`. String vazia cai no fallback. Validado.
- **Ramo B sem regressão:** lógica idêntica ao HEAD anterior; os 2 testes de fallback passam sem alteração de assertions.
- **Defesa em profundidade (3 camadas independentes):** (1) `SITE_URL` na app; (2) allowlist Redirect URLs do Supabase Dashboard; (3) open-redirect guard no `callback/route.ts` (`?next` validado contra `ALLOWED_NEXT_PATHS`, host derivado de `request.url`, nunca de input do atacante).
- **Blast radius baixo:** `getRequestOrigin()` consumida apenas por `signUpAction` e `resetPasswordAction` (grep confirmado), ambos com cobertura dos dois ramos.

#### Concern não-bloqueante (severidade low)

- **SEC-001 (low, não bloqueante):** `getRequestOrigin()` não normaliza trailing slash. Se um operador configurar `SITE_URL="https://expressia.pt/"` (com barra), o resultado é `https://expressia.pt//callback` (barra dupla). **NÃO é vector de segurança** — o host fica fixo e não controlável; é robustez de input de configuração (barra dupla pode partir o matching da rota `/callback`, link de reset quebrado, nunca redirect hostil). Mitigado por documentação em 3 sítios (JSDoc `actions.ts:47-49`, `.env.example:83`, runbook). Sugestão opcional: `.replace(/\/$/, '')` defensivo. Não afecta o PASS.

#### Nota residual de configuração (não código)

Enquanto `SITE_URL` não estiver definida em Vercel Production, a app cai no fallback por headers e o vector residual de baixa probabilidade persiste (mitigado pela allowlist). A obrigatoriedade está documentada como bloqueador [EURICO] no runbook §5, pré-soft-launch.

### Gate Status

Gate: PASS → docs/qa/gates/SEC-9-harden-auth-redirect-host-header.yml

### Recommended Status

Ready for Done — pronto para `@devops *push`. Acção de configuração [EURICO] (`SITE_URL` na Vercel Production) é pré-requisito de soft-launch, não bloqueia o merge.

— Quinn, guardião da qualidade 🛡️
