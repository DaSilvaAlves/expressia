# Story INVITE-EMAIL: Envio automático de email no convite de família (Resend)

## Status

InReview — gate @qa **PASS 9,4/10** (código completo, 5/5 gates verdes). Config externa [EURICO] **FEITA 19/06**: `RESEND_API_KEY` em Vercel Prod ✓ + remetente alterado para `@euricoalves.pt` (único domínio verificado no plano grátis; decisão Eurico) ✓. **Falta só T6.3** (smoke E2E em prod, após deploy do @devops) para Done. Push pendente (@devops; ciclo /sdc correu sem `--push`).

## Executor Assignment

executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["lint", "typecheck", "test", "build"]

## Story

**As a** dono ou admin de uma família no Expressia,
**I want** que o convidado receba automaticamente um email com o link de aceitação ao criar um convite,
**so that** não seja necessário partilhar o link manualmente e o fluxo de convite funcione de forma completa.

## Acceptance Criteria

1. Após `POST /api/conta/household/invites` devolver `201`, é tentado o envio de um email ao endereço `body.email` via API Resend com o link absoluto `https://expressia.pt/aceitar-convite/{token}`.
2. O envio é **best-effort**: se o email falhar (erro de rede, API Resend indisponível, chave ausente), o convite é igualmente criado e a resposta `201` é devolvida normalmente; a falha é logged com `log.warn` e capturada via `captureException` (padrão Sentry do handler).
3. O link no email usa `SITE_URL` (variável de ambiente; valor esperado em prod: `https://expressia.pt`), aplicando o **padrão canónico SEC-9** (`actions.ts:61-78`): verificação **truthy** (`if (siteUrl)`, não `??` — uma `SITE_URL=""` por engano deve cair no fallback, não tornar-se origin `''`) + `.replace(/\/$/, '')` para normalizar barra final. Se `SITE_URL` não estiver definida/vazia, usa `https://expressia.pt` como fallback (nunca `window.location` nem headers HTTP).
4. O email tem copy em PT-PT europeu: assunto, corpo e call-to-action escritos exclusivamente em português europeu. Nenhuma string em PT-BR.
5. O remetente é `Expressia <convites@euricoalves.pt>` (nome de exibição "Expressia"; domínio `@euricoalves.pt` — único verificado no plano gratuito do Resend; `expressia.pt` exigiria o plano Pro. **Decisão Eurico 19/06**). Migrar para `@expressia.pt` quando o domínio for verificado.
6. O link de convite na UI (`/conta/household`, caixa "Link de convite") **mantém-se** como fallback visible ao owner/admin — não é removido.
7. Existe um cliente/helper de email em `apps/web/src/lib/email/resend.ts` com uma função exportada `sendInviteEmail({ to, inviteUrl, inviterName? })`. Não existe package `@meu-jarvis/email` — a lib vive exclusivamente em `apps/web`.
8. O helper usa a biblioteca `resend` (npm) com `RESEND_API_KEY` lido de `process.env`. Se a chave estiver ausente, retorna um resultado de falha sem lançar excepção — permitindo que o handler best-effort continue.
9. Zero migrations novas. A tabela `household_invites` com a sua policy SELECT corrigida (migration `0024`) já está em prod. Esta story NÃO toca em schema, migrations nem RLS.
10. Testes unitários cobrem o helper `sendInviteEmail`: (a) path de sucesso com Resend mockado; (b) path de falha com Resend a lançar excepção; (c) path de `RESEND_API_KEY` ausente. O handler POST não é re-testado de raiz — apenas a integração do helper (teste de integração leve ou mock de módulo no teste existente do handler se existir).

## 🤖 CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI is não está activo em `core-config.yaml`.
> A validação de qualidade utiliza o processo de revisão manual (@architect qa-gate).
> Para activar, definir `coderabbit_integration.enabled: true` em core-config.yaml.

## Tasks / Subtasks

- [x] T1 — Instalar dependência `resend` em `apps/web` (AC: 8)
  - [x] T1.1 — `pnpm --filter @meu-jarvis/web add resend` (resend `^6.14.0`)
  - [x] T1.2 — Verificar que não é adicionado `prepare: false` desnecessário (não é postgres-js) — N/A, resend não é cliente DB

