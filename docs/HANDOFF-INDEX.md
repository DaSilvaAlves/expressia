# HANDOFF INDEX — Expressia (meu-jarvis)

> **Fonte de verdade.** Qualquer agente AIOX, ao activar-se numa nova sessão/terminal,
> DEVE consultar este índice ANTES de aceitar tarefas relacionadas com este projecto.

**Protocolo:** ver `docs/handoffs/README.md` (a criar) ou regra global `~/.claude/rules/handoff-central.md`.

**Localização canónica:**
- Pendentes: `docs/handoffs/*.yaml`
- Arquivados: `docs/handoffs/archive/*.yaml`

---

## 📥 Pending (active handoffs)

| Created | ID | From → To | Story/Task | Notas |
|---------|-----|-----------|------------|-------|
| 2026-05-06 22:55 | [mj-handoff-vercel-env-var-malformed-20260506](handoffs/mj-handoff-vercel-env-var-malformed-20260506.yaml) | dev (Dex) → Eurico (manual Vercel UI) → @devops | **NOVO BLOCKER: Eurico edita Vercel UI para corrigir `NEXT_PUBLIC_SUPABASE_URL` malformado** | Sessão 22:37–22:55 executou playbook do handoff anterior. Vercel runtime logs revelaram causa exacta: `[Error: Invalid supabaseUrl: Provided URL is malformed.]` em @supabase/ssr `createServerClient` (apps/web/src/middleware.ts:29). H1 (env var corrompido) confirmada — fix é manual Eurico na Vercel UI, não codebase. Cleanup paralelo: commit local `c7901a7` adiciona `SUPABASE_SERVICE_ROLE_KEY` a turbo.json. Estado git: 3 ahead de origin/main. Playbook compacto: (1) Eurico edita 5 env vars na Vercel UI verificando ausência de aspas/whitespace/newlines, (2) trigger redeploy sem cache, (3) curl returns 200/redirect (não 500), (4) @devops push 3 commits, (5) @dev retoma Tasks 4-5. |
| 2026-05-06 | [mj-handoff-vercel-setup-c5-blocker-20260506](handoffs/mj-handoff-vercel-setup-c5-blocker-20260506.yaml) | devops (Gage) → any (Eurico→Gage→Dex) | **Story 1.6 Tasks 4-5 bloqueadas por Vercel project não existir** | **PARCIALMENTE consumido em 2026-05-06 22h** — Passo 1 (Eurico cria Vercel project) FEITO mas com middleware crash residual. Ver `mj-handoff-vercel-env-var-malformed-20260506` para próximos passos. Tasks 4 (Playwright E2E) e 5 (Vercel perf) continuam ⏸ paused até deploy verde end-to-end. Tasks 1-3+6 done por Dex (commit local `64ae35d`). |
| 2026-05-06 | [mj-handoff-session-pause-after-1.5-done-20260506](handoffs/mj-handoff-session-pause-after-1.5-done-20260506.yaml) | aiox-master → any | **Pausa sessão pós Story 1.5 Done end-to-end + 3 commits locais não pushed** | Story 1.5 confirmada Done end-to-end (smoke browser real OK + CI 4x verde). 3 commits locais (`f8749f7` Epic 2 draft, `add0b35` landing draft, `<sha>` este handoff) — todos docs, sem código. **NOTA: este handoff foi parcialmente consumido na sessão 2026-05-06 20h — os 3 commits foram pushed (run 25455195152 verde). Decisões product-level seguintes ainda pendentes.** |

---

## 📦 Archived (consumed)

