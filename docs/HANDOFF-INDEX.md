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
| 2026-05-06 | [mj-handoff-session-resume-after-1.5-ready-20260506](handoffs/mj-handoff-session-resume-after-1.5-ready-20260506.yaml) | aiox-master → any | **SESSION RESUME** — pós Story 1.5 Ready | **LÊ PRIMEIRO.** Panorama completo pós-sessão 2026-05-05/06: repo público AGPL-3.0 com 12 commits + CI verde, bloqueador B2 fechado (migration 0002 aplicada + Auth Hook ENABLED), Story 1.5 Ready (@po GO 9/10). Próximo passo único: `@dev *develop 1.5` em modo Pre-Flight. |

---

## 📦 Archived (consumed)

| Consumed | ID | From → To | Story/Task | Notas |
|----------|-----|-----------|------------|-------|
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

*Última actualização: 2026-05-06 01:40 (sessão Story 1.5 Ready encerrada por Orion; novo handoff session-resume criado; devops-blocker arquivado; 12 commits no main público com CI verde; Eurico vai retomar em terminal novo para `@dev *develop 1.5`)*