- [x] T2 — Criar helper `apps/web/src/lib/email/resend.ts` (AC: 7, 8, 3, 4)
  - [x] T2.1 — Definir interface `SendInviteEmailParams { to: string; inviteUrl: string; inviterName?: string }`
  - [x] T2.2 — Implementar `sendInviteEmail(params)` com cliente `new Resend(apiKey)` (chave lida em runtime, dentro da função)
  - [x] T2.3 — Guard de chave ausente: se `!process.env.RESEND_API_KEY`, retornar `{ ok: false, reason: 'missing-api-key' }` sem lançar (AC: 8)
  - [x] T2.4 — Template plaintext + HTML mínimo em PT-PT: assunto `"Foste convidado para uma família no Expressia"`, corpo com link de aceitação e validade de 7 dias (AC: 4)
  - [x] T2.5 — Remetente `"Expressia <convites@expressia.pt>"` (AC: 5)
  - [x] T2.6 — Construção do `inviteUrl`: recebe já o URL absoluto construído pelo handler (separação de responsabilidades)
  - [x] T2.7 — Retornar `{ ok: true }` em sucesso, `{ ok: false; reason: string }` em falha — nunca lançar excepção para o chamador

- [x] T3 — Integrar `sendInviteEmail` no handler POST de convites (AC: 1, 2, 3, 6)
  - [x] T3.1 — Ponto de integração no handler `route.ts`: entre o fim do bloco `insertAuditLog` try/catch e o `annotateSpan(201)` — âncora confirmada pelo @po
  - [x] T3.2 — Construir `inviteUrl` com o padrão SEC-9 (truthy + `.replace(/\/$/, '')`), NÃO `??` (AC: 3)
  - [x] T3.3 — Chamar `sendInviteEmail` em bloco `try/catch` best-effort análogo ao bloco `insertAuditLog` (AC: 2)
  - [x] T3.4 — Em caso de falha do email: `log.warn(..., 'email de convite falhou (best-effort)')` + `captureException` (AC: 2)
  - [x] T3.5 — Resposta `201` devolvida independentemente do resultado do email (AC: 2)
  - [x] T3.6 — Confirmar que o `acceptPath` na resposta JSON se mantém (AC: 6 — UI continua a mostrar o link)

- [x] T4 — Testes unitários do helper (AC: 10)
  - [x] T4.1 — Ficheiro: `apps/web/src/lib/email/__tests__/resend.test.ts`
  - [x] T4.2 — Mock do módulo `resend` via `vi.mock('resend')` + `vi.hoisted` (Vitest)
  - [x] T4.3 — Teste: path de sucesso → `{ ok: true }`
  - [x] T4.4 — Teste: Resend lança excepção → `{ ok: false, reason: ... }` (sem re-throw)
  - [x] T4.5 — Teste: `RESEND_API_KEY` ausente → `{ ok: false, reason: 'missing-api-key' }` sem chamar Resend
  - [x] T4.6 — Verificar que o subject e o corpo contêm strings PT-PT (smoke de copy)

- [x] T5 — Quality gates (AC: todos)
  - [x] T5.1 — `pnpm lint` exit 0 (--max-warnings=0) — "No ESLint warnings or errors"
  - [x] T5.2 — `pnpm typecheck` exit 0 (TypeScript strict) — 10/10 tasks
  - [x] T5.3 — `pnpm --filter @meu-jarvis/web test` — 1278/1278 verdes (156 ficheiros)
  - [x] T5.4 — `pnpm build` exit 0 — 10/10 tasks
  - [x] T5.5 — `pnpm check:rls` exit 0 (zero impact — story sem tocar no schema)

- [ ] T6 — Precondição externa (bloqueante para Done, não para desenvolvimento) (AC: 5)
  - [x] T6.1 — `RESEND_API_KEY` definida em Vercel Production — **FEITO 19/06** (Eurico criou a key `expressia-web` no Resend + guardou como env var Sensitive em Production+Preview)
  - [x] T6.2 — Domínio remetente verificado no Resend — **FEITO**: `euricoalves.pt` já estava Verified (Ireland eu-west-1). Remetente do código alterado para `@euricoalves.pt` (decisão Eurico — evita plano Pro do Resend)
  - [ ] T6.3 — Teste E2E manual: **só após o @devops pôr o código em produção** — criar convite em prod → email chega a `euricoalvesia@gmail.com` → link funciona