| Consumed | ID | From → To | Story/Task | Notas |
|----------|-----|-----------|------------|-------|
| 2026-05-06 22:55 | [mj-handoff-vercel-middleware-crash-20260506](handoffs/archive/mj-handoff-vercel-middleware-crash-20260506.yaml) | dev (Dex) → dev (cabeça fresca) | Vercel middleware crash investigation playbook | Consumido por Dex 22:55. Passo 1 do playbook (runtime logs via Vercel CLI) executado e decisivo: causa = `Invalid supabaseUrl: Provided URL is malformed` (H1 confirmada). Cleanup parallel: commit local `c7901a7` adiciona SUPABASE_SERVICE_ROLE_KEY a turbo.json. Sucessor: `mj-handoff-vercel-env-var-malformed-20260506` (action items para Eurico + @devops). |
| 2026-05-06 | [mj-handoff-1.5-runtime-bug-local-dev-server-20260506](handoffs/archive/mj-handoff-1.5-runtime-bug-local-dev-server-20260506.yaml) | aiox-master → any | Story 1.5 Done formal + dev server local Runtime Error + commit ahead | Consumido por Orion 2026-05-06 18:47 (com Eurico). Playbook executado: P1 rm .next + pnpm dev fresco → Ready 2.8s. P2 Eurico smoke browser /registar /entrar /visao com login real → tudo OK. P3 Gage @devops push f2e4022 → CI run 25451514752 verde 1m41s. P4 este consume + arquivo + INDEX update. **Story 1.5 confirmada Done end-to-end.** |
| 2026-05-06 | [mj-handoff-story-1.5-ready-for-qa-20260506](handoffs/archive/mj-handoff-story-1.5-ready-for-qa-20260506.yaml) | aiox-master → qa | Story 1.5 ready for QA gate | Consumido por Quinn (@qa) ~17:00 — gate inicial CONCERNS (1 teste com bug harness). Orion fez fix mecânico commit `57de178`, re-gate Orion 17:30 → PASS. Sucessor: Gage @devops *push (2x verde) → Story 1.5 Done. |
| 2026-05-06 | [mj-handoff-session-resume-after-1.5-mid-implementation-20260506](handoffs/archive/mj-handoff-session-resume-after-1.5-mid-implementation-20260506.yaml) | aiox-master → any | SESSION RESUME — Story 1.5 mid-implementation | Consumido por aiox-master (Orion) na sessão 04:00–04:30 (com Eurico). Finalização manual da Story 1.5: smoke test browser real passou (registar→email→login→JWT com household_id→/visao OK), bug AC3 corrigido (decode JWT directo em vez de user_metadata), 3 commits novos (test JWT-RLS, fix /visao, story v1.3). Sucessor: mj-handoff-story-1.5-ready-for-qa. 3 paralelos (Epic 2/trademark/landing) ficam untracked sem decisão Eurico — sem custo. |
| 2026-05-06 | [mj-handoff-session-resume-after-1.5-ready-20260506](handoffs/archive/mj-handoff-session-resume-after-1.5-ready-20260506.yaml) | aiox-master → any | SESSION RESUME — pós Story 1.5 Ready | Consumido por aiox-master (Orion) na sessão 02:00–03:30; despachou Dex (Story 1.5 — 7/9 done), Morgan (Epic 2), Alex (Trademark research), Uma (Marketing landing). Sessão terminada por usage limit; sucessor é mj-handoff-session-resume-after-1.5-mid-implementation. |
| 2026-05-06 | [mj-handoff-devops-blocker-no-remote-20260505](handoffs/archive/mj-handoff-devops-blocker-no-remote-20260505.yaml) | devops → aiox-master | Story 1.4 push blocker | Consumido por aiox-master (Orion) — Eurico decidiu Opção B (público AGPL-3.0); push executado; remote `DaSilvaAlves/expressia` criado e operacional; CI verde após 2 fixes (commits 9 e 11). |
| 2026-05-05 | [mj-handoff-session-resume-after-1.4-20260505](handoffs/archive/mj-handoff-session-resume-after-1.4-20260505.yaml) | aiox-master → any | SESSION RESUME — pós Story 1.4 | Consumido por aiox-master (Orion) ao retomar contexto e accionar decisão de push (Opção B — público AGPL-3.0); commits 7+8 criados, despacho @devops a seguir. |
| 2026-05-05 | [mj-handoff-story-1.4-ready-for-push-20260505](handoffs/archive/mj-handoff-story-1.4-ready-for-push-20260505.yaml) | qa → devops | Story 1.4 RLS Test Suite | Consumido por @devops Gage; commits criados, push bloqueado por ausência de remote (ver runbook). |
| 2026-05-05 | [mj-handoff-story-1.4-ready-for-qa-20260505](handoffs/archive/mj-handoff-story-1.4-ready-for-qa-20260505.yaml) | aiox-master → qa | Story 1.4 RLS Test Suite | Implementação completa entregue ao QA; gate file PASS 7/7 (`docs/qa/gates/1.4-qa-gate.md`); story Done. |
| 2026-05-05 | [mj-handoff-story-1.4-rls-test-suite-20260505](handoffs/archive/mj-handoff-story-1.4-rls-test-suite-20260505.yaml) | aiox-master → aiox-master | Story 1.4 RLS Test Suite | Sanity ok (Docker 29, Node 22, pnpm 9.12.3); Status 1.4 Draft→Ready; delegado a @dev YOLO |

