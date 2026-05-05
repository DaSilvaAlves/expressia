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
| 2026-05-05 | [mj-handoff-devops-blocker-no-remote-20260505](handoffs/mj-handoff-devops-blocker-no-remote-20260505.yaml) | devops → aiox-master | Story 1.4 push blocker | 6 commits criados localmente, CodeRabbit PASS Story 1.4, mas remote não existe. Eurico decidiu **Opção B** (público AGPL-3.0 `DaSilvaAlves/expressia`). Aguarda execução @devops. |

---

## 📦 Archived (consumed)

| Consumed | ID | From → To | Story/Task | Notas |
|----------|-----|-----------|------------|-------|
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

*Última actualização: 2026-05-05 14:00 (handoff session-resume consumido pelo Orion na sessão seguinte; Eurico escolheu Opção B — repo público `DaSilvaAlves/expressia` AGPL-3.0; commits 7+8 prontos, despacho @devops iminente)*