## Dev Notes

### Contexto e motivação

DEV-DECISION D-6.7.3 ("MVP sem Resend") é revertida nesta story. O fluxo de convites existe e está provado em prod (Story 6.7, smoke INVITE-E2E), mas o email nunca foi enviado — o Eurico descobriu isso ao convidar `euricoalvesia@gmail.com` e não receber email.

**Hotfix 0024 (CRÍTICO — já em prod, aguarda commit):** A migration `packages/db/migrations/0024_fix_invites_select_policy_auth_users.sql` foi aplicada em prod mas ainda não está commitada. O repo está dessincronizado de prod. Esta situação é ortogonal à INVITE-EMAIL mas o @devops deve resolver antes de qualquer push desta story (handoff `mj-handoff-invite-email-resend-20260619.yaml`).

### Handler existente (ponto de integração)

Ficheiro: `apps/web/src/app/api/conta/household/invites/route.ts`

O POST handler (linhas 131-245) já:
- Valida autorização (owner/admin via `resolveHouseholdRole`)
- Valida body com `InviteCreateSchema` (Zod) — `{ email, role? }`
- Gera token de 32 bytes hex com `randomBytes`
- Insere em `household_invites` via `withHousehold` (RLS, 2.ª rede)
- Chama `insertAuditLog` em bloco best-effort (pattern a replicar para o email)
- Devolve `{ invite, acceptPath: '/aceitar-convite/{token}' }` com status 201

O ponto de integração é **entre a linha 208 (fim do bloco `insertAuditLog` try/catch) e a linha 221 (construção de `responseBody`)** — âncora inequívoca confirmada pelo @po. O `token` está disponível na variável local `token` (linha 165).

Construção do `inviteUrl` (padrão canónico SEC-9 — truthy, NÃO `??`):
```typescript
const base = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') : 'https://expressia.pt';
const inviteUrl = `${base}${acceptPath}`; // acceptPath = `/aceitar-convite/${token}`
```

Nota: `SITE_URL` já está em prod via Vercel (SEC-9 — `https://expressia.pt`; `.env.example` linha 87). A verificação truthy (e não `??`) é intencional: uma `SITE_URL=""` por engano deve cair no fallback, não tornar-se origin `''`. `.replace(/\/$/, '')` evita barra dupla. Espelha `getRequestOrigin()` em `(auth)/actions.ts:61-78`.

### Padrão best-effort a replicar

O `insertAuditLog` usa este padrão (linhas 196-208 do handler):

```typescript
try {
  await insertAuditLog({ ... });
} catch (auditErr) {
  log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
}
```

O email deve seguir o **mesmo padrão**, acrescentando `captureException` para o Sentry:

```typescript
try {
  const emailResult = await sendInviteEmail({ to: body.email, inviteUrl });
  if (!emailResult.ok) {
    log.warn({ reason: emailResult.reason, to: body.email }, 'email de convite não enviado (best-effort)');
  }
} catch (emailErr) {
  log.warn({ err: emailErr }, 'email de convite falhou (best-effort)');
  captureException(emailErr instanceof Error ? emailErr : new Error(String(emailErr)), {
    userId: auth.userId,
    route: ROUTE,
  });
}
```

### Helper de email — estrutura proposta

Localização: `apps/web/src/lib/email/resend.ts`

Imports absolutos obrigatórios (`@/lib/email/resend`). O helper é um módulo simples sem dependências de Next.js (pode ser testado em ambiente Node puro via Vitest).

```typescript
import { Resend } from 'resend';

export interface SendInviteEmailResult {
  ok: boolean;
  reason?: string;
}

export interface SendInviteEmailParams {
  to: string;
  inviteUrl: string;
  inviterName?: string;
}

export async function sendInviteEmail(params: SendInviteEmailParams): Promise<SendInviteEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: 'missing-api-key' };
  }
  // ...
}
```

