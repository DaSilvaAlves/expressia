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
| 2026-05-06 | [mj-handoff-story-1.5-ready-for-qa-20260506](handoffs/mj-handoff-story-1.5-ready-for-qa-20260506.yaml) | aiox-master → qa | **Story 1.5 ready for QA gate** | 11 commits locais não-pushed. ACs 1-8 + Tasks 1-7 done. Smoke test manual end-to-end passado: registar `euricojsalves@gmail.com` → Supabase email confirm → login → JWT com `household_id` UUID → `/visao` mostra UUID válido. Story InProgress→InReview. Quality gates workspace-full **NÃO** corridos nesta sessão (apenas typecheck apps/web isolado, exit 0) — Quinn deve correr todos como parte do `*qa-gate 1.5`. Caveat menor: D8 dizia email confirmation OFF mas Dashboard real tem ON (funciona, mas é fricção — Quinn decide se gate ou follow-up Epic 6). |

---

## 📦 Archived (consumed)

| Consumed | ID | From → To | Story/Task | Notas |
|----------|-----|-----------|------------|-------|
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

*Última actualização: 2026-05-06 04:30 (Orion finalizou Story 1.5 com Eurico; smoke test manual end-to-end passado; 3 commits novos; story InReview; handoff QA criado).*