---

## 🔁 Convenções

| Item | Detalhe |
|------|---------|
| Project prefix | `mj-` (meu-jarvis codename) — usar sempre em filenames |
| Filename | `mj-handoff-{slug}-{YYYYMMDD}.yaml` |
| Stale threshold | 7 dias sem consumo → revisão humana |
| Quem consome | Agente destinatário (`to_agent` match) marca `consumed: true` + move para `archive/` |
| Quem elimina | Apenas humano ou `@aiox-master` após review |

---

*Última actualização: 2026-05-06 18:55 (sessão pausa após Story 1.5 Done end-to-end. 17 commits pushed nesta sessão + 4 CI runs verdes. 3 commits locais não pushed: `f8749f7` Epic 2 + `add0b35` landing + commit deste handoff — todos docs. Novo handoff `mj-handoff-session-pause-after-1.5-done` com playbook ~3 min para próxima sessão. **Estado real: `main` 3 ahead de `origin/main`, working tree limpo, dev server `bavhasjps` ainda a correr em :3000.** Decisões product-level pendentes: D1 Epic 2 scope, D2 landing queue, D3 trademark adiar, D4 B3+B4 contas EU para Story 1.7).*

*Update 2026-05-06 20:45 — Sessão retomou: Eurico pediu foco A (Story 1.6 canary). Pax @po validou GO 9.5/10 (Status Draft → Ready). Dex @dev implementou Tasks 1-3+6 (`/api/me` endpoint via PostgREST RLS-via-JWT, helper apiError, 8 testes Vitest, lint+typecheck verde) — commit local `64ae35d`. Gage @devops coordinated Vercel setup: C4 RESOLVED (approach Vercel GitHub Integration nativa, action `bobheadxi/deployments@v1`); **C5 BLOCKED** — Vercel project NÃO existe para `DaSilvaAlves/expressia`. Novo handoff `mj-handoff-vercel-setup-c5-blocker` criado (priority HIGH). Story 1.6 status: InProgress (Tasks 4-5 ⏸). Estado git real: `main` 1 ahead de `origin/main` (commit 64ae35d).*

*Update 2026-05-06 22:37 — Sessão Eurico+Dex 21:30-22:37 (1h07min) montou Vercel project Expressia correctamente (project name `expressia`, Root Directory `apps/web`, Region `cdg1` Paris UE, 5 env vars Supabase carregadas, 6 deploys Ready). MAS `expressia-black.vercel.app` retorna 500 `MIDDLEWARE_INVOCATION_FAILED`. Sessão pausada por exaustão — handoff `mj-handoff-vercel-middleware-crash` criado (priority HIGH) com 4 hipóteses ordenadas e playbook próxima sessão sem trabalho na Vercel UI. Estado git: `main` 2 ahead de `origin/main` (commits `64ae35d` + `dcf0ef0` — sem novos commits nesta sessão).*

*Update 2026-05-06 22:55 — Dex retomou e executou playbook `mj-handoff-vercel-middleware-crash`. Passo 1 (runtime logs Vercel) decisivo: causa real = `[Error: Invalid supabaseUrl: Provided URL is malformed.]` em @supabase/ssr (H1 confirmada — env var corrompida na Vercel UI). Fix é manual Eurico, não codebase. Cleanup paralelo: commit local `c7901a7` adiciona `SUPABASE_SERVICE_ROLE_KEY` a turbo.json (resolve warning do build). Handoff anterior consumido + arquivado. Novo handoff `mj-handoff-vercel-env-var-malformed` criado para action items Eurico→@devops. Estado git: `main` 3 ahead de `origin/main` (`64ae35d` + `dcf0ef0` + `3991453` + `c7901a7`).*