A função deve ser `async` e nunca deve lançar — qualquer erro é capturado internamente e retornado como `{ ok: false, reason }`.

### Variáveis de ambiente relevantes

| Variável | Valor em prod | Nota |
|----------|--------------|------|
| `RESEND_API_KEY` | (a verificar com Eurico) | Declarada em `.env.example` linha ~55 |
| `SITE_URL` | `https://expressia.pt` | Definida em Vercel Production via SEC-9; usada para construir o link do email |

**NUNCA** usar `window.location` nem headers HTTP (`x-forwarded-host`) para construir o link — usar apenas `SITE_URL` (padrão estabelecido em SEC-9 para prevenir header poisoning).

### Copy PT-PT obrigatória

Assunto (subject): `"Foste convidado para uma família no Expressia"`

Corpo (plaintext mínimo):
```
Olá,

Foste convidado para te juntares a uma família no Expressia.

Clica no link abaixo para aceitar o convite (válido por 7 dias):
{inviteUrl}

Se não esperavas este email, podes ignorá-lo.

— A equipa Expressia
```

Versão HTML pode ser adicionada mas não é bloqueante para a story (plaintext aceitável para MVP).

Regras: usar "tu/foste/podes" (PT-PT), nunca "você/foi/pode" (PT-BR). "Equipa" não "time".

### Remetente

`"Expressia <convites@expressia.pt>"`

**Precondição externa (bloqueante para Done):** o domínio `expressia.pt` deve estar verificado no painel Resend (DNS SPF + DKIM). Esta verificação é acção [EURICO] antes de marcar a story Done. O código pode ser desenvolvido e testado localmente sem esta verificação.

### Imports e convenções

- Imports absolutos obrigatórios: `@/lib/email/resend` (nunca `../../lib/email/resend`).
- Sem `any` — usar tipos explícitos ou `unknown` com type guard.
- Comentários e error messages em PT-PT europeu.
- Sem build step novo — o package `@meu-jarvis/db` é source-only; análogo para `apps/web/src/lib/email/` (não criar novo workspace package).
- `RESEND_API_KEY` é server-side apenas — nunca prefixar com `NEXT_PUBLIC_`.

### RLS e base de dados

Esta story é **zero-migration**. A tabela `household_invites` tem todas as RLS policies activas (0001 + fix 0024). O handler POST usa `withHousehold` (2.ª rede RLS) para o INSERT — não é alterado nesse aspecto. O email é enviado **fora** do `withHousehold` (como o `insertAuditLog`) porque é uma operação de infra, não de domínio.

### Estrutura de ficheiros relevante

```
apps/web/src/
  app/api/conta/household/invites/
    route.ts                          ← handler a modificar (POST ~linha 165-225)
  lib/
    email/
      resend.ts                       ← NOVO (helper email)
      __tests__/
        resend.test.ts                ← NOVO (testes unitários)
    api-helpers/
      audit.ts                        ← padrão best-effort a replicar
    agent/
      db-shim.ts                      ← não alterar
  app/(app)/conta/household/
    _components/household-editor.tsx  ← UI com link de convite (manter como está — AC: 6)
```

### Testing

- Framework: Vitest (`globals: true` — sem imports de `describe`/`it`/`expect`)
- Ambiente: `node` (como `packages/db`)
- Mock do módulo `resend`: `vi.mock('resend', () => ({ Resend: vi.fn() }))`
- Os 3 cenários do AC10 são obrigatórios; testes adicionais de smoke de copy são bem-vindos mas não bloqueantes.
- O handler `route.ts` já tem testes (se existirem) — não duplicar; o foco é o helper isolado.
- Baseline actual: `apps/web` tem 962 testes (baseline Story 5.8). Os novos testes do helper devem aumentar este número.

### Decisões para o @po/@architect validarem

1. **Best-effort vs. bloqueante**: o handoff recomenda best-effort (convite criado mesmo se email falha). Esta story assume best-effort. Se o @po quiser bloqueante, é uma revisão do AC2.
2. **Reenvio de convite**: o convite expira em 7 dias (campo `expires_at`). Um botão "Reenviar email de convite" fica **fora de scope** desta story (pode ser story futura). O handler GET já lista convites pendentes com `expires_at > now()`.
3. **Template HTML**: plaintext é suficiente para o MVP. HTML estilizado pode ser adicionado numa story futura.

