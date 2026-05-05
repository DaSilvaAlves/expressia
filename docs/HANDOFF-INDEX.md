# HANDOFF INDEX — Expressia (meu-jarvis)

> **Fonte de verdade.** Qualquer agente AIOX, ao activar-se numa nova sessão/terminal,
> DEVE consultar este índice ANTES de aceitar tarefas relacionadas com este projecto.

**Protocolo:** ver `docs/handoffs/README.md` (a criar) ou regra global `~/.claude/rules/handoff-central.md`.

**Localização canónica:**
- Pendentes: `docs/handoffs/*.yaml`
- Arquivados: `docs/handoffs/archive/*.yaml`

---

## 📥 Pending (active handoffs)

| Data | ID | From | To | Story/Task | Acção concreta seguinte |
|------|-----|------|-----|-----------|--------------------------|
| 2026-05-05 | [mj-handoff-story-1.4-rls-test-suite-20260505](handoffs/mj-handoff-story-1.4-rls-test-suite-20260505.yaml) | aiox-master (Orion) | aiox-master (any new terminal) | Story 1.4 RLS Test Suite | Correr sanity checks, disparar @dev em modo YOLO para Story 1.4 |

---

## 📦 Archived (consumed)

_(vazio — primeiro handoff do projecto)_

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

*Última actualização: 2026-05-05*
