---
name: cascade-guard
description: Enforce phase gates em agent cascades (QA→DevOps→Dev, @sm→@dev). Previne over-analysis, hallucination e drift entre fases. Usar antes de orquestrar workflows multi-agente.
version: 1.0.0
author: Eurico
---

# Cascade Guard — Phase Gate Enforcement

## Propósito

Enforçar contratos input/output entre fases de cascades multi-agente. Bloqueia Dev de escrever código sem citar story + AC. Bloqueia QA de aprovar sem evidence. Evita que o próximo agente "sintetize além do seu remit".

## Quando usar

- Antes de invocar cascade `@sm *draft → @po *validate → @dev *develop → @qa *qa-gate → @devops *push`
- Quando um agente está prestes a começar uma fase
- Quando uma fase completa e precisa passar artefacto para a próxima
- Quando suspeitas que um agente está a derivar fora do seu escopo

## Phase Gates obrigatórios

### Gate 1: @sm → @po
| Requisito | Como verificar |
|-----------|----------------|
| Story file existe em `docs/stories/active/` | Read file |
| Story tem todas as secções do template | Grep por headers |
| Epic context referenciado | Grep por `Epic:` |
| Acceptance criteria numeradas | Grep por `AC-\d+` |

### Gate 2: @po → @dev
| Requisito | Como verificar |
|-----------|----------------|
| Status da story = `Ready` | Grep por `Status: Ready` |
| 10-point checklist do PO registado | Grep por checklist output |
| Score >= 7 (GO) | Ler secção de validação |

### Gate 3: @dev → @qa
| Requisito | Como verificar |
|-----------|----------------|
| File List actualizada na story | Grep por `File List:` |
| Checkboxes de AC todos marcados | Grep por `[x]` vs `[ ]` |
| `npm run lint` passa | Bash exit code 0 |
| `npm run typecheck` passa | Bash exit code 0 |
| `npm test` passa | Bash exit code 0 |
| Commits atómicos com ref à story | `git log --oneline` |

### Gate 4: @qa → @devops
| Requisito | Como verificar |
|-----------|----------------|
| QA verdict = PASS (ou WAIVED com justificação) | Grep por `Gate: PASS` |
| Todos os 7 quality checks documentados | Grep por checks |
| CodeRabbit sem critical issues | Review output |

### Gate 5: @devops push
| Requisito | Como verificar |
|-----------|----------------|
| Branch correcta | `git branch --show-current` |
| Working tree limpo | `git status --porcelain` vazio |
| Pre-push checks passam | npm scripts |

## Anti-drift rules

### @dev MUST
- Citar story ID + AC específicos antes de escrever código
- Ler a story file com Read tool
- NUNCA implementar features fora das AC listadas
- NUNCA fazer push (delegar a @devops)

### @qa MUST
- Ler File List e tocar em cada ficheiro mencionado
- Correr os 7 quality checks — nenhum skipped
- NUNCA aprovar sem evidence em cada check

### @devops MUST
- Confirmar QA verdict = PASS antes de push
- Nunca alterar código (apenas git + CI)

### @sm MUST
- NUNCA implementar código
- Apenas criar story files a partir de PRD/epic

### @po MUST
- Rejeitar story com score < 7
- Listar fixes específicos no rejeito

## Execução da skill

1. **Identificar fase actual** e próxima fase no cascade
2. **Ler os requisitos do Gate** que separa as duas fases
3. **Verificar cada requisito** com as ferramentas apropriadas
4. **Report:**
   ```
   Gate {N}: {from} → {to}
   
   PASS:
     - {requisito verificado}
   FAIL:
     - {requisito falhado + evidência}
   
   Decisão: {PROCEED | BLOCK}
   Se BLOCK: {acção concreta para resolver}
   ```
5. **Se BLOCK:** não invocar o próximo agente. Criar handoff ou pedir fix ao agente actual.

## Kill switch

Se o agente actual repete análise >2x sem progresso, a skill **força handoff imediato** e interrompe o cascade.

## Referências

- Workflow execution rules: `~/.claude/rules/workflow-execution.md`
- Agent authority: `~/.claude/rules/agent-authority.md`
- Story lifecycle: definido em `.aiox-core/development/tasks/`