## Dev Agent Record

### Agent Model Used

Dex (Builder) — Opus 4.8 (1M context). Modo YOLO autónomo.

### File List

| Ficheiro | Tipo | Descrição |
|----------|------|-----------|
| `apps/web/src/lib/email/resend.ts` | NOVO | Helper `sendInviteEmail` — cliente Resend, copy PT-PT (plaintext + HTML), guard de chave em runtime, nunca lança |
| `apps/web/src/lib/email/__tests__/resend.test.ts` | NOVO | 6 testes do helper (3 cenários AC10 + erro de negócio + nunca-lança + smoke copy PT-PT) |
| `apps/web/src/app/api/conta/household/invites/route.ts` | MOD | Import `sendInviteEmail` + bloco best-effort (padrão SEC-9 truthy) entre `insertAuditLog` e `annotateSpan(201)`; `acceptPath` extraído para variável e reutilizado no `responseBody` |
| `apps/web/src/app/api/conta/household/invites/__tests__/route.test.ts` | MOD | `vi.mock('@/lib/email/resend')` (sucesso por defeito) para isolar o teste 201 do cliente Resend real |
| `apps/web/package.json` | MOD | Dependência `resend` `^6.14.0` |
| `pnpm-lock.yaml` | MOD | Lockfile actualizado (resend + transitivas) |

### Completion Notes

- **Padrão best-effort replicado** do `insertAuditLog`: o email é enviado fora do `withHousehold` (operação de infra, não de domínio). A resposta 201 é devolvida independentemente do resultado do email; `acceptPath` permanece no JSON (AC6 — fallback UI).
- **Fix @po aplicado:** `process.env.RESEND_API_KEY` lido **em runtime dentro da função** (não top-level) — torna o guard de chave-ausente testável com `vi.stubEnv`. O cliente `new Resend(apiKey)` é instanciado só após o guard.
- **Fix @po aplicado:** mock `vi.mock('@/lib/email/resend')` adicionado ao teste do handler; os 6 testes do handler continuam verdes.
- **[DEV-DECISION D-IE.1]** Erro de negócio da API Resend (`{ error: ErrorResponse }`, com `.message: string` — não é `Error`) tratado como falha best-effort: `return { ok: false, reason: error.message }`. O `instanceof Error` inicial foi corrigido após inspecção dos tipos do SDK (`ErrorResponse = { message, statusCode, name }`), evitando `[object Object]` no reason. Tipado, sem `any`.
- **[DEV-DECISION D-IE.2]** Versão HTML mínima adicionada (não-bloqueante por story), com `escapeHtml` no `inviteUrl` para evitar injecção no markup. Plaintext mantém-se como corpo principal.
- **[DEV-DECISION D-IE.3]** Teste do helper usa `vi.hoisted` para as refs do mock (`mockSend`/`ResendCtor`) — a factory de `vi.mock('resend')` é içada para o topo e não pode referenciar `const` normais (erro "Cannot access before initialization" observado e resolvido).
- **CodeRabbit:** Disabled em `core-config.yaml` — self-healing loop saltado conforme a story (§CodeRabbit Integration). Gate de qualidade delegado ao @architect.
- **Build:** corrido com segurança (porta 3000 sem dev server activo — o gotcha do `.next` partido só ocorre com `next dev` concorrente). Exit 0.
- **T6 (precondição externa) não-marcada:** bloqueante para *Done* (não para dev). Requer [EURICO]: `RESEND_API_KEY` em Vercel Production + domínio `@expressia.pt` verificado no Resend (SPF/DKIM) + teste E2E manual em prod.
- **Nota @devops:** migration `0024_fix_invites_select_policy_auth_users.sql` está em prod mas não-commitada (handoff `mj-handoff-invite-email-resend-20260619.yaml`) — ortogonal a esta story; resolver antes de qualquer push.

### Quality Gates (evidência)

| Gate | Resultado | Detalhe |
|------|-----------|---------|
| `pnpm lint` | exit 0 | "No ESLint warnings or errors" · 10/10 tasks |
| `pnpm typecheck` | exit 0 | TS strict · 10/10 tasks |
| `pnpm --filter @meu-jarvis/web test` | exit 0 | 1278/1278 verdes · 156 ficheiros (helper +6; handler 6/6 com novo mock) |
| `pnpm build` | exit 0 | 10/10 tasks · rota `/aceitar-convite/[token]` compila |
| `pnpm check:rls` | exit 0 | Todas as tabelas com policies · schema inalterado (zero-migration) |

## Change Log

| Data | Versão | Descrição | Autor |
|------|--------|-----------|-------|
| 2026-06-19 | v1.0 | Draft inicial — River (@sm) | @sm |
| 2026-06-19 | v1.1 | Implementação DEV — helper Resend + integração best-effort no handler POST + testes (5/5 gates GREEN). Ready for Review. | Dex (@dev) |

## QA Results

### Review Date: 2026-06-19

### Reviewed By: Quinn (Test Architect)

Revisão de código real (não confiando na story). 8 quality checks anti-alucinação validados contra o código + 4 gates re-corridos + teste de mutação.

- **Best-effort REAL** (route.ts:222-236): o `sendInviteEmail` corre num `try/catch` posterior ao INSERT já confirmado e ao `annotateSpan(201)`. Uma falha de email faz só `log.warn`+`captureException`; o `return ... { status: 201 }` (route.ts:253) está fora do alcance da falha. O convite NÃO é revertido. PASS.
- **Helper nunca lança** (resend.ts:101/118/123): guard de chave, guard de `error` de negócio e `catch` interno — todos os caminhos retornam objecto. PASS.
- **Padrão SEC-9** (route.ts:218-220): truthy `if (SITE_URL)` + `.replace(/\/$/, '')`, NÃO `??`. Correcto. PASS.
- **Copy PT-PT** ("Foste convidado", "podes ignorá-lo", "A equipa Expressia"): zero PT-BR. PASS.
- **Segurança**: `RESEND_API_KEY` server-side (zero `NEXT_PUBLIC_`); `escapeHtml` aplicado ao `inviteUrl` no HTML. Token é hex `randomBytes` (vector XSS nulo) + defesa-em-profundidade. PASS.
- **Sem `any`; imports `@/`; D-IE.1** (`error.message` do ErrorResponse Resend correcto). PASS.
- **Zero-migration**: última migration `0024` (pré-existente). Nenhuma nova. PASS.
- **AC10 — 3 cenários** (resend.test.ts:45/55/64) significativos. PASS.

**Gates re-corridos:** `lint` exit 0 (forçado `next lint --max-warnings=0` em apps/web → "No ESLint warnings or errors", sem cache) · `typecheck` exit 0 (forçado `tsc --noEmit` em apps/web, sem cache) · `test` 1278/1278 (156 ficheiros) · `check:rls` exit 0.

**Teste de mutação:** removido o catch interno do helper (re-throw) → 2 testes falharam (b "Resend lança" + "nunca lança"). Prova que os testes guardam o contrato AC8/AC10. Ficheiro restaurado ao original.

**Issue LOW (TEST-001, não bloqueante):** falta um teste de integração no `route.test.ts` que prove no próprio handler que `emailResult.ok=false`/excepção ainda devolve 201 (o mock do helper devolve sucesso por defeito). O best-effort está provado por leitura de código + mutação.

**T6 (precondição externa Eurico):** não bloqueia o gate de código. A story só transita para **Done** após validação E2E em prod (`RESEND_API_KEY` em Vercel + domínio `@expressia.pt` verificado no Resend SPF/DKIM + email chega + link funciona).

**Nota @devops:** migration `0024` está em prod mas não-commitada (handoff `mj-handoff-invite-email-resend-20260619.yaml`) — ortogonal a esta story; sincronizar antes de qualquer push.

### Gate Status

Gate: PASS → docs/qa/gates/INVITE-EMAIL-envio-email-convite-resend.yml

### Recommended Status

Ready for Done (após T6 — validação E2E em prod pelo Eurico). Apenas @devops faz push.
